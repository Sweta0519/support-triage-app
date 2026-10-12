-- SUP-13 (PR #35): an attempt the limiter refuses no longer counts in any
-- bucket. The per-email sign-in lock already gave refused attempts back;
-- the per-IP sign-in and both sign-up buckets now do too, so a refund
-- after a refusal frees a real slot rather than paying off a refusal.

create or replace function ticketing.consume_auth_rate_limit(p_action text, p_ip text, p_email_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip_raw text := nullif(btrim(p_ip), '');
  v_ip text := coalesce(nullif(btrim(p_ip), ''), 'local');
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
      if v_ip_raw is not null then
        insert into ticketing.rate_limits (key, window_start, count)
        values ('sign_in_ip:' || v_ip_raw, v_win10, 1)
        on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
        returning count into v_count;
        if v_count > 20 then
          -- Refused: this attempt doesn't count.
          update ticketing.rate_limits set count = count - 1
          where key = 'sign_in_ip:' || v_ip_raw and window_start = v_win10;
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
      -- Not a wrong password: give the attempt back everywhere it counted,
      -- including the IP (an office signing in together isn't an attack).
      update ticketing.rate_limits set count = greatest(count - 1, 0)
      where (key in (v_pair, v_email) and window_start = v_win15)
         or (v_ip_raw is not null and key = 'sign_in_ip:' || v_ip_raw and window_start = v_win10);
      return true;

    when 'sign_up_failed' then
      -- Supabase refused the sign-up (e.g. a weak password): no email was
      -- sent, so it doesn't use up the email's quota.
      update ticketing.rate_limits set count = greatest(count - 1, 0)
      where key = 'sign_up_email:' || p_email_key and window_start = v_win60;
      return true;

    when 'sign_up' then
      if v_ip_raw is not null then
        insert into ticketing.rate_limits (key, window_start, count)
        values ('sign_up_ip:' || v_ip_raw, v_win60, 1)
        on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
        returning count into v_count;
        if v_count > 5 then
          update ticketing.rate_limits set count = count - 1
          where key = 'sign_up_ip:' || v_ip_raw and window_start = v_win60;
          return false;
        end if;
      end if;
      insert into ticketing.rate_limits (key, window_start, count)
      values ('sign_up_email:' || p_email_key, v_win60, 1)
      on conflict (key, window_start) do update set count = ticketing.rate_limits.count + 1
      returning count into v_count;
      if v_count > 3 then
        update ticketing.rate_limits set count = count - 1
        where key = 'sign_up_email:' || p_email_key and window_start = v_win60;
        if v_ip_raw is not null then
          update ticketing.rate_limits set count = count - 1
          where key = 'sign_up_ip:' || v_ip_raw and window_start = v_win60;
        end if;
        return false;
      end if;
      return true;

    else
      raise exception 'unknown auth rate limit action';
  end case;
end;
$$;

