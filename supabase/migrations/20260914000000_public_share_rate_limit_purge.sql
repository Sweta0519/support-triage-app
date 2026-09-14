-- Privacy-policy review (PR #9): consume_public_share_rate_limit() keys rows by
-- visitor IP, which is personal data, but had no cleanup of its own. Rows were
-- only removed when a *signed-in* user's consume_rate_limit() call happened to
-- fire its 1% opportunistic purge, so on a quiet deployment IP rows could sit
-- indefinitely. Give this function the same purge so the IP-keyed rows are
-- bounded by the function that creates them, matching the retention the
-- policy page promises.

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

  if random() < 0.01 then
    delete from ticketing.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= v_limit;
end;
$$;

revoke execute on function ticketing.consume_public_share_rate_limit(text) from public;
grant execute on function ticketing.consume_public_share_rate_limit(text) to service_role;
