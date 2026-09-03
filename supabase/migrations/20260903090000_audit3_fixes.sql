-- Fixes from security audit #3 (docs/security/audit-3-fresh-context-rescan.md).
-- W# / S# tags reference findings in that report.

-- ---------------------------------------------------------------------------
-- W1: the AI-derived working state (priority / category / team / triage
-- status) moves off `tickets` into its own staff-only table. Hiding these in
-- the UI was not enforcement: a customer could read their own row's columns
-- through the Data API and use them as a feedback loop for tuning a prompt
-- injection. Now the columns don't exist on any row a customer can select.
-- ---------------------------------------------------------------------------
create table ticketing.ticket_triage_state (
  ticket_id uuid primary key references ticketing.tickets (id) on delete cascade,
  triage_status ticketing.triage_status not null default 'pending',
  priority ticketing.ticket_priority,
  category ticketing.ticket_category,
  team ticketing.ticket_team,
  updated_at timestamptz not null default now()
);

insert into ticketing.ticket_triage_state (ticket_id, triage_status, priority, category, team, updated_at)
select id, triage_status, priority, category, team, updated_at
from ticketing.tickets;

alter table ticketing.ticket_triage_state enable row level security;

-- Staff read it (scoped to tickets they can see); only the service role
-- writes it. Customers get nothing -- not even the row.
grant select on ticketing.ticket_triage_state to authenticated;
grant all on ticketing.ticket_triage_state to service_role;

create policy "ticket_triage_state_select_staff" on ticketing.ticket_triage_state
  for select
  to authenticated
  using (
    (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

create trigger ticket_triage_state_set_updated_at
  before update on ticketing.ticket_triage_state
  for each row execute function ticketing.set_updated_at();

-- Every ticket gets its state row the moment it exists, so the triage
-- pipeline's atomic pending -> processing claim always has a row to claim.
create or replace function ticketing.create_triage_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into ticketing.ticket_triage_state (ticket_id)
  values (new.id)
  on conflict (ticket_id) do nothing;
  return new;
end;
$$;

create trigger tickets_create_triage_state
  after insert on ticketing.tickets
  for each row execute function ticketing.create_triage_state();

-- Remove the columns from tickets. The insert policy referenced them, so it
-- is re-created without them; dropping the columns also removes them from the
-- column-level UPDATE grant, which is re-stated explicitly.
drop policy "tickets_insert_customer" on ticketing.tickets;

alter table ticketing.tickets
  drop column priority,
  drop column category,
  drop column team,
  drop column triage_status;

create policy "tickets_insert_customer" on ticketing.tickets
  for insert
  to authenticated
  with check (
    (select ticketing.app_role()) = 'customer'
    and customer_id = auth.uid()
    and status = 'new'
    and assignee_id is null
    and first_response_at is null
    and resolved_at is null
    and closed_at is null
  );

revoke update on ticketing.tickets from authenticated;
grant update (status, assignee_id) on ticketing.tickets to authenticated;

-- ---------------------------------------------------------------------------
-- W2: limits are a fixed per-action lookup inside the function. The caller
-- supplies only the action name, so there is exactly one bucket per user per
-- action and no way to mint rows with made-up windows.
-- ---------------------------------------------------------------------------
drop function ticketing.consume_rate_limit(text, int, int);

create or replace function ticketing.consume_rate_limit(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_window_seconds int;
  v_key text;
  v_window_start timestamptz;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  case p_action
    when 'create_ticket' then v_limit := 10; v_window_seconds := 3600;
    when 'add_comment'   then v_limit := 30; v_window_seconds := 600;
    when 'rerun_triage'  then v_limit := 5;  v_window_seconds := 600;
    else raise exception 'unknown rate limit action';
  end case;

  v_key := auth.uid()::text || ':' || p_action;
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds
  );

  insert into ticketing.rate_limits (key, window_start, count)
  values (v_key, v_window_start, 1)
  on conflict (key, window_start)
    do update set count = ticketing.rate_limits.count + 1
  returning count into v_count;

  if random() < 0.01 then
    delete from ticketing.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= v_limit;
end;
$$;

revoke execute on function ticketing.consume_rate_limit(text) from public;
grant execute on function ticketing.consume_rate_limit(text) to authenticated, service_role;

create or replace function ticketing.rate_limit_ticket_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is not null and not ticketing.consume_rate_limit('create_ticket') then
    raise exception 'rate_limited:create_ticket';
  end if;
  return new;
end;
$$;

create or replace function ticketing.rate_limit_comment_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is not null and not ticketing.consume_rate_limit('add_comment') then
    raise exception 'rate_limited:add_comment';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- S1: serialise role changes so two admins demoting each other at the same
-- instant can't both pass the "last admin" check and leave zero admins.
-- ---------------------------------------------------------------------------
create or replace function ticketing.admin_set_role(target_user_id uuid, new_role ticketing.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_of_target ticketing.app_role;
begin
  if not ticketing.is_admin() then
    raise exception 'not authorized';
  end if;

  perform pg_advisory_xact_lock(hashtext('ticketing.admin_set_role'));

  if target_user_id = auth.uid() then
    raise exception 'cannot change your own role';
  end if;

  select role into role_of_target from ticketing.profiles where id = target_user_id;
  if role_of_target is null then
    raise exception 'no such user';
  end if;

  if role_of_target = 'admin'
     and new_role <> 'admin'
     and (select count(*) from ticketing.profiles where role = 'admin') <= 1
  then
    raise exception 'cannot demote the last admin';
  end if;

  update ticketing.profiles
  set role = new_role, updated_at = now()
  where id = target_user_id;

  if new_role = 'customer' then
    update ticketing.tickets
    set assignee_id = null
    where assignee_id = target_user_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- S2: closing a resolved ticket must keep its resolution timestamp. Only
-- moving back to an open status clears resolved_at.
-- ---------------------------------------------------------------------------
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

  if new.assignee_id is not null
     and new.assignee_id is distinct from old.assignee_id
     and not exists (
       select 1 from ticketing.profiles p
       where p.id = new.assignee_id and p.role in ('agent', 'admin')
     )
  then
    raise exception 'assignee must be an agent or admin';
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
  elsif new.status in ('new', 'triaged', 'assigned', 'in_progress') then
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

-- ---------------------------------------------------------------------------
-- S7: triggers on the shared auth.users must never abort the other app's
-- writes. A case-variant duplicate email would trip the unique index; treat
-- it as "no profile for this user" rather than failing the signup/update.
-- ---------------------------------------------------------------------------
create or replace function ticketing.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null then
    return new;
  end if;

  begin
    insert into ticketing.profiles (id, email, role)
    values (new.id, new.email, 'customer')
    on conflict (id) do nothing;
  exception when unique_violation then
    null;
  end;
  return new;
end;
$$;

create or replace function ticketing.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and new.email is distinct from old.email then
    begin
      update ticketing.profiles
      set email = new.email, updated_at = now()
      where id = new.id;
    exception when unique_violation then
      null;
    end;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- S10: least-privilege leftovers. Nothing writes or renders full_name, so
-- users get no UPDATE on profiles at all; and a closed ticket is done -- no
-- further comments from anyone.
-- ---------------------------------------------------------------------------
revoke update on ticketing.profiles from authenticated;
drop policy "profiles_update_own" on ticketing.profiles;

drop policy "ticket_comments_insert" on ticketing.ticket_comments;
create policy "ticket_comments_insert" on ticketing.ticket_comments
  for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and (select ticketing.can_view_ticket(ticket_id))
    and (not is_internal or (select ticketing.is_staff()))
    and exists (
      select 1 from ticketing.tickets t
      where t.id = ticket_id and t.status <> 'closed'
    )
  );
