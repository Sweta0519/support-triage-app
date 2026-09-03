-- Comments (with staff-only internal notes), an audit trail of ticket
-- changes, the status-transition/assignment guard rail (RLS is row-level
-- only -- this is what stops a legitimate UPDATE from rewriting the wrong
-- columns), and the agent-queue UPDATE policy that makes atomic claiming
-- possible.

create table ticketing.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references ticketing.tickets (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index ticket_comments_ticket_id_idx on ticketing.ticket_comments (ticket_id);

create table ticketing.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references ticketing.tickets (id) on delete cascade,
  -- null actor = system/AI, not a human action.
  actor_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  from_value text,
  to_value text,
  created_at timestamptz not null default now()
);

create index ticket_events_ticket_id_idx on ticketing.ticket_events (ticket_id);

-- Visibility for a ticket's children is defined once, here, as SECURITY
-- INVOKER (not DEFINER). Because it's invoker, the `tickets` SELECT policy
-- applies automatically to the `exists` check below -- so this function
-- inherits the caller's own ticket visibility instead of needing its own
-- copy of that rule. Making this SECURITY DEFINER would silently bypass
-- ticket RLS for every table that calls it -- don't.
create or replace function ticketing.can_view_ticket(target_ticket_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from ticketing.tickets where id = target_ticket_id
  );
$$;

alter table ticketing.ticket_comments enable row level security;
alter table ticketing.ticket_events enable row level security;

grant select, insert on ticketing.ticket_comments to authenticated;
grant all on ticketing.ticket_comments to service_role;
-- ticket_events has no grants to `authenticated` at all -- every row is
-- written by the SECURITY DEFINER trigger below, which bypasses grants
-- entirely. A client can never insert an event directly.
grant select on ticketing.ticket_events to authenticated;
grant all on ticketing.ticket_events to service_role;

create policy "ticket_comments_select" on ticketing.ticket_comments
  for select
  to authenticated
  using (
    (select ticketing.can_view_ticket(ticket_id))
    and (not is_internal or (select ticketing.is_staff()))
  );

-- Comments are immutable -- no update/delete policy. A customer can only
-- ever post a public comment on a ticket they can see; only staff can post
-- an internal note.
create policy "ticket_comments_insert" on ticketing.ticket_comments
  for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and (select ticketing.can_view_ticket(ticket_id))
    and (not is_internal or (select ticketing.is_staff()))
  );

create policy "ticket_events_select" on ticketing.ticket_events
  for select
  to authenticated
  using ((select ticketing.is_staff()));

-- Agents may update a ticket only while it's unassigned or already theirs
-- (both on the old row via `using` and the new row via `with check`) --
-- that symmetry is what makes claiming atomic: `update tickets set
-- assignee_id = <agent> where id = $1 and assignee_id is null` either hits
-- the row and wins the claim, or hits zero rows because someone else's
-- claim already changed assignee_id, with no read-then-write gap for two
-- agents to race through. Admins bypass the assignee restriction.
create policy "tickets_update_staff" on ticketing.tickets
  for update
  to authenticated
  using (
    (select ticketing.is_admin())
    or (
      (select ticketing.app_role()) = 'agent'
      and (assignee_id = auth.uid() or assignee_id is null)
    )
  )
  with check (
    (select ticketing.is_admin())
    or (
      (select ticketing.app_role()) = 'agent'
      and (assignee_id = auth.uid() or assignee_id is null)
    )
  );

-- RLS is row-level only -- it cannot stop a permitted UPDATE from rewriting
-- the wrong *columns*. This trigger is what actually enforces: customer_id/
-- subject/body are permanently immutable, status can only move along the
-- map below (agents; admins bypass this), timestamps track resolution/
-- closure automatically instead of being client-settable, and every change
-- is recorded to ticket_events. SECURITY DEFINER so it can write
-- ticket_events, which `authenticated` has no insert grant on at all.
create or replace function ticketing.guard_ticket_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_next ticketing.ticket_status[];
begin
  if new.customer_id is distinct from old.customer_id
    or new.subject is distinct from old.subject
    or new.body is distinct from old.body
  then
    raise exception 'customer_id, subject, and body are immutable';
  end if;

  if new.status is distinct from old.status and not (select ticketing.is_admin()) then
    allowed_next := case old.status
      when 'new' then array['assigned', 'in_progress']::ticketing.ticket_status[]
      when 'triaged' then array['assigned', 'in_progress']::ticketing.ticket_status[]
      when 'assigned' then array['in_progress', 'triaged']::ticketing.ticket_status[]
      when 'in_progress' then array['resolved', 'assigned']::ticketing.ticket_status[]
      when 'resolved' then array['closed', 'in_progress']::ticketing.ticket_status[]
      when 'closed' then array[]::ticketing.ticket_status[]
    end;

    if not (new.status = any (allowed_next)) then
      raise exception 'illegal status transition: % -> %', old.status, new.status;
    end if;
  end if;

  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := now();
  elsif new.status is distinct from 'resolved' then
    new.resolved_at := null;
  end if;

  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at := now();
  elsif new.status is distinct from 'closed' then
    new.closed_at := null;
  end if;

  if new.status is distinct from old.status then
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.id, auth.uid(), 'status_changed', old.status::text, new.status::text);
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.id, auth.uid(), 'assignee_changed', old.assignee_id::text, new.assignee_id::text);
  end if;

  return new;
end;
$$;

create trigger tickets_guard_update
  before update on ticketing.tickets
  for each row execute function ticketing.guard_ticket_update();

-- First staff reply drives a ticket's first-response SLA -- stamp it once,
-- from the one place a staff comment can originate, rather than trusting a
-- client-supplied timestamp.
create or replace function ticketing.stamp_first_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_internal and (select ticketing.is_staff()) then
    update ticketing.tickets
    set first_response_at = now()
    where id = new.ticket_id and first_response_at is null;
  end if;
  return new;
end;
$$;

create trigger ticket_comments_stamp_first_response
  after insert on ticketing.ticket_comments
  for each row execute function ticketing.stamp_first_response();
