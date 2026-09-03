-- Application-level rate limiting: a fixed-window counter table, written
-- only through consume_rate_limit(). No new npm dependency (e.g.
-- @upstash/ratelimit) needed for this -- the app already has a transactional
-- database one query away.

create table ticketing.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

alter table ticketing.rate_limits enable row level security;

-- Deny-all: no policies, no grants to `authenticated` at all. The only way
-- to touch this table is through consume_rate_limit() below, which bypasses
-- both via SECURITY DEFINER.
grant all on ticketing.rate_limits to service_role;

-- The identity half of the key is derived from auth.uid() *inside* the
-- function, not accepted from the caller -- otherwise an authenticated
-- client could call this RPC with someone else's chosen key and grief their
-- rate limit bucket (e.g. spam it to zero to lock them out). p_action is
-- just a label ("create_ticket", "add_comment"); it never needs to be
-- treated as trusted input since the bucket it lands in is scoped to the
-- caller's own uid regardless of what string they pass.
create or replace function ticketing.consume_rate_limit(
  p_action text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_window_start timestamptz;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_key := auth.uid()::text || ':' || p_action;
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into ticketing.rate_limits (key, window_start, count)
  values (v_key, v_window_start, 1)
  on conflict (key, window_start)
    do update set count = ticketing.rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

grant execute on function ticketing.consume_rate_limit(text, int, int) to authenticated;
