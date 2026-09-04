-- Fixes from the security audit of the shareable-status-page feature
-- (docs/security/audit-share-feature.md).

-- Warning: the revoke policy's WITH CHECK didn't constrain the direction of
-- the change, so any staff member who can see the ticket could PATCH
-- revoked back to false via a raw Data API call and silently re-publish a
-- link a colleague deliberately took down. Make it one-directional: this
-- policy may only ever flip revoked to true, never back to false.
drop policy "shared_ticket_summaries_revoke_staff" on ticketing.shared_ticket_summaries;
create policy "shared_ticket_summaries_revoke_staff" on ticketing.shared_ticket_summaries
  for update
  to authenticated
  using (
    (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  )
  with check (
    revoked = true
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

-- Suggestion: shares never expired. A 30-day expiry bounds how long a link
-- that gets forwarded beyond its intended audience stays live, without
-- staff having to remember to revoke it.
alter table ticketing.shared_ticket_summaries
  add column expires_at timestamptz not null default (now() + interval '30 days');

-- Suggestion: nothing stopped two simultaneously-active shares existing for
-- one ticket -- the UI only shows the newest, so an older one became an
-- orphaned but still-valid link nobody could see or revoke. At most one
-- active (not revoked) share per ticket now.
create unique index shared_ticket_summaries_one_active_per_ticket
  on ticketing.shared_ticket_summaries (ticket_id)
  where not revoked;

-- Warning: the public route had no throttling at all -- every other
-- expensive or write path in this app goes through consume_rate_limit(),
-- but that function requires auth.uid() and anonymous visitors have none.
-- This is a separate, IP-keyed limiter for exactly one purpose: bounding
-- how hard an anonymous client can hammer /s/[token] (cost/availability,
-- not data exposure -- the 128-bit token already makes guessing a *valid*
-- token practically infeasible). Only ever called by the service-role
-- client from the public page's server-side code; there is still no grant
-- of any kind to `anon` on this table or this function.
create or replace function ticketing.consume_public_share_rate_limit(p_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_window_start timestamptz;
  v_count int;
  v_limit constant int := 30;
  v_window_seconds constant int := 300;
begin
  v_key := 'public_share:' || coalesce(nullif(p_ip, ''), 'unknown');
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds
  );

  insert into ticketing.rate_limits (key, window_start, count)
  values (v_key, v_window_start, 1)
  on conflict (key, window_start)
    do update set count = ticketing.rate_limits.count + 1
  returning count into v_count;

  return v_count <= v_limit;
end;
$$;

revoke execute on function ticketing.consume_public_share_rate_limit(text) from public;
grant execute on function ticketing.consume_public_share_rate_limit(text) to service_role;
