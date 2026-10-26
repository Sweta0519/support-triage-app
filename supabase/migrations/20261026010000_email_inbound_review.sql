-- SUP-88 review (PR #95).
--
--   * An email to two workspaces' addresses (a customer cc'ing two teams)
--     was ignored for both, with a row neither admin could see. Now each
--     workspace gets its own row, so each can file it in its own queue.
--     A delivery is one row per workspace it reached, so svix_id is no
--     longer the primary key.
--   * One email, not only one delivery: Resend can send the same email
--     again under a new svix-id. If any row has that svix-id or that email
--     id, the delivery is a 'duplicate'.
--   * Over the hourly cap, a delivery was refused with 429 and left to
--     Resend's retries. Svix retries on a fixed schedule for about a day,
--     so a long flood could drop a real email with no trace of it. Now
--     it's recorded as 'held' (200): kept for SUP-89 to file once the
--     flood is over, and visible to the workspace's admins.
--   * The cap is counted after the insert, for rows actually inserted, so
--     a duplicate or a concurrent retry never uses it up.
--   * Deliveries to addresses that aren't ours had no cap and no
--     retention. Now only the first 1000 an hour are recorded, and ignored
--     rows are deleted after 30 days.
--
-- The table was created by 20261026000000 and holds only test rows (which
-- the suite deletes), so its key is changed in place.

alter table ticketing.inbound_email_events drop constraint inbound_email_events_pkey;
alter table ticketing.inbound_email_events add column id bigint generated always as identity primary key;

-- One row per (delivery, workspace) and per (email, workspace); an
-- ignored delivery has one row with no workspace.
alter table ticketing.inbound_email_events
  add constraint inbound_email_events_svix_ws_unique unique nulls not distinct (svix_id, workspace_id),
  add constraint inbound_email_events_email_ws_unique unique nulls not distinct (resend_email_id, workspace_id);
create index inbound_email_events_email_id_idx on ticketing.inbound_email_events (resend_email_id);

alter table ticketing.inbound_email_events drop constraint inbound_email_events_status;
alter table ticketing.inbound_email_events
  add constraint inbound_email_events_status check (status in ('received', 'held', 'ignored'));

-- The old reason for an email to two workspaces; any such (test) row goes.
delete from ticketing.inbound_email_events where reason = 'ambiguous_address';
alter table ticketing.inbound_email_events drop constraint inbound_email_events_reason;
alter table ticketing.inbound_email_events
  add constraint inbound_email_events_reason check (reason in ('unknown_address', 'rate_limited'));
alter table ticketing.inbound_email_events drop constraint inbound_email_events_ignored_has_reason;
alter table ticketing.inbound_email_events
  add constraint inbound_email_events_reason_matches_status check (
    (status = 'received' and reason is null)
    or (status = 'held' and reason = 'rate_limited')
    or (status = 'ignored' and reason = 'unknown_address' and workspace_id is null)
  );

-- Returns one of:
--   'duplicate'  this delivery or this email was recorded before: nothing changes
--   'received'   recorded for every workspace it reached, all under their caps
--   'held'       recorded, but at least one workspace is over its 300 an hour
--   'ignored'    no address of ours
create or replace function ticketing.record_inbound_email_event(p_svix_id text, p_email_id text, p_local_parts text[])
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_inserted uuid[] := '{}';
  v_held boolean := false;
begin
  if exists (
    select 1 from ticketing.inbound_email_events
    where svix_id = p_svix_id or resend_email_id = p_email_id
  ) then
    return 'duplicate';
  end if;

  for v_ws in
    select distinct w.id
    from ticketing.workspaces w
    where w.inbound_address = any (select lower(p) from unnest(coalesce(p_local_parts, '{}')) p)
  loop
    insert into ticketing.inbound_email_events (svix_id, resend_email_id, workspace_id, status)
    values (p_svix_id, p_email_id, v_ws, 'received')
    on conflict do nothing;
    if found then
      v_inserted := v_inserted || v_ws;
      -- 300 emails an hour per workspace. Past that (a loop, a spam run),
      -- mail is held rather than sent on towards triage's budget.
      if ticketing.bump_rate_limit('email_inbound:' || v_ws, date_trunc('hour', now())) > 300 then
        update ticketing.inbound_email_events set status = 'held', reason = 'rate_limited'
        where svix_id = p_svix_id and workspace_id = v_ws;
        v_held := true;
      end if;
    end if;
  end loop;

  if cardinality(v_inserted) > 0 then
    return case when v_held then 'held' else 'received' end;
  end if;
  if found then
    -- Some workspace matched, but a concurrent delivery of the same event
    -- or email inserted first.
    return 'duplicate';
  end if;

  -- Not ours: acknowledged either way (no retry), but only the first 1000
  -- an hour are kept, for debugging.
  if ticketing.bump_rate_limit('email_inbound_ignored', date_trunc('hour', now())) <= 1000 then
    insert into ticketing.inbound_email_events (svix_id, resend_email_id, status, reason)
    values (p_svix_id, p_email_id, 'ignored', 'unknown_address')
    on conflict do nothing;
  end if;
  if random() < 0.01 then
    delete from ticketing.inbound_email_events where status = 'ignored' and created_at < now() - interval '30 days';
  end if;
  return 'ignored';
end;
$$;
