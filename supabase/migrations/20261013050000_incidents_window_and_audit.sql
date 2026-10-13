-- SUP-42 review fixes, part 2.
--
-- 1. The ticket being checked must itself be inside the window: re-running
--    triage on an old open ticket mustn't pull it into today's burst (and
--    skew first_seen_at / the detection-lag figure by days).
-- 2. Closing an incident must say who closed it and when: a direct update
--    can't set status resolved/dismissed with closed_by or closed_at blank.

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

  if exists (select 1 from ticketing.incident_tickets it where it.ticket_id = p_ticket_id) then
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

drop policy "incidents_staff_update" on ticketing.incidents;
create policy "incidents_staff_update" on ticketing.incidents
  for update to authenticated
  using ((select ticketing.is_staff()) and status = 'open')
  with check (
    (select ticketing.is_staff())
    and (update_posted_by is null or update_posted_by = (select auth.uid()))
    and (
      (status = 'open' and closed_by is null and closed_at is null)
      or (status in ('resolved', 'dismissed') and closed_by = (select auth.uid()) and closed_at is not null)
    )
  );
