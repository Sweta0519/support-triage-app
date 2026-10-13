-- SUP-42: incident detection. When several customers report the same
-- problem within a short window, their tickets are grouped into one
-- incident: staff see a banner, an incident page, and an AI-drafted status
-- update they can post to every ticket in the group.
--
-- Detection is pure vector maths over the existing ticket_embeddings (no
-- model call). Like triage it is advisory: an incident never changes a
-- ticket's status by itself, and nothing is sent to a customer unless a
-- staff member posts it. Staff-only: customers can't read incidents.

create table ticketing.incidents (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  title text not null constraint incidents_title_length check (char_length(title) between 1 and 200),
  summary text constraint incidents_summary_length check (summary is null or char_length(summary) <= 2000),
  -- The AI's draft of the update staff may post to every ticket; never
  -- sent by itself.
  draft_update text constraint incidents_draft_length check (draft_update is null or char_length(draft_update) <= 2000),
  status text not null default 'open' constraint incidents_status_check check (status in ('open', 'resolved', 'dismissed')),
  -- When the earliest grouped ticket was filed, and when the incident was
  -- detected: the gap is the detection lag shown on Analytics.
  first_seen_at timestamptz not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete set null,
  -- Who posted the incident-wide update, and when (null until someone does).
  update_posted_at timestamptz,
  update_posted_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger incidents_set_updated_at
  before update on ticketing.incidents
  for each row execute function ticketing.set_updated_at();

-- A ticket belongs to at most one incident, ever. A dismissed incident
-- keeps its tickets, so the same false alarm can't re-form a minute later.
create table ticketing.incident_tickets (
  incident_id uuid not null references ticketing.incidents (id) on delete cascade,
  ticket_id uuid not null references ticketing.tickets (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (incident_id, ticket_id),
  constraint incident_tickets_one_per_ticket unique (ticket_id)
);

create index incidents_open_idx on ticketing.incidents (opened_at desc) where status = 'open';

alter table ticketing.incidents enable row level security;
alter table ticketing.incident_tickets enable row level security;

-- Staff read incidents; an agent sees only the grouped tickets they can see
-- (can_view_ticket, under their own RLS). Rows are created only by
-- detect_incident() (service role). Staff may close an incident or edit its
-- text through the column grants below; nobody can insert or delete.
grant select, update on ticketing.incidents to authenticated;
revoke update on ticketing.incidents from authenticated;
grant update (title, draft_update, status, closed_at, closed_by, update_posted_at, update_posted_by)
  on ticketing.incidents to authenticated;
grant select on ticketing.incident_tickets to authenticated;
grant all on ticketing.incidents to service_role;
grant all on ticketing.incident_tickets to service_role;

create policy "incidents_staff_select" on ticketing.incidents
  for select to authenticated using ((select ticketing.is_staff()));
create policy "incidents_staff_update" on ticketing.incidents
  for update to authenticated
  using ((select ticketing.is_staff()))
  with check (
    (select ticketing.is_staff())
    and (closed_by is null or closed_by = (select auth.uid()))
    and (update_posted_by is null or update_posted_by = (select auth.uid()))
  );
create policy "incident_tickets_staff_select" on ticketing.incident_tickets
  for select to authenticated
  using ((select ticketing.is_staff()) and (select ticketing.can_view_ticket(ticket_id)));

-- An incident whose last ticket is deleted (customer account deletion, the
-- test cleanup) goes too, rather than lingering empty.
create or replace function ticketing.drop_empty_incident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from ticketing.incident_tickets where incident_id = old.incident_id) then
    delete from ticketing.incidents where id = old.incident_id;
  end if;
  return old;
end;
$$;

revoke all on function ticketing.drop_empty_incident() from public;

create trigger incident_tickets_drop_empty
  after delete on ticketing.incident_tickets
  for each row execute function ticketing.drop_empty_incident();

-- Detection for one newly triaged ticket. Its neighbours: other open
-- tickets (not resolved or closed) filed within the window, whose embedding
-- is at least p_threshold similar. If a neighbour is already in an open or
-- dismissed incident, the ticket joins that one (a dismissed one silently
-- absorbs it). Otherwise, if the ticket and its ungrouped neighbours reach
-- p_min_tickets, a new incident opens with all of them. One detection at a
-- time (advisory lock), so two tickets triaged together can't open two
-- incidents for the same burst. Service role only.
create or replace function ticketing.detect_incident(
  p_ticket_id uuid,
  p_threshold double precision,
  p_window_minutes int,
  p_min_tickets int
)
returns table (incident_id uuid, created boolean, ticket_count int)
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

  -- Already grouped, or not open, or no embedding: nothing to do.
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
      select v_existing, false, (select count(*)::int from ticketing.incident_tickets x where x.incident_id = v_existing);
    return;
  end if;

  -- Otherwise: the ticket and its ungrouped neighbours.
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

  insert into ticketing.incidents (title, first_seen_at)
  select 'Possible incident', min(t.created_at) from ticketing.tickets t where t.id = any (v_members)
  returning id into v_incident;
  insert into ticketing.incident_tickets (incident_id, ticket_id)
  select v_incident, m from unnest(v_members) as m;

  return query select v_incident, true, array_length(v_members, 1);
end;
$$;

revoke all on function ticketing.detect_incident(uuid, double precision, int, int) from public;
grant execute on function ticketing.detect_incident(uuid, double precision, int, int) to service_role;
