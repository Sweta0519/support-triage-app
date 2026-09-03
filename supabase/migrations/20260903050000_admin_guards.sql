-- Admin surface guard rails. Both functions are re-created in full (create or
-- replace) rather than patched, so this file is the complete current
-- definition of each.

-- admin_set_role(): still the only sanctioned path to change a role. Now also
-- refuses two lockout mistakes the UI can't fully prevent, and cleans up
-- after a demotion.
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

  -- An admin demoting themselves is the classic self-lockout.
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

  -- A staff member demoted to customer must not keep tickets assigned to
  -- them -- those rows would become invisible to every agent (the agent
  -- select policy only shows unassigned or own) and only admins could find
  -- them. Unassign so they fall back into the shared queue. This UPDATE
  -- fires guard_ticket_update() with auth.uid() = the acting admin, so the
  -- assignee change is audited against the admin who caused it.
  if new_role = 'customer' then
    update ticketing.tickets
    set assignee_id = null
    where assignee_id = target_user_id;
  end if;
end;
$$;

-- guard_ticket_update(): identical to the previous definition plus one
-- check -- assignee_id, when set, must point at an agent or admin. RLS
-- already stops an *agent* from assigning to anyone but themselves; this is
-- what stops an admin (or a bug in admin code) from assigning a ticket to a
-- customer.
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
