-- SUP-13: consume_auth_rate_limit() now takes a null p_ip to mean "no
-- per-IP bucket". The server passes null only in local development, where
-- there is no real visitor IP (no header, or the dev server's loopback
-- address; the test suite signs in ~70 times a run from one machine). In production Vercel always sets the header, and
-- a missing one still goes to a shared 'unknown' bucket (the server sends
-- 'unknown', not null). The per-email limits apply either way.

create or replace function ticketing.consume_auth_rate_limit(p_action text, p_ip text, p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := md5(lower(btrim(coalesce(p_email, ''))));
  v_ok boolean := true;
  v_count int;
begin
  if random() < 0.01 then
    delete from ticketing.rate_limits where window_start < now() - interval '1 day';
  end if;

  case p_action
    when 'sign_in' then
      -- Too many recent failures for this email: refuse without counting.
      select coalesce(sum(r.count), 0) into v_count
      from ticketing.rate_limits r
      where r.key = 'sign_in_failed:' || v_email
        and r.window_start = to_timestamp(floor(extract(epoch from now()) / 900) * 900);
      if v_count >= 10 then
        return false;
      end if;
      if p_ip is not null then
        insert into ticketing.rate_limits (key, window_start, count)
        values ('sign_in_ip:' || p_ip, to_timestamp(floor(extract(epoch from now()) / 600) * 600), 1)
        on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
        returning count into v_count;
        v_ok := v_count <= 20;
      end if;

    when 'sign_in_failed' then
      insert into ticketing.rate_limits (key, window_start, count)
      values ('sign_in_failed:' || v_email, to_timestamp(floor(extract(epoch from now()) / 900) * 900), 1)
      on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1;

    when 'sign_up' then
      insert into ticketing.rate_limits (key, window_start, count)
      values ('sign_up_email:' || v_email, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 1)
      on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
      returning count into v_count;
      v_ok := v_count <= 3;
      if p_ip is not null then
        insert into ticketing.rate_limits (key, window_start, count)
        values ('sign_up_ip:' || p_ip, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 1)
        on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
        returning count into v_count;
        v_ok := v_ok and v_count <= 5;
      end if;

    else
      raise exception 'unknown auth rate limit action';
  end case;

  return v_ok;
end;
$$;
