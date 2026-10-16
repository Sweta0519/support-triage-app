-- SUP-70 review: access requests are marked on the ticket itself.
--
-- 20261016000000 recognised an access request through the requester's
-- profile (access_request_ticket_id), which a deleted profile or a missed
-- legacy ticket would lose. The ticket now carries the fact:
-- tickets.is_access_request, set by file_access_request() when it files
-- one. Users can't set it (no insert or update grant on the column).
--
-- One rule, applied wherever ticket similarity is used:
-- - detect_incident() never groups an access request (as before, now read
--   from the ticket);
-- - match_tickets(), triage's duplicate and related-ticket candidates, never
--   offers one either: access requests are worded alike, so they'd
--   otherwise be suggested as duplicates of each other.
-- The functions are as in their latest versions (20261015060000,
-- 20261016000000, 20260903040000), with only these lines changed.

alter table ticketing.tickets add column is_access_request boolean not null default false;

update ticketing.tickets t set is_access_request = true
where exists (select 1 from ticketing.profiles p where p.access_request_ticket_id = t.id);

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
    case when v_team = '' then 'Access request' else 'Access request: ' || v_team end,
    'I''d like access to Support Triage for my team.' || chr(10) || chr(10)
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

create or replace function ticketing.detect_incident(
  p_ticket_id uuid,
  p_threshold double precision,
  p_window_minutes int,
  p_min_tickets int
)
returns table (incident_id uuid, created boolean, ticket_count int, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_embedding extensions.vector(1536);
  v_since timestamptz := now() - make_interval(mins => p_window_minutes);
  v_existing uuid;
  v_members uuid[];
  v_incident uuid;
begin
  perform pg_advisory_xact_lock(hashtext('ticketing.detect_incident'));

  -- Already grouped, or an access request (SUP-70: worded alike, but not a
  -- problem report): nothing to do.
  if exists (select 1 from ticketing.incident_tickets it where it.ticket_id = p_ticket_id)
     or exists (select 1 from ticketing.tickets ar where ar.id = p_ticket_id and ar.is_access_request) then
    return;
  end if;
  -- Open, filed within the window, and embedded.
  select e.embedding into v_embedding
  from ticketing.ticket_embeddings e
  join ticketing.tickets t on t.id = e.ticket_id
  where e.ticket_id = p_ticket_id
    and t.status not in ('resolved', 'closed')
    and t.created_at >= v_since;
  if v_embedding is null then
    return;
  end if;

  select it.incident_id into v_existing
  from ticketing.ticket_embeddings e
  join ticketing.tickets t on t.id = e.ticket_id
  join ticketing.incident_tickets it on it.ticket_id = t.id
  join ticketing.incidents i on i.id = it.incident_id
  where t.id <> p_ticket_id
    and t.status not in ('resolved', 'closed')
    and t.created_at >= v_since
    and i.status in ('open', 'dismissed')
    and not t.is_access_request
    and 1 - (e.embedding operator(extensions.<=>) v_embedding) >= p_threshold
  order by i.opened_at desc
  limit 1;

  if v_existing is not null then
    insert into ticketing.incident_tickets (incident_id, ticket_id) values (v_existing, p_ticket_id);
    return query
      select v_existing, false,
        (select count(*)::int from ticketing.incident_tickets x where x.incident_id = v_existing),
        (select i.status from ticketing.incidents i where i.id = v_existing);
    return;
  end if;

  select array_agg(t.id) || p_ticket_id into v_members
  from ticketing.ticket_embeddings e
  join ticketing.tickets t on t.id = e.ticket_id
  where t.id <> p_ticket_id
    and t.status not in ('resolved', 'closed')
    and t.created_at >= v_since
    and not exists (select 1 from ticketing.incident_tickets x where x.ticket_id = t.id)
    and not t.is_access_request
    and 1 - (e.embedding operator(extensions.<=>) v_embedding) >= p_threshold;

  if coalesce(array_length(v_members, 1), 0) < p_min_tickets then
    return;
  end if;
  if (select count(distinct t.customer_id) from ticketing.tickets t where t.id = any (v_members)) < 2 then
    return;
  end if;

  insert into ticketing.incidents (title, first_seen_at)
  select 'Possible incident', min(t.created_at) from ticketing.tickets t where t.id = any (v_members)
  returning id into v_incident;
  insert into ticketing.incident_tickets (incident_id, ticket_id)
  select v_incident, m from unnest(v_members) as m;

  return query select v_incident, true, array_length(v_members, 1), 'open'::text;
end;
$$;

create or replace function ticketing.match_tickets(
  query_embedding extensions.vector(1536),
  match_count int,
  exclude_ticket_id uuid
)
returns table (
  ticket_id uuid,
  subject text,
  status ticketing.ticket_status,
  latest_summary text,
  similarity float
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    t.id,
    t.subject,
    t.status,
    (
      select tr.summary
      from ticketing.triage_results tr
      where tr.ticket_id = t.id
      order by tr.created_at desc
      limit 1
    ),
    1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
  from ticketing.ticket_embeddings e
  join ticketing.tickets t on t.id = e.ticket_id
  where e.ticket_id <> exclude_ticket_id
    -- Never offered as a duplicate or related ticket (SUP-70).
    and not t.is_access_request
  order by e.embedding operator(extensions.<=>) query_embedding asc
  limit least(match_count, 20);
$$;
