-- Core ticket entity. No AI triage or agent workflow yet (that's added in
-- later migrations) -- this migration only needs to support customers
-- creating and viewing their own tickets.

create type ticketing.ticket_status as enum (
  'new', 'triaged', 'assigned', 'in_progress', 'resolved', 'closed'
);

create type ticketing.ticket_priority as enum ('low', 'normal', 'high', 'urgent');

create type ticketing.ticket_category as enum (
  'general', 'billing', 'technical', 'bug', 'feature_request', 'account'
);

create type ticketing.ticket_team as enum ('support', 'billing', 'engineering');

create type ticketing.triage_status as enum ('pending', 'processing', 'completed', 'failed');

create table ticketing.tickets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject text not null,
  body text not null,
  status ticketing.ticket_status not null default 'new',
  -- priority/category/team are seeded by the AI triage agent (added later)
  -- and can be overridden by staff -- nullable until triage runs.
  priority ticketing.ticket_priority,
  category ticketing.ticket_category,
  team ticketing.ticket_team,
  assignee_id uuid references auth.users (id) on delete set null,
  triage_status ticketing.triage_status not null default 'pending',
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tickets_customer_id_idx on ticketing.tickets (customer_id);
create index tickets_assignee_id_idx on ticketing.tickets (assignee_id);
create index tickets_status_idx on ticketing.tickets (status);

create or replace function ticketing.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tickets_set_updated_at
  before update on ticketing.tickets
  for each row execute function ticketing.set_updated_at();

alter table ticketing.tickets enable row level security;

grant select, insert on ticketing.tickets to authenticated;
grant all on ticketing.tickets to service_role;

-- customer: own rows only. admin: everything. agent: assigned to them, or
-- unassigned (so an unclaimed ticket is visible to any agent, but a claimed
-- one is only visible to its assignee -- see M1's weak-point note about
-- reassignment visibility, revisited when the agent queue is built).
create policy "tickets_select" on ticketing.tickets
  for select
  to authenticated
  using (
    customer_id = auth.uid()
    or (select ticketing.is_admin())
    or (
      (select ticketing.app_role()) = 'agent'
      and (assignee_id = auth.uid() or assignee_id is null)
    )
  );

-- A customer can only ever insert a ticket in its pristine starting state --
-- they cannot self-assign, pre-set a priority/category/team, or open a
-- ticket as already triaged. Every one of these columns is otherwise only
-- ever written by staff or the AI triage agent (added in later migrations).
create policy "tickets_insert_customer" on ticketing.tickets
  for insert
  to authenticated
  with check (
    customer_id = auth.uid()
    and status = 'new'
    and assignee_id is null
    and triage_status = 'pending'
    and priority is null
    and category is null
    and team is null
  );
