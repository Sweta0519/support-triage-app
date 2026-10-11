-- Review of SUP-25 (PR #24): staff_create_ticket() was only rate limited by
-- the insert trigger, i.e. only when a ticket was actually created. A
-- lookup that failed ('customer_not_found') cost nothing, so an agent
-- could probe any number of email addresses and learn which ones are
-- customers -- exactly what audit S4 keeps from agents by not letting them
-- read customer profiles.
--
-- Now every call is charged up front to the staff member's
-- 'staff_create_ticket' bucket (30/hour), hit or miss, and the insert
-- trigger no longer charges staff-filed tickets a second time.
-- created_by is outside every client column grant, so this function is
-- the only way a row with created_by set can be inserted.
--
-- Also: "Assign to me" on create now writes the same status_changed /
-- assignee_changed events the update guard writes for a claim, so the
-- ticket history shows the assignment.

create or replace function ticketing.rate_limit_ticket_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Staff-filed tickets were already charged by staff_create_ticket().
  if new.created_by is not null then
    return new;
  end if;
  if auth.uid() is not null and not ticketing.consume_rate_limit('create_ticket') then
    raise exception 'rate_limited:create_ticket';
  end if;
  return new;
end;
$$;

create or replace function ticketing.staff_create_ticket(
  p_customer_email text,
  p_subject text,
  p_body text,
  p_assign_to_me boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_customer uuid;
  v_ticket uuid;
begin
  if v_uid is null or not (select ticketing.is_staff()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  -- Charged before the lookup, so a miss costs the same as a hit.
  if not ticketing.consume_rate_limit('staff_create_ticket') then
    raise exception 'rate_limited:staff_create_ticket';
  end if;

  select p.id into v_customer
  from ticketing.profiles p
  where lower(p.email) = lower(btrim(coalesce(p_customer_email, '')))
    and p.role = 'customer';

  if v_customer is null then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  insert into ticketing.tickets (customer_id, subject, body, created_by, assignee_id, status)
  values (
    v_customer,
    btrim(p_subject),
    btrim(p_body),
    v_uid,
    case when p_assign_to_me then v_uid end,
    case when p_assign_to_me then 'assigned'::ticketing.ticket_status else 'new'::ticketing.ticket_status end
  )
  returning id into v_ticket;

  insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
  values (v_ticket, v_uid, 'filed_by_staff', null, null);

  if p_assign_to_me then
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values
      (v_ticket, v_uid, 'status_changed', 'new', 'assigned'),
      (v_ticket, v_uid, 'assignee_changed', null, v_uid::text);
  end if;

  return v_ticket;
end;
$$;
