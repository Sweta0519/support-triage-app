-- Review of SUP-13 (PR #35). consume_auth_rate_limit() is replaced:
--
--  * Parallel guesses no longer slip past the email lock. A sign-in
--    attempt is counted *before* the password is checked and refunded on
--    success ('sign_in_succeeded'), instead of being counted only after a
--    failure -- 50 concurrent guesses all passed the old check.
--  * A stranger can't lock a victim out. The tight lock is per email *and*
--    IP (10 failures in 15 min), so failing on purpose only locks the
--    attacker's own IP out of that account. A looser email-wide cap (50 in
--    15 min) still stops guessing spread over many IPs; reaching it takes
--    at least three IPs, given the per-IP limit of 20 per 10 min.
--  * Emails arrive as an HMAC computed by the app with a server-only
--    secret (p_email_key), not as addresses: an unsalted md5 of an email
--    can be reversed by hashing likely addresses.
--  * A sign-up refused by the IP limit no longer uses up the email's quota.
--
-- Windows are fixed (aligned to the clock), so "15 minutes" means "until
-- the current 15-minute window ends". The parameter is renamed, which
-- create or replace can't do, so the function is dropped and recreated
-- (same grants: service_role only).

drop function ticketing.consume_auth_rate_limit(text, text, text);

create function ticketing.consume_auth_rate_limit(p_action text, p_ip text, p_email_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip text := coalesce(p_ip, 'local');
  v_pair text := 'sign_in_pair:' || p_email_key || ':' || v_ip;
  v_email text := 'sign_in_email:' || p_email_key;
  v_win15 timestamptz := to_timestamp(floor(extract(epoch from now()) / 900) * 900);
  v_win10 timestamptz := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  v_win60 timestamptz := to_timestamp(floor(extract(epoch from now()) / 3600) * 3600);
  v_pair_count int;
  v_email_count int;
  v_count int;
begin
  if p_email_key is null or p_email_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid email key';
  end if;

  if random() < 0.01 then
    delete from ticketing.rate_limits where window_start < now() - interval '1 day';
  end if;

  case p_action
    when 'sign_in' then
      if p_ip is not null then
        insert into ticketing.rate_limits (key, window_start, count)
        values ('sign_in_ip:' || p_ip, v_win10, 1)
        on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
        returning count into v_count;
        if v_count > 20 then
          return false;
        end if;
      end if;
      -- Count this attempt now (refunded on success), atomically, so a
      -- burst of parallel guesses can't all pass.
      insert into ticketing.rate_limits (key, window_start, count)
      values (v_pair, v_win15, 1)
      on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
      returning count into v_pair_count;
      insert into ticketing.rate_limits (key, window_start, count)
      values (v_email, v_win15, 1)
      on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
      returning count into v_email_count;
      if v_pair_count > 10 or v_email_count > 50 then
        -- Refused: this attempt doesn't count.
        update ticketing.rate_limits set count = count - 1
        where key in (v_pair, v_email) and window_start = v_win15;
        return false;
      end if;
      return true;

    when 'sign_in_succeeded' then
      update ticketing.rate_limits set count = greatest(count - 1, 0)
      where key in (v_pair, v_email) and window_start = v_win15;
      return true;

    when 'sign_up' then
      if p_ip is not null then
        insert into ticketing.rate_limits (key, window_start, count)
        values ('sign_up_ip:' || p_ip, v_win60, 1)
        on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
        returning count into v_count;
        if v_count > 5 then
          return false;
        end if;
      end if;
      insert into ticketing.rate_limits (key, window_start, count)
      values ('sign_up_email:' || p_email_key, v_win60, 1)
      on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
      returning count into v_count;
      return v_count <= 3;

    else
      raise exception 'unknown auth rate limit action';
  end case;
end;
$$;

revoke execute on function ticketing.consume_auth_rate_limit(text, text, text) from public, anon, authenticated;
grant execute on function ticketing.consume_auth_rate_limit(text, text, text) to service_role;

-- The opportunistic purge filters on window_start alone.
create index if not exists rate_limits_window_start_idx on ticketing.rate_limits (window_start);
