-- SUP-58 review fixes (20261015040000 is already applied).
--
-- file_access_request() now:
-- - calls ensure_profile() first, as CLAUDE.md asks of anything reading the
--   caller's profile: an account made through notes-collections may not have
--   one yet, and the request would otherwise wait for a later sign-in;
-- - removes the answers from the account's metadata once they're filed, so
--   they aren't kept twice (the ticket has them) or carried in every
--   session token.

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
  -- A sign-in shared with notes-collections may not have a profile yet.
  perform ticketing.ensure_profile();

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
  -- Filed: the answers live on in the ticket, so drop the copy kept with
  -- the sign-in (it also rode along in every session token).
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'access_request' where id = v_uid;

  return query select v_id, v_number;
end;
$$;
