-- SUP-58: "Request access" from the homepage files an access-request ticket.
--
-- The sign-up form (signup?access=1) stores the visitor's optional answers
-- in the new account's user metadata, under access_request: team, size and
-- purpose. The metadata never decides a role: handle_new_user() makes every
-- account a customer, and that's unchanged. The first time the person is
-- signed in (the confirmation link, or their first password sign-in), the
-- app calls file_access_request(). It files one ticket from those answers,
-- as that customer, into the queue, where it's triaged like any other.
--
-- Exactly once: the profile's access_requested_at is set in the same
-- transaction, under a row lock, so a double-clicked link or two sign-ins
-- at once can't file two. Users can't set it themselves (no column grant).
-- The ticket insert keeps every rule a customer's ticket has: the
-- create_ticket rate limit (its trigger reads auth.uid()) and the table's
-- length checks.

alter table ticketing.profiles add column access_requested_at timestamptz;

create or replace function ticketing.file_access_request()
returns table (ticket_id uuid, ticket_number bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_request jsonb;
  v_team text;
  v_size text;
  v_purpose text;
  v_id uuid;
  v_number bigint;
begin
  if v_uid is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select u.raw_user_meta_data -> 'access_request' into v_request
  from auth.users u
  where u.id = v_uid;
  if v_request is null or jsonb_typeof(v_request) <> 'object' then
    return;
  end if;

  -- Only a customer who hasn't filed one yet; the lock makes it once.
  perform 1 from ticketing.profiles p
  where p.id = v_uid and p.role = 'customer' and p.access_requested_at is null
  for update;
  if not found then
    return;
  end if;

  -- The answers are the visitor's own text: trimmed and capped here too.
  v_team := left(btrim(coalesce(v_request ->> 'team', '')), 100);
  v_size := left(btrim(coalesce(v_request ->> 'size', '')), 20);
  v_purpose := left(btrim(coalesce(v_request ->> 'purpose', '')), 2000);

  insert into ticketing.tickets (customer_id, subject, body)
  values (
    v_uid,
    case when v_team = '' then 'Access request' else 'Access request: ' || v_team end,
    'I''d like access to Support Triage for my team.' || chr(10) || chr(10)
      || 'Team: ' || coalesce(nullif(v_team, ''), '(not given)') || chr(10)
      || 'Team size: ' || coalesce(nullif(v_size, ''), '(not given)') || chr(10)
      || 'What we''d use it for: ' || coalesce(nullif(v_purpose, ''), '(not given)')
  )
  returning id, number into v_id, v_number;

  update ticketing.profiles set access_requested_at = now() where id = v_uid;

  return query select v_id, v_number;
end;
$$;

revoke all on function ticketing.file_access_request() from public, anon;
grant execute on function ticketing.file_access_request() to authenticated;
