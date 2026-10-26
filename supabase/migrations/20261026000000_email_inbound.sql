-- SUP-88 (email intake, part 1 of SUP-80): each workspace gets an inbound
-- email address, and the Resend webhook's deliveries are recorded once.
--
-- Mail arrives at Resend (the account's <id>.resend.app receiving domain
-- until a domain is bought), which POSTs a signed `email.received` event to
-- /api/email/inbound (docs/email.md). The event carries only metadata: the
-- body and headers are fetched from Resend's API by the email's id, so a
-- caller can't hand us content Resend never received. This part only
-- verifies and records events; turning them into tickets is SUP-89.

-- ---------------------------------------------------------------------------
-- 1. Each workspace's inbound address (the local part, before the @)
-- ---------------------------------------------------------------------------

-- Random, not derived from the name: knowing a team's name mustn't be
-- enough to file tickets into its queue. Volatile default, so every
-- existing workspace gets its own.
alter table ticketing.workspaces
  add column inbound_address text not null unique
    default 'in-' || encode(extensions.gen_random_bytes(6), 'hex')
    constraint workspaces_inbound_address_format check (inbound_address ~ '^in-[0-9a-f]{12}$');

-- Not added to the column grant for authenticated (20261025000000): no one
-- reads it from the browser yet. The admin page that shows it is SUP-91.

-- ---------------------------------------------------------------------------
-- 2. Webhook deliveries, one row per svix-id
-- ---------------------------------------------------------------------------

create table ticketing.inbound_email_events (
  -- Resend retries a delivery with the same svix-id, so it's the key that
  -- makes recording idempotent.
  svix_id text primary key constraint inbound_email_events_svix_id_length check (char_length(svix_id) between 1 and 100),
  resend_email_id text not null constraint inbound_email_events_email_id_length check (char_length(resend_email_id) between 1 and 100),
  -- Null when no recipient was one of our addresses.
  workspace_id uuid references ticketing.workspaces (id) on delete cascade,
  status text not null constraint inbound_email_events_status check (status in ('received', 'ignored')),
  reason text constraint inbound_email_events_reason check (reason in ('unknown_address', 'ambiguous_address')),
  created_at timestamptz not null default now(),
  constraint inbound_email_events_ignored_has_reason check ((status = 'ignored') = (reason is not null))
);

create index inbound_email_events_workspace_idx on ticketing.inbound_email_events (workspace_id, created_at desc);

alter table ticketing.inbound_email_events enable row level security;

revoke all on ticketing.inbound_email_events from anon, authenticated;
grant select on ticketing.inbound_email_events to authenticated;
grant all on ticketing.inbound_email_events to service_role;

-- Admins see their own workspace's deliveries (for the address page,
-- SUP-91). Writes come only from record_inbound_email_event().
create policy inbound_email_events_select_admin on ticketing.inbound_email_events
  for select to authenticated
  using (workspace_id = (select ticketing.current_workspace_id()) and (select ticketing.is_admin()));

-- ---------------------------------------------------------------------------
-- 3. Recording a delivery
-- ---------------------------------------------------------------------------

-- Called by the webhook route with the service role, after the signature
-- check. p_local_parts are the recipients' local parts whose domain is our
-- inbound domain (the route checks the domain). The workspace is worked out
-- here from the addresses, never taken from the caller.
--
-- Returns one of:
--   'duplicate'     this svix-id was recorded before (a retry): do nothing
--   'received'      recorded for its workspace
--   'ignored'       recorded with no workspace: no address of ours, or
--                   addresses of more than one workspace
--   'rate_limited'  the workspace's hourly cap is spent; nothing recorded,
--                   so Resend's retry can record it later
create function ticketing.record_inbound_email_event(p_svix_id text, p_email_id text, p_local_parts text[])
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspaces uuid[];
  v_ws uuid;
  v_reason text;
begin
  if exists (select 1 from ticketing.inbound_email_events where svix_id = p_svix_id) then
    return 'duplicate';
  end if;

  select coalesce(array_agg(distinct w.id), '{}') into v_workspaces
  from ticketing.workspaces w
  where w.inbound_address = any (select lower(p) from unnest(coalesce(p_local_parts, '{}')) p);

  if cardinality(v_workspaces) = 1 then
    v_ws := v_workspaces[1];
    -- 300 emails an hour per workspace. Mail floods (a loop, a spam run)
    -- stop here before they reach triage's budget.
    if ticketing.bump_rate_limit('email_inbound:' || v_ws, date_trunc('hour', now())) > 300 then
      return 'rate_limited';
    end if;
  else
    v_reason := case when cardinality(v_workspaces) = 0 then 'unknown_address' else 'ambiguous_address' end;
  end if;

  insert into ticketing.inbound_email_events (svix_id, resend_email_id, workspace_id, status, reason)
  values (p_svix_id, p_email_id, v_ws, case when v_ws is null then 'ignored' else 'received' end, v_reason)
  on conflict (svix_id) do nothing;
  if not found then
    -- A concurrent retry of the same delivery got there first.
    return 'duplicate';
  end if;

  return case when v_ws is null then 'ignored' else 'received' end;
end;
$$;

revoke all on function ticketing.record_inbound_email_event(text, text, text[]) from public, anon, authenticated;
grant execute on function ticketing.record_inbound_email_event(text, text, text[]) to service_role;
