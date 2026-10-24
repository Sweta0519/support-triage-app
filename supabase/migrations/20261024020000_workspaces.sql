-- SUP-81 (part 1 of SUP-78): workspaces.
--
-- Until now the app held exactly one support team. This adds the tenant
-- boundary without changing what anyone sees: every existing row moves into
-- one default workspace, and every new user still lands there (part 2 adds
-- sign-up that creates a workspace and join links for customers).
--
-- The shape:
--   * ticketing.workspaces, and ticketing.workspace_members (user_id is the
--     primary key: one workspace per person, decided 2026-10-24).
--   * The role moves from profiles.role to workspace_members.role.
--     app_role() / is_staff() / is_admin() read the membership, still from
--     the database on every call, never from a JWT claim, and
--     admin_set_role() is still the only write path, now inside the
--     caller's workspace (the last-admin rule is per workspace).
--   * workspace_id on tickets, labels and incidents (the roots), and on every
--     table that hangs off a ticket. A child's workspace_id is always copied
--     from its ticket by a BEFORE INSERT trigger (never taken from the
--     client), and a composite foreign key to tickets(id, workspace_id)
--     makes a mismatch impossible, not just unlikely.
--   * Every RLS policy also checks workspace_id = current_workspace_id().
--   * SECURITY DEFINER functions bypass RLS, so each one filters by
--     workspace itself. The service-role AI paths (match_tickets,
--     match_triage_corrections, detect_incident) take the workspace from the
--     ticket being triaged, so a candidate from another workspace can never
--     come back.
--
-- Personal tables (notes, documents, assistant_*, access_tokens) stay
-- owner-scoped (owner = auth.uid()): a person has exactly one workspace, so
-- their own rows are already inside it.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table ticketing.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint workspaces_name_length check (char_length(btrim(name)) between 1 and 80),
  -- The workspace that held everything before SUP-78. New sign-ups join it
  -- until part 2 (SUP-82); "Get in touch" requests stay with it.
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index workspaces_one_default on ticketing.workspaces (is_default) where is_default;

insert into ticketing.workspaces (name, is_default) values ('Support Triage', true);

create table ticketing.workspace_members (
  -- The primary key: one workspace per person.
  user_id uuid primary key references ticketing.profiles (id) on delete cascade,
  workspace_id uuid not null references ticketing.workspaces (id) on delete cascade,
  role ticketing.app_role not null default 'customer',
  created_at timestamptz not null default now()
);

create index workspace_members_workspace_role_idx on ticketing.workspace_members (workspace_id, role);

insert into ticketing.workspace_members (user_id, workspace_id, role)
select p.id, w.id, p.role
from ticketing.profiles p
cross join ticketing.workspaces w
where w.is_default;

alter table ticketing.workspaces enable row level security;
alter table ticketing.workspace_members enable row level security;

revoke all on ticketing.workspaces from anon, authenticated;
revoke all on ticketing.workspace_members from anon, authenticated;
grant select on ticketing.workspaces to authenticated;
grant select on ticketing.workspace_members to authenticated;
grant all on ticketing.workspaces to service_role;
grant all on ticketing.workspace_members to service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- The caller's workspace. DEFINER for the same reason as is_staff(): policies
-- on workspace_members call it without recursing into themselves.
create function ticketing.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id from ticketing.workspace_members m where m.user_id = auth.uid();
$$;

create or replace function ticketing.app_role()
returns ticketing.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from ticketing.workspace_members m where m.user_id = auth.uid();
$$;

create or replace function ticketing.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from ticketing.workspace_members m
    where m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

create or replace function ticketing.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from ticketing.workspace_members m
    where m.user_id = auth.uid() and m.role in ('agent', 'admin')
  );
$$;

revoke all on function ticketing.current_workspace_id() from public;
grant execute on function ticketing.current_workspace_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. workspace_id on the roots and on every ticket child
-- ---------------------------------------------------------------------------

alter table ticketing.tickets add column workspace_id uuid references ticketing.workspaces (id) on delete cascade;
alter table ticketing.labels add column workspace_id uuid references ticketing.workspaces (id) on delete cascade;
alter table ticketing.incidents add column workspace_id uuid references ticketing.workspaces (id) on delete cascade;

alter table ticketing.ticket_comments add column workspace_id uuid;
alter table ticketing.ticket_events add column workspace_id uuid;
alter table ticketing.triage_results add column workspace_id uuid;
alter table ticketing.ticket_triage_state add column workspace_id uuid;
alter table ticketing.ticket_embeddings add column workspace_id uuid;
alter table ticketing.ticket_labels add column workspace_id uuid;
alter table ticketing.ticket_flags add column workspace_id uuid;
alter table ticketing.ticket_ratings add column workspace_id uuid;
alter table ticketing.shared_ticket_summaries add column workspace_id uuid;
alter table ticketing.incident_tickets add column workspace_id uuid;

-- Nullable: a profile can exist a moment before its membership does.
alter table ticketing.profile_cards add column workspace_id uuid references ticketing.workspaces (id) on delete set null;

do $$
declare
  v_default uuid := (select id from ticketing.workspaces where is_default);
  t text;
begin
  foreach t in array array[
    'tickets', 'labels', 'incidents', 'ticket_comments', 'ticket_events', 'triage_results',
    'ticket_triage_state', 'ticket_embeddings', 'ticket_labels', 'ticket_flags', 'ticket_ratings',
    'shared_ticket_summaries', 'incident_tickets', 'profile_cards'
  ] loop
    execute format('update ticketing.%I set workspace_id = $1', t) using v_default;
    if t <> 'profile_cards' then
      execute format('alter table ticketing.%I alter column workspace_id set not null', t);
    end if;
  end loop;
end;
$$;

-- Targets for the composite foreign keys below.
alter table ticketing.tickets add constraint tickets_id_workspace_key unique (id, workspace_id);
alter table ticketing.labels add constraint labels_id_workspace_key unique (id, workspace_id);
alter table ticketing.incidents add constraint incidents_id_workspace_key unique (id, workspace_id);

-- A child's (ticket_id, workspace_id) must be its ticket's.
do $$
declare
  t text;
begin
  foreach t in array array[
    'ticket_comments', 'ticket_events', 'triage_results', 'ticket_triage_state', 'ticket_embeddings',
    'ticket_labels', 'ticket_flags', 'ticket_ratings', 'shared_ticket_summaries', 'incident_tickets'
  ] loop
    execute format(
      'alter table ticketing.%I add constraint %I foreign key (ticket_id, workspace_id) references ticketing.tickets (id, workspace_id) on delete cascade',
      t, t || '_ticket_workspace_fkey'
    );
  end loop;
end;
$$;

-- A label on a ticket, a ticket in an incident, and the AI's duplicate pick
-- are all in the ticket's own workspace.
alter table ticketing.ticket_labels
  add constraint ticket_labels_label_workspace_fkey
  foreign key (label_id, workspace_id) references ticketing.labels (id, workspace_id) on delete cascade;
alter table ticketing.incident_tickets
  add constraint incident_tickets_incident_workspace_fkey
  foreign key (incident_id, workspace_id) references ticketing.incidents (id, workspace_id) on delete cascade;
alter table ticketing.triage_results
  add constraint triage_results_duplicate_workspace_fkey
  foreign key (duplicate_of, workspace_id) references ticketing.tickets (id, workspace_id) on delete set null (duplicate_of);

-- Label names are unique per workspace now, not across the app.
drop index ticketing.labels_name_unique;
create unique index labels_name_unique on ticketing.labels (workspace_id, lower(btrim(name)));

create index tickets_workspace_created_idx on ticketing.tickets (workspace_id, created_at desc);
create index incidents_workspace_idx on ticketing.incidents (workspace_id);
create index ticket_embeddings_workspace_idx on ticketing.ticket_embeddings (workspace_id);
create index ticket_triage_state_workspace_idx on ticketing.ticket_triage_state (workspace_id);

-- Readable (pages select whole rows). Never taken from a client: the
-- triggers below always overwrite it on insert, and on update tickets'
-- guard trigger refuses a change (the other tables' update grants don't
-- name it).
grant select (workspace_id) on
  ticketing.tickets, ticketing.labels, ticketing.incidents, ticketing.ticket_comments,
  ticketing.ticket_events, ticketing.triage_results, ticketing.ticket_triage_state,
  ticketing.ticket_labels, ticketing.ticket_flags, ticketing.ticket_ratings,
  ticketing.shared_ticket_summaries, ticketing.incident_tickets, ticketing.profile_cards
to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Triggers that set workspace_id
-- ---------------------------------------------------------------------------

-- A ticket belongs to its customer's workspace, whoever files it (the
-- customer, staff through staff_create_ticket(), or the service role). An
-- assignee given at insert must be staff in that same workspace.
create function ticketing.set_ticket_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.workspace_id into new.workspace_id
  from ticketing.workspace_members m
  where m.user_id = new.customer_id;
  if new.workspace_id is null then
    raise exception 'customer has no workspace' using errcode = '42501';
  end if;

  if new.assignee_id is not null and not exists (
    select 1 from ticketing.workspace_members m
    where m.user_id = new.assignee_id and m.workspace_id = new.workspace_id and m.role in ('agent', 'admin')
  ) then
    raise exception 'assignee must be an agent or admin';
  end if;
  return new;
end;
$$;

-- "000" sorts before every other BEFORE INSERT trigger on tickets, so the
-- rate limit and the daily cap already see the workspace.
create trigger tickets_000_set_workspace
  before insert on ticketing.tickets
  for each row execute function ticketing.set_ticket_workspace();

-- Every ticket child takes its ticket's workspace. DEFINER so it can read
-- the ticket whatever the caller's RLS; the child's own insert policy and
-- the composite foreign key still decide whether the row may exist.
create function ticketing.set_workspace_from_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select t.workspace_id into new.workspace_id from ticketing.tickets t where t.id = new.ticket_id;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'ticket_comments', 'ticket_events', 'triage_results', 'ticket_triage_state', 'ticket_embeddings',
    'ticket_labels', 'ticket_flags', 'ticket_ratings', 'shared_ticket_summaries', 'incident_tickets'
  ] loop
    execute format(
      'create trigger %I before insert or update of ticket_id, workspace_id on ticketing.%I for each row execute function ticketing.set_workspace_from_ticket()',
      t || '_000_set_workspace', t
    );
  end loop;
end;
$$;

-- The model may only name tickets from the server's candidate list (which
-- match_tickets() already keeps inside the workspace). This is the database
-- saying the same: a related ticket from another workspace can't be stored.
-- duplicate_of is covered by its composite foreign key.
create function ticketing.check_triage_result_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(new.related_ticket_ids) as r(id)
    left join ticketing.tickets t on t.id = r.id
    where t.workspace_id is distinct from new.workspace_id
  ) then
    raise exception 'related ticket outside the workspace' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger triage_results_001_check_workspace
  before insert or update of related_ticket_ids, workspace_id on ticketing.triage_results
  for each row execute function ticketing.check_triage_result_workspace();

-- A signed-in staff member's label is always in their own workspace. The
-- service role (tests, scripts) may name one, else it's the creator's.
create function ticketing.set_label_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.workspace_id := ticketing.current_workspace_id();
  elsif new.workspace_id is null then
    select m.workspace_id into new.workspace_id from ticketing.workspace_members m where m.user_id = new.created_by;
  end if;
  return new;
end;
$$;

create trigger labels_000_set_workspace
  before insert on ticketing.labels
  for each row execute function ticketing.set_label_workspace();

revoke all on function ticketing.set_ticket_workspace() from public;
revoke all on function ticketing.set_workspace_from_ticket() from public;
revoke all on function ticketing.check_triage_result_workspace() from public;
revoke all on function ticketing.set_label_workspace() from public;

-- ---------------------------------------------------------------------------
-- 5. Profiles, cards and membership
-- ---------------------------------------------------------------------------

-- Cards carry is_staff and the workspace from the membership.
create or replace function ticketing.sync_profile_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into ticketing.profile_cards (id, display_name, avatar_path, is_staff, workspace_id)
  select new.id, new.full_name, new.avatar_path, coalesce(m.role in ('agent', 'admin'), false), m.workspace_id
  from (select 1) as one
  left join ticketing.workspace_members m on m.user_id = new.id
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_path = excluded.avatar_path,
        is_staff = excluded.is_staff,
        workspace_id = excluded.workspace_id;
  return new;
end;
$$;

-- The old trigger listed profiles.role, which section 10 drops. Role
-- changes now reach the card through workspace_members_sync_card below.
drop trigger profiles_sync_card on ticketing.profiles;
create trigger profiles_sync_card
  after insert or update of full_name, avatar_path on ticketing.profiles
  for each row execute function ticketing.sync_profile_card();

create function ticketing.sync_member_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update ticketing.profile_cards
  set is_staff = new.role in ('agent', 'admin'), workspace_id = new.workspace_id
  where id = new.user_id;
  return new;
end;
$$;

create trigger workspace_members_sync_card
  after insert or update of role, workspace_id on ticketing.workspace_members
  for each row execute function ticketing.sync_member_card();

revoke all on function ticketing.sync_member_card() from public;

-- New users join the default workspace as customers until part 2 (SUP-82)
-- gives sign-up its own choice. The role is still hard-coded, never read
-- from sign-up metadata.
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
    insert into ticketing.profiles (id, email)
    values (new.id, new.email)
    on conflict (id) do nothing;
    insert into ticketing.workspace_members (user_id, workspace_id, role)
    select new.id, w.id, 'customer' from ticketing.workspaces w where w.is_default
    on conflict (user_id) do nothing;
  exception when unique_violation then
    raise warning 'ticketing.handle_new_user: email % already used by another profile (auth.users id %)', new.email, new.id;
  end;
  return new;
end;
$$;

-- Now returns the profile with the membership's role and workspace_id
-- merged in (jsonb), so callers read profile.role exactly as before.
drop function ticketing.ensure_profile();

create function ticketing.ensure_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then
    raise exception 'an email address is required to use this app';
  end if;

  insert into ticketing.profiles (id, email)
  values (auth.uid(), v_email)
  on conflict (id) do nothing;
  insert into ticketing.workspace_members (user_id, workspace_id, role)
  select auth.uid(), w.id, 'customer' from ticketing.workspaces w where w.is_default
  on conflict (user_id) do nothing;

  select to_jsonb(p) || jsonb_build_object('role', m.role, 'workspace_id', m.workspace_id)
  into result
  from ticketing.profiles p
  join ticketing.workspace_members m on m.user_id = p.id
  where p.id = auth.uid();
  return result;
end;
$$;

revoke all on function ticketing.ensure_profile() from public;
grant execute on function ticketing.ensure_profile() to authenticated;

-- The only path to change a role, inside the caller's own workspace: a
-- target in another workspace is "no such user". The lock and the
-- last-admin count are per workspace.
create or replace function ticketing.admin_set_role(target_user_id uuid, new_role ticketing.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := ticketing.current_workspace_id();
  role_of_target ticketing.app_role;
begin
  if not ticketing.is_admin() then
    raise exception 'not authorized';
  end if;

  perform pg_advisory_xact_lock(hashtext('ticketing.admin_set_role:' || v_ws::text));

  if target_user_id = auth.uid() then
    raise exception 'cannot change your own role';
  end if;

  select m.role into role_of_target
  from ticketing.workspace_members m
  where m.user_id = target_user_id and m.workspace_id = v_ws;
  if role_of_target is null then
    raise exception 'no such user';
  end if;

  if role_of_target = 'admin'
     and new_role <> 'admin'
     and (select count(*) from ticketing.workspace_members m where m.workspace_id = v_ws and m.role = 'admin') <= 1
  then
    raise exception 'cannot demote the last admin';
  end if;

  update ticketing.workspace_members
  set role = new_role
  where user_id = target_user_id;

  update ticketing.profiles
  set updated_at = now()
  where id = target_user_id;

  -- Making someone staff answers their access request, if one is waiting
  -- (SUP-68), wherever the role was changed: decide_access_request() or the
  -- Users page. Otherwise it would stay in the admins' Waiting list.
  if new_role in ('agent', 'admin') then
    update ticketing.profiles
    set access_request_status = 'granted', access_decided_by = auth.uid(), access_decided_at = now()
    where id = target_user_id and access_request_status = 'pending';
  end if;

  if new_role = 'customer' then
    update ticketing.tickets
    set assignee_id = null
    where assignee_id = target_user_id and workspace_id = v_ws;
  end if;
end;
$$;

-- The last admin of a workspace can't delete their account.
create or replace function ticketing.guard_last_admin_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member ticketing.workspace_members%rowtype;
begin
  select * into v_member from ticketing.workspace_members m where m.user_id = old.id;
  if v_member.role = 'admin' and not exists (
    select 1 from ticketing.workspace_members m
    where m.workspace_id = v_member.workspace_id and m.role = 'admin' and m.user_id <> old.id
  ) then
    raise exception 'last_admin: the only admin cannot delete their account';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. DEFINER functions: each filters by the caller's workspace itself
-- ---------------------------------------------------------------------------

create or replace function ticketing.admin_workload()
returns table (id uuid, email text, full_name text, avatar_path text, role ticketing.app_role, presence text, daily_case_cap integer, timezone text, assigned_today integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
    select p.id, p.email, p.full_name, p.avatar_path, m.role, p.presence,
           p.daily_case_cap, p.timezone, ticketing.cases_assigned_today(p.id)
    from ticketing.profiles p
    join ticketing.workspace_members m on m.user_id = p.id
    where m.workspace_id = ticketing.current_workspace_id()
      and m.role in ('agent', 'admin');
end;
$$;

create or replace function ticketing.admin_set_workload(p_target uuid, p_cap integer, p_timezone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_cap is not null and (p_cap < 0 or p_cap > 200) then
    raise exception 'invalid_cap' using errcode = '22023';
  end if;

  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;

  update ticketing.profiles p
  set daily_case_cap = p_cap,
      timezone = p_timezone,
      updated_at = now()
  from ticketing.workspace_members m
  where p.id = p_target
    and m.user_id = p.id
    and m.workspace_id = ticketing.current_workspace_id()
    and m.role in ('agent', 'admin');

  if not found then
    raise exception 'not_staff' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function ticketing.decide_access_request(p_user uuid, p_grant boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := ticketing.current_workspace_id();
  v_ticket uuid;
  v_role ticketing.app_role;
  v_status ticketing.ticket_status;
  v_outcome text := case when p_grant then 'granted' else 'declined' end;
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'own_request' using errcode = '42501';
  end if;

  -- admin_set_role()'s lock first, then the row: the order a plain role
  -- change takes them in, so the two can't deadlock.
  perform pg_advisory_xact_lock(hashtext('ticketing.admin_set_role:' || v_ws::text));

  select p.access_request_ticket_id, m.role into v_ticket, v_role
  from ticketing.profiles p
  join ticketing.workspace_members m on m.user_id = p.id
  where p.id = p_user and p.access_request_status = 'pending' and m.workspace_id = v_ws
  for update of p;
  if not found then
    raise exception 'not_pending' using errcode = 'P0002';
  end if;

  -- Only a customer becomes an agent. Someone already on the staff keeps
  -- their role (an admin is never demoted by granting their request).
  if p_grant and v_role = 'customer' then
    perform ticketing.admin_set_role(p_user, 'agent');
  end if;

  update ticketing.profiles
  set access_request_status = v_outcome, access_decided_by = auth.uid(), access_decided_at = now()
  where id = p_user;

  select t.status into v_status from ticketing.tickets t where t.id = v_ticket and t.workspace_id = v_ws;
  if v_status is not null and v_status <> 'closed' then
    insert into ticketing.ticket_comments (ticket_id, author_id, body, is_internal)
    values (
      v_ticket,
      auth.uid(),
      case
        when p_grant and v_role <> 'customer'
          then 'Thanks for getting in touch. You''re already on our support team, so there''s nothing more to do here.'
        when p_grant
          then 'Welcome to our support team: you''ve been added as an agent. Reload the app to see the queue.'
        else 'Thanks for getting in touch. We''ll follow up here if there''s anything more, and you can keep filing and following your tickets any time.'
      end,
      false
    );
    if v_status <> 'resolved' then
      update ticketing.tickets set status = 'resolved' where id = v_ticket;
    end if;
  end if;

  return v_outcome;
end;
$$;

create or replace function ticketing.file_access_request()
returns table (ticket_id uuid, ticket_number bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_request jsonb;
  v_team text;
  v_size text;
  v_purpose text;
  v_id uuid;
  v_number bigint;
begin
  if v_uid is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Get-or-create first: code never assumes the profile exists.
  perform ticketing.ensure_profile();

  select u.raw_user_meta_data -> 'access_request' into v_request
  from auth.users u
  where u.id = v_uid;
  if v_request is null or jsonb_typeof(v_request) <> 'object' then
    return;
  end if;

  -- Only a customer who hasn't filed one yet; the lock makes it once.
  perform 1 from ticketing.profiles p
  join ticketing.workspace_members m on m.user_id = p.id
  where p.id = v_uid and m.role = 'customer' and p.access_requested_at is null
  for update of p;
  if not found then
    return;
  end if;

  -- The answers are the visitor's own text: trimmed and capped here too.
  v_team := left(btrim(coalesce(v_request ->> 'team', '')), 100);
  v_size := left(btrim(coalesce(v_request ->> 'size', '')), 20);
  v_purpose := left(btrim(coalesce(v_request ->> 'purpose', '')), 2000);

  insert into ticketing.tickets (customer_id, subject, body, is_access_request)
  values (
    v_uid,
    case when v_team = '' then 'Getting in touch' else 'Getting in touch: ' || v_team end,
    'Getting in touch about Support Triage.' || chr(10) || chr(10)
      || 'Team: ' || coalesce(nullif(v_team, ''), '(not given)') || chr(10)
      || 'Team size: ' || coalesce(nullif(v_size, ''), '(not given)') || chr(10)
      || 'What we''d use it for: ' || coalesce(nullif(v_purpose, ''), '(not given)'),
    true
  )
  returning id, number into v_id, v_number;

  update ticketing.profiles
  set access_requested_at = now(), access_request_ticket_id = v_id, access_request_status = 'pending'
  where id = v_uid;
  -- Filed: the answers live on in the ticket, so drop the copy kept with
  -- the sign-in (it also rode along in every session token).
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'access_request' where id = v_uid;

  return query select v_id, v_number;
end;
$$;

-- Workspace is immutable, and an assignee must be staff in the ticket's own
-- workspace. Everything else is as before.
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

  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id is immutable';
  end if;

  if new.assignee_id is not null
     and new.assignee_id is distinct from old.assignee_id
     and not exists (
       select 1 from ticketing.workspace_members m
       where m.user_id = new.assignee_id
         and m.workspace_id = new.workspace_id
         and m.role in ('agent', 'admin')
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

-- Staff file only for a customer of their own workspace; an email from
-- another workspace is "not found", exactly like an unknown one.
create or replace function ticketing.staff_create_ticket(p_customer_email text, p_subject text, p_body text, p_assign_to_me boolean)
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
  join ticketing.workspace_members m on m.user_id = p.id
  where lower(p.email) = lower(btrim(coalesce(p_customer_email, '')))
    and m.role = 'customer'
    and m.workspace_id = ticketing.current_workspace_id();

  -- Not found returns null instead of raising: an exception would roll
  -- back the whole call, including the rate-limit charge above, and make
  -- misses free again.
  if v_customer is null then
    return null;
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

-- Visibility as before (admins: any ticket; agents: unassigned or their
-- own), now also inside the caller's workspace.
create or replace function ticketing.review_triage(p_ticket_id uuid, p_result_id uuid, p_priority ticketing.ticket_priority, p_category ticketing.ticket_category, p_team ticketing.ticket_team, p_reviewed_at timestamp with time zone)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old ticketing.ticket_triage_state%rowtype;
  v_ai ticketing.triage_results%rowtype;
  v_latest uuid;
  v_outcome text;
begin
  if v_uid is null or not (select ticketing.is_staff()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_priority is null or p_category is null or p_team is null then
    raise exception 'priority, category and team are all required' using errcode = '22004';
  end if;

  if not exists (
    select 1 from ticketing.tickets t
    where t.id = p_ticket_id
      and t.workspace_id = ticketing.current_workspace_id()
      and (
        (select ticketing.is_admin())
        or t.assignee_id = v_uid
        or t.assignee_id is null
      )
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select id into v_latest
  from ticketing.triage_results
  where ticket_id = p_ticket_id
  order by created_at desc
  limit 1;

  if p_result_id is distinct from v_latest then
    raise exception 'stale_triage';
  end if;

  select * into v_old
  from ticketing.ticket_triage_state
  where ticket_id = p_ticket_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Checked under the row lock, so two reviewers can't both pass it.
  if v_old.reviewed_at is distinct from p_reviewed_at then
    raise exception 'stale_review';
  end if;

  if v_latest is null then
    v_outcome := 'manual';
  else
    select * into v_ai from ticketing.triage_results where id = v_latest;
    v_outcome := case
      when v_ai.priority = p_priority and v_ai.category = p_category and v_ai.team = p_team
        then 'confirmed'
      else 'corrected'
    end;
  end if;

  update ticketing.ticket_triage_state
  set priority = p_priority,
      category = p_category,
      team = p_team,
      reviewed_by = v_uid,
      reviewed_at = now(),
      reviewed_result_id = v_latest
  where ticket_id = p_ticket_id;

  if p_priority is distinct from v_old.priority then
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (p_ticket_id, v_uid, 'priority_changed', v_old.priority::text, p_priority::text);
  end if;
  if p_category is distinct from v_old.category then
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (p_ticket_id, v_uid, 'category_changed', v_old.category::text, p_category::text);
  end if;
  if p_team is distinct from v_old.team then
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (p_ticket_id, v_uid, 'team_changed', v_old.team::text, p_team::text);
  end if;

  insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
  values (p_ticket_id, v_uid, 'triage_reviewed', null, v_outcome);

  return v_outcome;
end;
$$;

create or replace function ticketing.set_learning_excluded(p_ticket_id uuid, p_excluded boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select ticketing.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update ticketing.ticket_triage_state
  set learning_excluded_at = case when p_excluded then now() else null end,
      learning_excluded_by = case when p_excluded then auth.uid() else null end
  where ticket_id = p_ticket_id
    and workspace_id = ticketing.current_workspace_id()
    and reviewed_at is not null;
  if not found then
    raise exception 'not_a_correction' using errcode = 'P0002';
  end if;
  insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
  values (p_ticket_id, auth.uid(), case when p_excluded then 'learning_excluded' else 'learning_included' end, null, null);
  return true;
end;
$$;

create or replace function ticketing.learnable_correction_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select ticketing.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return (
    select count(*)::int
    from ticketing.ticket_triage_state s
    join ticketing.triage_results r on r.id = s.reviewed_result_id
    join ticketing.ticket_embeddings e on e.ticket_id = s.ticket_id
    where s.workspace_id = ticketing.current_workspace_id()
      and s.reviewed_at is not null
      and s.learning_excluded_at is null
      and (r.priority, r.category, r.team) is distinct from (s.priority, s.category, s.team)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. AI matching stays inside the ticket's workspace
-- ---------------------------------------------------------------------------

-- Candidates for duplicate/related come only from the triaged ticket's own
-- workspace (an unknown exclude_ticket_id matches nothing). The HNSW index
-- returns its nearest rows before the workspace filter applies; an iterative
-- scan keeps going until enough rows pass it, instead of returning fewer
-- candidates once many workspaces share the index.
create or replace function ticketing.match_tickets(query_embedding extensions.vector, match_count integer, exclude_ticket_id uuid)
returns table (ticket_id uuid, subject text, status ticketing.ticket_status, latest_summary text, similarity double precision)
language sql
stable
set search_path = ''
set hnsw.iterative_scan = strict_order
as $$
  select
    t.id,
    t.subject,
    t.status,
    (
      select tr.summary
      from ticketing.triage_results tr
      where tr.ticket_id = t.id
      order by tr.created_at desc
      limit 1
    ),
    1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
  from ticketing.ticket_embeddings e
  join ticketing.tickets t on t.id = e.ticket_id
  where e.ticket_id <> exclude_ticket_id
    and e.workspace_id = (select x.workspace_id from ticketing.tickets x where x.id = exclude_ticket_id)
    -- Never offered as a duplicate or related ticket (SUP-70).
    and not t.is_access_request
  order by e.embedding operator(extensions.<=>) query_embedding asc
  limit least(match_count, 20);
$$;

-- Correction examples come only from the triaged ticket's own workspace.
create or replace function ticketing.match_triage_corrections(p_embedding extensions.vector, p_exclude_ticket_id uuid, p_threshold double precision, p_limit integer)
returns table (ticket_id uuid, summary text, ai_priority text, ai_category text, ai_team text, priority text, category text, team text, similarity double precision)
language sql
stable
security definer
set search_path = ''
as $$
  with corrections as materialized (
    select
      s.ticket_id,
      r.summary,
      r.priority::text as ai_priority, r.category::text as ai_category, r.team::text as ai_team,
      s.priority::text as priority, s.category::text as category, s.team::text as team,
      e.embedding
    from ticketing.ticket_triage_state s
    join ticketing.triage_results r on r.id = s.reviewed_result_id
    join ticketing.ticket_embeddings e on e.ticket_id = s.ticket_id
    where s.ticket_id <> p_exclude_ticket_id
      and s.workspace_id = (select x.workspace_id from ticketing.tickets x where x.id = p_exclude_ticket_id)
      and s.reviewed_at is not null
      and s.learning_excluded_at is null
      and (r.priority, r.category, r.team) is distinct from (s.priority, s.category, s.team)
  ), ranked as (
    select c.*, 1 - (c.embedding operator(extensions.<=>) p_embedding) as similarity
    from corrections c
  )
  select ticket_id, summary, ai_priority, ai_category, ai_team, priority, category, team, similarity
  from ranked
  where similarity >= p_threshold
  order by similarity desc
  limit least(greatest(p_limit, 0), 5);
$$;

-- Incidents group tickets of one workspace only, and the lock is per
-- workspace (two teams' detections never wait on each other).
create or replace function ticketing.detect_incident(p_ticket_id uuid, p_threshold double precision, p_window_minutes integer, p_min_tickets integer)
returns table (incident_id uuid, created boolean, ticket_count integer, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_embedding extensions.vector(1536);
  v_since timestamptz := now() - make_interval(mins => p_window_minutes);
  v_ws uuid;
  v_existing uuid;
  v_members uuid[];
  v_incident uuid;
begin
  select t.workspace_id into v_ws from ticketing.tickets t where t.id = p_ticket_id;
  if v_ws is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('ticketing.detect_incident:' || v_ws::text));

  -- Already grouped, or an access request (SUP-70: worded alike, but not a
  -- problem report): nothing to do.
  if exists (select 1 from ticketing.incident_tickets it where it.ticket_id = p_ticket_id)
     or exists (select 1 from ticketing.tickets ar where ar.id = p_ticket_id and ar.is_access_request) then
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
    and t.workspace_id = v_ws
    and i.workspace_id = v_ws
    and t.status not in ('resolved', 'closed')
    and t.created_at >= v_since
    and i.status in ('open', 'dismissed')
    and not t.is_access_request
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
    and t.workspace_id = v_ws
    and t.status not in ('resolved', 'closed')
    and t.created_at >= v_since
    and not exists (select 1 from ticketing.incident_tickets x where x.ticket_id = t.id)
    and not t.is_access_request
    and 1 - (e.embedding operator(extensions.<=>) v_embedding) >= p_threshold;

  if coalesce(array_length(v_members, 1), 0) < p_min_tickets then
    return;
  end if;
  if (select count(distinct t.customer_id) from ticketing.tickets t where t.id = any (v_members)) < 2 then
    return;
  end if;

  insert into ticketing.incidents (title, first_seen_at, workspace_id)
  select 'Possible incident', min(t.created_at), v_ws from ticketing.tickets t where t.id = any (v_members)
  returning id into v_incident;
  insert into ticketing.incident_tickets (incident_id, ticket_id)
  select v_incident, m from unnest(v_members) as m;

  return query select v_incident, true, array_length(v_members, 1), 'open'::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The GDPR export names the role and workspace from the membership
-- ---------------------------------------------------------------------------

create or replace function ticketing.export_own_data()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'email', p.email, 'full_name', p.full_name,
        'role', m.role, 'workspace', w.name, 'created_at', p.created_at,
        'avatar_path', p.avatar_path,
        'preferences', jsonb_build_object(
          'theme', p.theme,
          'queue_default_filter', p.queue_default_filter,
          'queue_default_sort', p.queue_default_sort
        )
      )
      from ticketing.profiles p
      left join ticketing.workspace_members m on m.user_id = p.id
      left join ticketing.workspaces w on w.id = m.workspace_id
      where p.id = (select auth.uid())
    ),
    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'subject', t.subject, 'body', t.body, 'status', t.status,
        'created_at', t.created_at, 'updated_at', t.updated_at,
        'first_response_at', t.first_response_at, 'resolved_at', t.resolved_at,
        'closed_at', t.closed_at,
        'comments', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', c.id, 'body', c.body,
            'by_me', c.author_id = (select auth.uid()),
            'created_at', c.created_at
          ) order by c.created_at), '[]'::jsonb)
          from ticketing.ticket_comments c
          where c.ticket_id = t.id
        ),
        'history', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'event_type', e.event_type, 'from', e.from_value, 'to', e.to_value,
            'created_at', e.created_at
          ) order by e.created_at), '[]'::jsonb)
          from ticketing.ticket_events e
          where e.ticket_id = t.id
        )
      ) order by t.created_at), '[]'::jsonb)
      from ticketing.tickets t
      where t.customer_id = (select auth.uid())
    ),
    'comments_on_other_tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'ticket_id', c.ticket_id, 'body', c.body,
        'is_internal', c.is_internal, 'created_at', c.created_at
      ) order by c.created_at), '[]'::jsonb)
      from ticketing.ticket_comments c
      join ticketing.tickets t on t.id = c.ticket_id
      where c.author_id = (select auth.uid())
        and t.customer_id <> (select auth.uid())
    ),
    'actions_on_tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ticket_id', e.ticket_id, 'event_type', e.event_type,
        'from', e.from_value, 'to', e.to_value, 'created_at', e.created_at
      ) order by e.created_at), '[]'::jsonb)
      from ticketing.ticket_events e
      where e.actor_id = (select auth.uid())
    ),
    'tickets_assigned_to_me', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'subject', t.subject, 'status', t.status
      ) order by t.created_at), '[]'::jsonb)
      from ticketing.tickets t
      where t.assignee_id = (select auth.uid())
    ),
    'public_share_links_i_published', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'ticket_id', s.ticket_id, 'subject', s.subject,
        'summary', s.summary, 'revoked', s.revoked, 'created_at', s.created_at
      ) order by s.created_at), '[]'::jsonb)
      from ticketing.shared_ticket_summaries s
      where s.published_by = (select auth.uid())
    ),
    'ratings_i_gave', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ticket_id', r.ticket_id, 'score', r.score, 'comment', r.comment,
        'created_at', r.created_at, 'updated_at', r.updated_at
      ) order by r.created_at), '[]'::jsonb)
      from ticketing.ticket_ratings r
      where r.rated_by = (select auth.uid())
    ),
    'notes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', n.id, 'title', n.title, 'body', n.body,
        'created_at', n.created_at, 'updated_at', n.updated_at
      ) order by n.created_at), '[]'::jsonb)
      from ticketing.notes n
      where n.owner_id = (select auth.uid())
    ),
    'assistant_conversations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', cv.id, 'title', cv.title, 'created_at', cv.created_at,
        'messages', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'role', m.role, 'content', m.content, 'model', m.model,
            'created_at', m.created_at
          ) order by m.created_at), '[]'::jsonb)
          from ticketing.assistant_messages m
          where m.conversation_id = cv.id
        )
      ) order by cv.created_at), '[]'::jsonb)
      from ticketing.assistant_conversations cv
      where cv.owner_id = (select auth.uid())
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 9. RLS: every policy also checks the caller's workspace
-- ---------------------------------------------------------------------------

-- Your own workspace only.
create policy workspaces_select_own on ticketing.workspaces
  for select to authenticated
  using (id = (select ticketing.current_workspace_id()));

-- Mirrors profiles: your own row; admins every member of the workspace;
-- agents the staff rows.
create policy workspace_members_select on ticketing.workspace_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      workspace_id = (select ticketing.current_workspace_id())
      and ((select ticketing.is_admin()) or ((select ticketing.is_staff()) and role in ('agent', 'admin')))
    )
  );

drop policy profiles_select_staff on ticketing.profiles;
create policy profiles_select_staff on ticketing.profiles
  for select to authenticated
  using (
    exists (
      select 1 from ticketing.workspace_members m
      where m.user_id = profiles.id
        and m.workspace_id = (select ticketing.current_workspace_id())
        and ((select ticketing.is_admin()) or ((select ticketing.is_staff()) and m.role in ('agent', 'admin')))
    )
  );

drop policy profile_cards_select on ticketing.profile_cards;
create policy profile_cards_select on ticketing.profile_cards
  for select to authenticated
  using (
    id = (select auth.uid())
    or (
      workspace_id = (select ticketing.current_workspace_id())
      and (
        ((select ticketing.is_staff()) and (
          is_staff
          or exists (select 1 from ticketing.tickets t where t.customer_id = profile_cards.id or t.assignee_id = profile_cards.id or t.created_by = profile_cards.id)
          or exists (select 1 from ticketing.ticket_comments c where c.author_id = profile_cards.id)
        ))
        or (is_staff and (
          exists (select 1 from ticketing.tickets t where t.assignee_id = profile_cards.id)
          or exists (select 1 from ticketing.ticket_comments c where c.author_id = profile_cards.id)
        ))
      )
    )
  );

drop policy tickets_select on ticketing.tickets;
create policy tickets_select on ticketing.tickets
  for select to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (
      customer_id = auth.uid()
      or (select ticketing.is_admin())
      or ((select ticketing.app_role()) = 'agent' and (assignee_id = auth.uid() or assignee_id is null))
    )
  );

drop policy tickets_insert_customer on ticketing.tickets;
create policy tickets_insert_customer on ticketing.tickets
  for insert to authenticated
  with check (
    (select ticketing.app_role()) = 'customer'
    and workspace_id = (select ticketing.current_workspace_id())
    and customer_id = auth.uid()
    and status = 'new'
    and assignee_id is null
    and first_response_at is null
    and resolved_at is null
    and closed_at is null
  );

drop policy tickets_update_staff on ticketing.tickets;
create policy tickets_update_staff on ticketing.tickets
  for update to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (
      (select ticketing.is_admin())
      or ((select ticketing.app_role()) = 'agent' and (assignee_id = auth.uid() or assignee_id is null))
    )
  )
  with check (
    workspace_id = (select ticketing.current_workspace_id())
    and (
      (select ticketing.is_admin())
      or ((select ticketing.app_role()) = 'agent' and (assignee_id = auth.uid() or assignee_id is null))
    )
  );

drop policy ticket_comments_select on ticketing.ticket_comments;
create policy ticket_comments_select on ticketing.ticket_comments
  for select to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.can_view_ticket(ticket_id))
    and (not is_internal or (select ticketing.is_staff()))
  );

drop policy ticket_comments_insert on ticketing.ticket_comments;
create policy ticket_comments_insert on ticketing.ticket_comments
  for insert to authenticated
  with check (
    workspace_id = (select ticketing.current_workspace_id())
    and author_id = auth.uid()
    and (select ticketing.can_view_ticket(ticket_id))
    and (not is_internal or (select ticketing.is_staff()))
    and exists (select 1 from ticketing.tickets t where t.id = ticket_comments.ticket_id and t.status <> 'closed')
  );

drop policy ticket_events_select on ticketing.ticket_events;
create policy ticket_events_select on ticketing.ticket_events
  for select to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

drop policy triage_results_select_staff on ticketing.triage_results;
create policy triage_results_select_staff on ticketing.triage_results
  for select to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

drop policy ticket_triage_state_select_staff on ticketing.ticket_triage_state;
create policy ticket_triage_state_select_staff on ticketing.ticket_triage_state
  for select to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

drop policy ticket_labels_staff_select on ticketing.ticket_labels;
create policy ticket_labels_staff_select on ticketing.ticket_labels
  for select to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

drop policy ticket_labels_staff_insert on ticketing.ticket_labels;
create policy ticket_labels_staff_insert on ticketing.ticket_labels
  for insert to authenticated
  with check (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
    and added_by = (select auth.uid())
  );

drop policy ticket_labels_staff_delete on ticketing.ticket_labels;
create policy ticket_labels_staff_delete on ticketing.ticket_labels
  for delete to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

drop policy ticket_flags_insert_own on ticketing.ticket_flags;
create policy ticket_flags_insert_own on ticketing.ticket_flags
  for insert to authenticated
  with check (
    workspace_id = (select ticketing.current_workspace_id())
    and user_id = (select auth.uid())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

drop policy ticket_flags_select_own on ticketing.ticket_flags;
create policy ticket_flags_select_own on ticketing.ticket_flags
  for select to authenticated
  using (workspace_id = (select ticketing.current_workspace_id()) and user_id = (select auth.uid()));

drop policy ticket_flags_delete_own on ticketing.ticket_flags;
create policy ticket_flags_delete_own on ticketing.ticket_flags
  for delete to authenticated
  using (workspace_id = (select ticketing.current_workspace_id()) and user_id = (select auth.uid()));

drop policy ticket_ratings_select on ticketing.ticket_ratings;
create policy ticket_ratings_select on ticketing.ticket_ratings
  for select to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (
      rated_by = (select auth.uid())
      or (select ticketing.is_admin())
      or ((select ticketing.is_staff()) and agent_id = (select auth.uid()))
    )
  );

drop policy shared_ticket_summaries_select_staff on ticketing.shared_ticket_summaries;
create policy shared_ticket_summaries_select_staff on ticketing.shared_ticket_summaries
  for select to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

drop policy shared_ticket_summaries_insert_staff on ticketing.shared_ticket_summaries;
create policy shared_ticket_summaries_insert_staff on ticketing.shared_ticket_summaries
  for insert to authenticated
  with check (
    workspace_id = (select ticketing.current_workspace_id())
    and published_by = auth.uid()
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

drop policy shared_ticket_summaries_revoke_staff on ticketing.shared_ticket_summaries;
create policy shared_ticket_summaries_revoke_staff on ticketing.shared_ticket_summaries
  for update to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  )
  with check (
    revoked = true
    and workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

drop policy labels_staff_select on ticketing.labels;
create policy labels_staff_select on ticketing.labels
  for select to authenticated
  using (workspace_id = (select ticketing.current_workspace_id()) and (select ticketing.is_staff()));

drop policy labels_staff_insert on ticketing.labels;
create policy labels_staff_insert on ticketing.labels
  for insert to authenticated
  with check (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and created_by = (select auth.uid())
  );

drop policy labels_staff_update on ticketing.labels;
create policy labels_staff_update on ticketing.labels
  for update to authenticated
  using (workspace_id = (select ticketing.current_workspace_id()) and (select ticketing.is_staff()))
  with check (workspace_id = (select ticketing.current_workspace_id()) and (select ticketing.is_staff()));

drop policy labels_staff_delete on ticketing.labels;
create policy labels_staff_delete on ticketing.labels
  for delete to authenticated
  using (workspace_id = (select ticketing.current_workspace_id()) and (select ticketing.is_staff()));

drop policy incidents_staff_select on ticketing.incidents;
create policy incidents_staff_select on ticketing.incidents
  for select to authenticated
  using (workspace_id = (select ticketing.current_workspace_id()) and (select ticketing.is_staff()));

drop policy incidents_staff_update on ticketing.incidents;
create policy incidents_staff_update on ticketing.incidents
  for update to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and status = 'open'
  )
  with check (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (update_posted_by is null or update_posted_by = (select auth.uid()))
    and (
      (status = 'open' and closed_by is null and closed_at is null)
      or (status in ('resolved', 'dismissed') and closed_by = (select auth.uid()) and closed_at is not null)
    )
  );

drop policy incident_tickets_staff_select on ticketing.incident_tickets;
create policy incident_tickets_staff_select on ticketing.incident_tickets
  for select to authenticated
  using (
    workspace_id = (select ticketing.current_workspace_id())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

-- ---------------------------------------------------------------------------
-- 10. The role lives in workspace_members now
-- ---------------------------------------------------------------------------

alter table ticketing.profiles drop column role;
