-- SUP-13 (security scan M-2): app-level throttling on sign-in and sign-up.
-- Until now both relied only on Supabase Auth's own limits, which run on
-- Supabase's side and see the request coming from Vercel's servers rather
-- than from the visitor.
--
-- One function, called only by the server with the service role (like
-- consume_public_share_rate_limit): the visitor's IP comes from Vercel's
-- x-forwarded-for, so if clients could call this they could fill someone
-- else's IP bucket. Emails are keyed by md5(lower(email)), so the table
-- never holds an address. Same fixed-window counters as every other limit,
-- with the same opportunistic purge of day-old rows.
--
--   'sign_in'        every attempt counts against the IP: 20 per 10 min.
--                    Refused, without counting, once the email has had 10
--                    failed sign-ins in 15 min.
--   'sign_in_failed' records one failed sign-in for the email. Only
--                    failures count, so a stranger can't lock an account by
--                    trying it a few times -- they'd have to keep failing,
--                    which is exactly what this is meant to stop.
--   'sign_up'        5 per hour per IP and 3 per hour per email (the
--                    confirmation-email quota).

create or replace function ticketing.consume_auth_rate_limit(p_action text, p_ip text, p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip text := coalesce(nullif(btrim(p_ip), ''), 'unknown');
  v_email text := md5(lower(btrim(coalesce(p_email, ''))));
  v_ok boolean := true;

  -- The bucket the shared insert at the end increments.
  v_key text;
  v_window int;
  v_limit int;
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
      v_key := 'sign_in_ip:' || v_ip; v_window := 600; v_limit := 20;

    when 'sign_in_failed' then
      v_key := 'sign_in_failed:' || v_email; v_window := 900; v_limit := 2147483647;

    when 'sign_up' then
      v_key := 'sign_up_email:' || v_email;
      insert into ticketing.rate_limits (key, window_start, count)
      values (v_key, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 1)
      on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
      returning count into v_count;
      v_ok := v_count <= 3;
      v_key := 'sign_up_ip:' || v_ip; v_window := 3600; v_limit := 5;

    else
      raise exception 'unknown auth rate limit action';
  end case;

  insert into ticketing.rate_limits (key, window_start, count)
  values (v_key, to_timestamp(floor(extract(epoch from now()) / v_window) * v_window), 1)
  on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
  returning count into v_count;

  return v_ok and v_count <= v_limit;
end;
$$;

revoke execute on function ticketing.consume_auth_rate_limit(text, text, text) from public, anon, authenticated;
grant execute on function ticketing.consume_auth_rate_limit(text, text, text) to service_role;
