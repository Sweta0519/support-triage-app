-- Fixes from security audit #1 (docs/security/audit-1-initial.md). The W# /
-- S# tags reference findings in that report.

-- W1 / S5: size limits live in the database, not only in the Server Action.
alter table ticketing.tickets
  add constraint tickets_subject_length check (char_length(subject) between 1 and 200),
  add constraint tickets_body_length check (char_length(body) between 1 and 20000);

alter table ticketing.ticket_comments
  add constraint ticket_comments_body_length check (char_length(body) between 1 and 10000);

alter table ticketing.profiles
  add constraint profiles_full_name_length check (full_name is null or char_length(full_name) <= 120);

-- S2 / S7: guard the window argument and prune old counters opportunistically
-- (about 1 in 100 calls deletes windows older than a day).
create or replace function ticketing.consume_rate_limit(
  p_action text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_window_start timestamptz;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_window_seconds <= 0 or p_limit <= 0 then
    raise exception 'invalid rate limit parameters';
  end if;

  v_key := auth.uid()::text || ':' || p_action;
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into ticketing.rate_limits (key, window_start, count)
  values (v_key, v_window_start, 1)
  on conflict (key, window_start)
    do update set count = ticketing.rate_limits.count + 1
  returning count into v_count;

  if random() < 0.01 then
    delete from ticketing.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

-- W1: enforce the per-user limits where the row is actually inserted, so a
-- direct PostgREST call with a session token is limited exactly like the
-- app. auth.uid() is null for service_role, which is never limited. The
-- app maps the 'rate_limited:*' message to its friendly form error.
create or replace function ticketing.rate_limit_ticket_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not ticketing.consume_rate_limit('create_ticket', 10, 3600)
  then
    raise exception 'rate_limited:create_ticket';
  end if;
  return new;
end;
$$;

create trigger tickets_rate_limit_insert
  before insert on ticketing.tickets
  for each row execute function ticketing.rate_limit_ticket_insert();

create or replace function ticketing.rate_limit_comment_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not ticketing.consume_rate_limit('add_comment', 30, 600)
  then
    raise exception 'rate_limited:add_comment';
  end if;
  return new;
end;
$$;

create trigger ticket_comments_rate_limit_insert
  before insert on ticketing.ticket_comments
  for each row execute function ticketing.rate_limit_comment_insert();

-- W2: events follow the same visibility rule as every other child table.
drop policy "ticket_events_select" on ticketing.ticket_events;
create policy "ticket_events_select" on ticketing.ticket_events
  for select
  to authenticated
  using (
    (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

-- W3: email is identity in the admin UI; users must not be able to rewrite
-- it. Keep it in sync from auth.users instead, and make it unique.
revoke update (email) on ticketing.profiles from authenticated;

create unique index profiles_email_lower_idx on ticketing.profiles (lower(email));

create or replace function ticketing.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and new.email is distinct from old.email then
    update ticketing.profiles
    set email = new.email, updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated_ticketing
  after update of email on auth.users
  for each row execute function ticketing.sync_profile_email();

-- W6: staff may only ever touch the columns the workflow needs. Timestamps,
-- triage_status, customer_id, subject and body become unreachable for
-- `authenticated` at the privilege level, independent of the trigger.
revoke update on ticketing.tickets from authenticated;
grant update (status, assignee_id, priority, category, team) on ticketing.tickets to authenticated;

-- S4: agents only ever need to see other staff (for "Assigned to ..."); only
-- admins need every profile (for /admin/users).
drop policy "profiles_select_staff" on ticketing.profiles;
create policy "profiles_select_staff" on ticketing.profiles
  for select
  to authenticated
  using (
    (select ticketing.is_admin())
    or ((select ticketing.is_staff()) and role in ('agent', 'admin'))
  );

-- S2: stop future functions in this schema from getting PUBLIC EXECUTE by
-- default. Existing functions keep their explicit grants to `authenticated`
-- (RLS policies evaluate helper functions as the caller and need them).
alter default privileges in schema ticketing revoke execute on functions from public;
