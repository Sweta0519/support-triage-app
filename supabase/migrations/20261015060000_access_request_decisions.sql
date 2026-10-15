-- SUP-68: access requests reach admins, and are decided in one step.
--
-- Each access request (SUP-58) is tracked on the requester's profile: its
-- ticket, whether it's pending, granted or declined, and which admin decided
-- when. Admins already read every profile (profiles_select_staff), so the
-- sidebar count and the Access requests page need no new read grant. Nobody
-- can write these columns directly: there is no column grant, and the only
-- writers are the two functions below.

alter table ticketing.profiles
  add column access_request_ticket_id uuid references ticketing.tickets (id) on delete set null,
  add column access_request_status text
    constraint profiles_access_request_status_check check (access_request_status in ('pending', 'granted', 'declined')),
  add column access_decided_by uuid references ticketing.profiles (id) on delete set null,
  add column access_decided_at timestamptz;

create index profiles_access_request_pending_idx on ticketing.profiles (access_requested_at)
  where access_request_status = 'pending';

-- Requests filed before this: pending, with their ticket where it still exists.
update ticketing.profiles p
set access_request_status = 'pending',
    access_request_ticket_id = (
      select t.id from ticketing.tickets t
      where t.customer_id = p.id and t.subject like 'Access request%'
      order by t.created_at limit 1
    )
where p.access_requested_at is not null and p.access_request_status is null;

-- Filing now also records the request's ticket and pending state.
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

  update ticketing.profiles
  set access_requested_at = now(), access_request_ticket_id = v_id, access_request_status = 'pending'
  where id = v_uid;
  -- Filed: the answers live on in the ticket, so drop the copy kept with
  -- the sign-in (it also rode along in every session token).
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'access_request' where id = v_uid;

  return query select v_id, v_number;
end;
$$;

-- An admin grants or declines a pending request. Granting goes through
-- admin_set_role() (its rules: admins only, never yourself), making the
-- requester an agent. Either way, the request's ticket gets a reply from the
-- admin and is resolved, and the decision is recorded. All in one
-- transaction, under a row lock, so a request is decided exactly once.
create or replace function ticketing.decide_access_request(p_user uuid, p_grant boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket uuid;
  v_status ticketing.ticket_status;
  v_outcome text := case when p_grant then 'granted' else 'declined' end;
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'own_request' using errcode = '42501';
  end if;

  select p.access_request_ticket_id into v_ticket
  from ticketing.profiles p
  where p.id = p_user and p.access_request_status = 'pending'
  for update;
  if not found then
    raise exception 'not_pending' using errcode = 'P0002';
  end if;

  if p_grant then
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
      case when p_grant
        then 'Good news: you now have agent access to Support Triage. Reload the app to see the queue.'
        else 'Thanks for your interest in Support Triage. We can''t offer team access right now, but you can keep filing and following your own tickets here.'
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

revoke all on function ticketing.decide_access_request(uuid, boolean) from public, anon;
grant execute on function ticketing.decide_access_request(uuid, boolean) to authenticated;
