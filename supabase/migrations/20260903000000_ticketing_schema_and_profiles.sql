-- Creates the `ticketing` schema for the Support Ticket / Inbox Triage app.
-- This project shares its Supabase project with `notes-collections`, which owns
-- the `public` schema (notes/collections/tags/note_tags). Everything for this
-- app lives under `ticketing` so the two products never collide on table names,
-- RLS policies, or grants. `auth.users` (and therefore sign-in credentials) is
-- shared between both apps — see docs/supabase-schema.md for details.

create schema if not exists ticketing;

comment on schema ticketing is
  'Support Ticket / Inbox Triage app. Shares this Supabase project (and auth.users) with notes-collections, which owns the public schema.';

-- Roles are a closed set the app code branches on, so an enum (not a lookup
-- table) gives free validation and matches the app's role literals exactly.
create type ticketing.app_role as enum ('customer', 'agent', 'admin');

create table ticketing.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role ticketing.app_role not null default 'customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on ticketing.profiles (role);

comment on table ticketing.profiles is
  'One row per auth.users id. role is customer by default and must never be set from client-supplied signup metadata (self-escalation risk) — see handle_new_ticketing_user below.';

alter table ticketing.profiles enable row level security;

-- Helper functions. STABLE + SECURITY DEFINER + empty search_path:
--   - STABLE lets Postgres cache the result once per statement when wrapped
--     as `(select ticketing.is_admin())` in a policy, instead of re-running
--     it per row.
--   - SECURITY DEFINER lets these read ticketing.profiles even though the
--     calling policy itself is what's gating access to that table — without
--     this, a profiles policy that calls is_admin() (which reads profiles)
--     would recurse into itself.
--   - `set search_path = ''` plus fully-qualified names avoids a search-path
--     hijack against a SECURITY DEFINER function.

create or replace function ticketing.app_role()
returns ticketing.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from ticketing.profiles where id = auth.uid();
$$;

create or replace function ticketing.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from ticketing.profiles
    where id = auth.uid() and role in ('agent', 'admin')
  );
$$;

create or replace function ticketing.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from ticketing.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Grants: schema usage plus table-level access. Role can only ever change
-- through admin_set_role() below (a SECURITY DEFINER function, which bypasses
-- these column grants) — the app must never expose a path that lets a client
-- UPDATE profiles.role directly, even for admins.
grant usage on schema ticketing to authenticated, service_role;
grant select on ticketing.profiles to authenticated;
grant update (email, full_name, updated_at) on ticketing.profiles to authenticated;
grant all on ticketing.profiles to service_role;

create policy "profiles_select_own" on ticketing.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy "profiles_select_staff" on ticketing.profiles
  for select
  to authenticated
  using ((select ticketing.is_staff()));

create policy "profiles_update_own" on ticketing.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- New signups: role is hard-coded to 'customer' and never taken from
-- raw_user_meta_data. This is the single most important line of SQL in the
-- project — without it, `supabase.auth.signUp({ options: { data: { role:
-- 'admin' } } })` would let anyone self-escalate on sign-up.
create or replace function ticketing.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into ticketing.profiles (id, email, role)
  values (new.id, new.email, 'customer')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_ticketing
  after insert on auth.users
  for each row execute function ticketing.handle_new_user();

-- Because auth.users is shared with notes-collections, a user who already
-- signed up there (before ever touching this app) has no ticketing.profiles
-- row and never fires the trigger above. Callers must get-or-create a
-- profile on first touch of this app rather than assume the trigger already
-- ran for every signed-in user.
create or replace function ticketing.ensure_profile()
returns ticketing.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  result ticketing.profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into ticketing.profiles (id, email, role)
  select auth.uid(), u.email, 'customer'
  from auth.users u
  where u.id = auth.uid()
  on conflict (id) do nothing;

  select * into result from ticketing.profiles where id = auth.uid();
  return result;
end;
$$;

grant execute on function ticketing.ensure_profile() to authenticated;

-- The only sanctioned path to change a role. Re-checks is_admin() itself
-- rather than trusting a caller-side check, since this is SECURITY DEFINER
-- and therefore bypasses both RLS and the column-level grant above.
create or replace function ticketing.admin_set_role(target_user_id uuid, new_role ticketing.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ticketing.is_admin() then
    raise exception 'not authorized';
  end if;

  update ticketing.profiles
  set role = new_role, updated_at = now()
  where id = target_user_id;
end;
$$;

grant execute on function ticketing.admin_set_role(uuid, ticketing.app_role) to authenticated;
