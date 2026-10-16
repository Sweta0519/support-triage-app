-- SUP-72 review: "Request access" is now "Get in touch" (the app has one
-- support team, so it's a way to reach that team, not access to a team of
-- your own). The words the database writes follow:
-- - file_access_request() titles the ticket "Getting in touch" (or
--   "Getting in touch: <team>"), opening with "Getting in touch about
--   Support Triage.", instead of "Access request" / "I'd like access…";
-- - decide_access_request()'s replies: joining the team when an admin adds
--   them, or a neutral thank-you when the request is closed, instead of
--   "agent access" / "We can't offer team access".
-- Both functions are as in their latest versions (20261016010000,
-- 20261015070000), with only these strings changed. Tickets already filed
-- keep their old titles.

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

  insert into ticketing.tickets (customer_id, subject, body, is_access_request)
  values (
    v_uid,
    case when v_team = '' then 'Getting in touch' else 'Getting in touch: ' || v_team end,
    'Getting in touch about Support Triage.' || chr(10) || chr(10)
      || 'Team: ' || coalesce(nullif(v_team, ''), '(not given)') || chr(10)
      || 'Team size: ' || coalesce(nullif(v_size, ''), '(not given)') || chr(10)
      || 'What we''d use it for: ' || coalesce(nullif(v_purpose, ''), '(not given)'),
    true
  )
  returning id, number into v_id, v_number;

  update ticketing.profiles
  set access_requested_at = now(), access_request_ticket_id = v_id, access_request_status = 'pending'
  where id = v_uid;
  -- Filed: the answers live on in the ticket, so drop the copy kept with
  -- the sign-in (it also rode along in every session token).
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'access_request' where id = v_uid;

  return query select v_id, v_number;
end;
$$;

create or replace function ticketing.decide_access_request(p_user uuid, p_grant boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket uuid;
  v_role ticketing.app_role;
  v_status ticketing.ticket_status;
  v_outcome text := case when p_grant then 'granted' else 'declined' end;
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'own_request' using errcode = '42501';
  end if;

  -- admin_set_role()'s lock first, then the row: the order a plain role
  -- change takes them in, so the two can't deadlock.
  perform pg_advisory_xact_lock(hashtext('ticketing.admin_set_role'));

  select p.access_request_ticket_id, p.role into v_ticket, v_role
  from ticketing.profiles p
  where p.id = p_user and p.access_request_status = 'pending'
  for update;
  if not found then
    raise exception 'not_pending' using errcode = 'P0002';
  end if;

  -- Only a customer becomes an agent. Someone already on the staff keeps
  -- their role (an admin is never demoted by granting their request).
  if p_grant and v_role = 'customer' then
    perform ticketing.admin_set_role(p_user, 'agent');
  end if;

  update ticketing.profiles
  set access_request_status = v_outcome, access_decided_by = auth.uid(), access_decided_at = now()
  where id = p_user;

  select t.status into v_status from ticketing.tickets t where t.id = v_ticket;
  if v_status is not null and v_status <> 'closed' then
    insert into ticketing.ticket_comments (ticket_id, author_id, body, is_internal)
    values (
      v_ticket,
      auth.uid(),
      case
        when p_grant and v_role <> 'customer'
          then 'Thanks for getting in touch. You''re already on our support team, so there''s nothing more to do here.'
        when p_grant
          then 'Welcome to our support team: you''ve been added as an agent. Reload the app to see the queue.'
        else 'Thanks for getting in touch. We''ll follow up here if there''s anything more, and you can keep filing and following your tickets any time.'
      end,
      false
    );
    if v_status <> 'resolved' then
      update ticketing.tickets set status = 'resolved' where id = v_ticket;
    end if;
  end if;

  return v_outcome;
end;
$$;
