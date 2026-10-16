-- SUP-70: access requests never form or join a possible incident.
--
-- Access-request tickets (SUP-58) are worded almost alike, so their
-- embeddings are close, and three within an hour looked like an incident.
-- They aren't problem reports. detect_incident() is as in
-- 20261013050000_incidents_window_and_audit.sql (its latest version), except that a ticket some profile's
-- access_request_ticket_id points at is skipped, and never counted as a
-- neighbour.

create index if not exists profiles_access_request_ticket_idx
  on ticketing.profiles (access_request_ticket_id)
  where access_request_ticket_id is not null;

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
     or exists (select 1 from ticketing.profiles ar where ar.access_request_ticket_id = p_ticket_id) then
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
    and not exists (select 1 from ticketing.profiles ar where ar.access_request_ticket_id = t.id)
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
    and not exists (select 1 from ticketing.profiles ar where ar.access_request_ticket_id = t.id)
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

-- Access requests already grouped come out. An incident that held them and
-- is left with fewer than two tickets was only ever access requests (or one
-- real ticket), so it goes too. Other incidents are left alone.
with removed as (
  delete from ticketing.incident_tickets it
  using ticketing.profiles ar
  where ar.access_request_ticket_id = it.ticket_id
  returning it.incident_id
)
delete from ticketing.incidents i
where i.id in (select incident_id from removed)
  and (
    select count(*) from ticketing.incident_tickets x
    where x.incident_id = i.id
      and x.ticket_id not in (select ar.access_request_ticket_id from ticketing.profiles ar where ar.access_request_ticket_id is not null)
  ) < 2;
