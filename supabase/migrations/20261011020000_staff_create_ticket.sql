-- SUP-25: staff can file a ticket on behalf of a customer (a phone call, a
-- chat, a forwarded email). Until now only a customer could insert a
-- ticket, for themselves: column grant (customer_id, subject, body) plus
-- the tickets_insert_customer policy. That stays exactly as it is; staff
-- go through one SECURITY DEFINER function instead.

-- Who filed the ticket when it wasn't the customer. Null = the customer
-- filed it themselves. Not in authenticated's INSERT/UPDATE column grants,
-- so no client can set or change it.
alter table ticketing.tickets
  add column created_by uuid references auth.users (id) on delete set null;

-- Staff log tickets in bursts (a busy phone shift), so they get their own
-- bucket instead of sharing a customer's 10/hour. Same redefine-the-whole-
-- function pattern as every earlier case addition.
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
    when 'staff_create_ticket' then v_limit := 30; v_window_seconds := 3600;
    when 'add_comment'   then v_limit := 30; v_window_seconds := 600;
    when 'rerun_triage'  then v_limit := 5;  v_window_seconds := 600;
    when 'assistant_message' then v_limit := 20; v_window_seconds := 600;
    when 'save_note'     then v_limit := 30; v_window_seconds := 600;
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

-- The insert trigger charges whoever is signed in. A staff-filed ticket is
-- charged to the staff member's own bucket, never to the customer's.
create or replace function ticketing.rate_limit_ticket_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_action text := case when new.created_by is not null then 'staff_create_ticket' else 'create_ticket' end;
begin
  if auth.uid() is not null and not ticketing.consume_rate_limit(v_action) then
    raise exception 'rate_limited:%', v_action;
  end if;
  return new;
end;
$$;

-- The only way staff create a ticket. SECURITY DEFINER because staff have
-- no INSERT path on tickets and can't read customer profiles (audit S4);
-- every check is therefore explicit here:
--   * caller must be staff (re-read from profiles, not a JWT claim)
--   * the email must belong to an existing *customer* account -- anything
--     else (unknown, or a staff address) is the same 'customer_not_found',
--     and the function never returns anything about the customer
--   * subject/body limits are the tickets table's own check constraints
--   * rate limited via the insert trigger ('staff_create_ticket')
-- p_assign_to_me makes the caller the assignee straight away (status
-- 'assigned'), for the agent who took the call.
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

  return v_ticket;
end;
$$;

revoke all on function ticketing.staff_create_ticket(text, text, text, boolean) from public;
grant execute on function ticketing.staff_create_ticket(text, text, text, boolean) to authenticated;
