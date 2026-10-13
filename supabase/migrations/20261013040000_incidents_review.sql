-- SUP-42 review fixes (20261013030000 is already applied).
--
-- 1. An incident needs tickets from at least two different customers: one
--    customer's own follow-ups or duplicates are not an outage.
-- 2. detect_incident() also returns the incident's status, so the app can
--    skip the model call when a ticket joins a dismissed incident.
-- 3. Staff may only act on an *open* incident (close it, record a posted
--    update) -- no reopening a closed one, no editing a closed one. The
--    title and AI summary are written by the service role only.

drop function ticketing.detect_incident(uuid, double precision, int, int);

create function ticketing.detect_incident(
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

  if exists (select 1 from ticketing.incident_tickets it where it.ticket_id = p_ticket_id) then
    return;
  end if;
  select e.embedding into v_embedding
  from ticketing.ticket_embeddings e
  join ticketing.tickets t on t.id = e.ticket_id
  where e.ticket_id = p_ticket_id and t.status not in ('resolved', 'closed');
  if v_embedding is null then
    return;
  end if;

  -- A neighbour already in an open or dismissed incident: join it.
  select it.incident_id into v_existing
  from ticketing.ticket_embeddings e
  join ticketing.tickets t on t.id = e.ticket_id
  join ticketing.incident_tickets it on it.ticket_id = t.id
  join ticketing.incidents i on i.id = it.incident_id
  where t.id <> p_ticket_id
    and t.status not in ('resolved', 'closed')
    and t.created_at >= v_since
    and i.status in ('open', 'dismissed')
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
    and 1 - (e.embedding operator(extensions.<=>) v_embedding) >= p_threshold;

  if coalesce(array_length(v_members, 1), 0) < p_min_tickets then
    return;
  end if;
  -- At least two different customers.
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

revoke all on function ticketing.detect_incident(uuid, double precision, int, int) from public;
grant execute on function ticketing.detect_incident(uuid, double precision, int, int) to service_role;

-- Staff act on open incidents only; the title and summary are the service
-- role's.
revoke update on ticketing.incidents from authenticated;
grant update (draft_update, status, closed_at, closed_by, update_posted_at, update_posted_by)
  on ticketing.incidents to authenticated;

drop policy "incidents_staff_update" on ticketing.incidents;
create policy "incidents_staff_update" on ticketing.incidents
  for update to authenticated
  using ((select ticketing.is_staff()) and status = 'open')
  with check (
    (select ticketing.is_staff())
    and (closed_by is null or closed_by = (select auth.uid()))
    and (update_posted_by is null or update_posted_by = (select auth.uid()))
  );
