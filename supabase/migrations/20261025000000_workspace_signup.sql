-- SUP-82 (workspaces part 2): sign-up picks the workspace.
--
--   * A plain sign-up names a new workspace and becomes its admin.
--   * A customer join link (/join/<token>) signs up a customer of that
--     workspace. Admins can see and rotate it.
--   * An agent invite (/invite/<token>) is single-use, expires after 7 days
--     and only works for the email it was made for. Admins share the link
--     themselves; the app sends no email.
--   * No intent (Get in touch, and anything older) joins the default
--     workspace as a customer, as before.
--
-- The role is still never read from sign-up metadata. The trigger reads an
-- intent (a name, a join token, an invite token) and works the role out
-- from what it could check: a bad or expired token aborts the sign-up
-- rather than landing anyone in the wrong workspace. One workspace per
-- person still holds, so an existing account can't use a link.

-- ---------------------------------------------------------------------------
-- 1. Join link and invites
-- ---------------------------------------------------------------------------

-- Volatile default: every existing workspace gets its own token.
alter table ticketing.workspaces
  add column join_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex');

-- Members read their workspace's name, never its join token: only admins
-- get that, through workspace_join_token().
revoke select on ticketing.workspaces from authenticated;
grant select (id, name, is_default, created_at) on ticketing.workspaces to authenticated;

create table ticketing.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ticketing.workspaces (id) on delete cascade,
  email text not null constraint workspace_invites_email_length check (char_length(email) between 3 and 320),
  -- sha256 of the token, like access_tokens: the link is shown once.
  token_hash text not null unique,
  created_by uuid references ticketing.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references ticketing.profiles (id) on delete set null,
  revoked_at timestamptz
);

create index workspace_invites_workspace_idx on ticketing.workspace_invites (workspace_id, created_at desc);

alter table ticketing.workspace_invites enable row level security;
revoke all on ticketing.workspace_invites from anon, authenticated;
grant select (id, workspace_id, email, created_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on ticketing.workspace_invites to authenticated;
grant all on ticketing.workspace_invites to service_role;

create policy workspace_invites_admin_select on ticketing.workspace_invites
  for select to authenticated
  using (workspace_id = (select ticketing.current_workspace_id()) and (select ticketing.is_admin()));

-- ---------------------------------------------------------------------------
-- 2. Admin RPCs (the only write paths)
-- ---------------------------------------------------------------------------

-- Two new limits: invites (20 an hour) and join-link rotation (10 an hour),
-- per admin. Creating or joining a workspace happens at sign-up, which the
-- sign-up limits already cover (per IP and per email).
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
    when 'rate_ticket'   then v_limit := 10; v_window_seconds := 600;
    when 'update_profile' then v_limit := 20; v_window_seconds := 600;
    when 'update_avatar' then v_limit := 10; v_window_seconds := 600;
    when 'access_token'  then v_limit := 10; v_window_seconds := 3600;
    when 'mcp_request'   then v_limit := 120; v_window_seconds := 600;
    when 'set_presence'  then v_limit := 60; v_window_seconds := 600;
    when 'workspace_invite' then v_limit := 20; v_window_seconds := 3600;
    when 'workspace_join_rotate' then v_limit := 10; v_window_seconds := 3600;
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

create function ticketing.workspace_join_token()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return (select w.join_token from ticketing.workspaces w where w.id = ticketing.current_workspace_id());
end;
$$;

-- The old link stops working at once.
create function ticketing.rotate_workspace_join_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not ticketing.consume_rate_limit('workspace_join_rotate') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  update ticketing.workspaces
  set join_token = encode(extensions.gen_random_bytes(24), 'hex')
  where id = ticketing.current_workspace_id()
  returning join_token into v_token;
  return v_token;
end;
$$;

-- Returns the token once; only its hash is kept. A new invite for the same
-- email replaces a pending one. An email that already has an account is
-- refused: that person is in a workspace already.
create function ticketing.create_workspace_invite(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := ticketing.current_workspace_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if exists (select 1 from ticketing.profiles p where lower(p.email) = v_email) then
    raise exception 'already_has_account' using errcode = '23505';
  end if;
  if not ticketing.consume_rate_limit('workspace_invite') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  update ticketing.workspace_invites
  set revoked_at = now()
  where workspace_id = v_ws and email = v_email and accepted_at is null and revoked_at is null;

  v_token := 'wi_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into ticketing.workspace_invites (workspace_id, email, token_hash, created_by)
  values (v_ws, v_email, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id, expires_at into v_id, v_expires;
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires);
end;
$$;

create function ticketing.revoke_workspace_invite(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update ticketing.workspace_invites
  set revoked_at = now()
  where id = p_id and workspace_id = ticketing.current_workspace_id()
    and accepted_at is null and revoked_at is null;
  return found;
end;
$$;

revoke all on function ticketing.workspace_join_token() from public;
revoke all on function ticketing.rotate_workspace_join_token() from public;
revoke all on function ticketing.create_workspace_invite(text) from public;
revoke all on function ticketing.revoke_workspace_invite(uuid) from public;
grant execute on function ticketing.workspace_join_token() to authenticated;
grant execute on function ticketing.rotate_workspace_join_token() to authenticated;
grant execute on function ticketing.create_workspace_invite(text) to authenticated;
grant execute on function ticketing.revoke_workspace_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sign-up picks the workspace
-- ---------------------------------------------------------------------------

create or replace function ticketing.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := nullif(btrim(v_meta ->> 'workspace_name'), '');
  v_join text := nullif(v_meta ->> 'join_token', '');
  v_invite text := nullif(v_meta ->> 'invite_token', '');
  v_ws uuid;
  v_invite_id uuid;
begin
  if new.email is null then
    return new;
  end if;
  if (v_name is not null)::int + (v_join is not null)::int + (v_invite is not null)::int > 1 then
    raise exception 'workspace_signup: more than one way in';
  end if;

  begin
    insert into ticketing.profiles (id, email)
    values (new.id, new.email);
  exception when unique_violation then
    raise warning 'ticketing.handle_new_user: email % already used by another profile (auth.users id %)', new.email, new.id;
    return new;
  end;

  if v_invite is not null then
    select i.id, i.workspace_id into v_invite_id, v_ws
    from ticketing.workspace_invites i
    where i.token_hash = encode(extensions.digest(v_invite, 'sha256'), 'hex')
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      and i.email = lower(new.email)
    for update;
    if v_ws is null then
      raise exception 'workspace_signup: invite_invalid';
    end if;
    insert into ticketing.workspace_members (user_id, workspace_id, role) values (new.id, v_ws, 'agent');
    update ticketing.workspace_invites set accepted_at = now(), accepted_by = new.id where id = v_invite_id;
  elsif v_join is not null then
    select w.id into v_ws from ticketing.workspaces w where w.join_token = v_join;
    if v_ws is null then
      raise exception 'workspace_signup: join_invalid';
    end if;
    insert into ticketing.workspace_members (user_id, workspace_id, role) values (new.id, v_ws, 'customer');
  elsif v_name is not null then
    insert into ticketing.workspaces (name) values (v_name) returning id into v_ws;
    insert into ticketing.workspace_members (user_id, workspace_id, role) values (new.id, v_ws, 'admin');
  else
    insert into ticketing.workspace_members (user_id, workspace_id, role)
    select new.id, w.id, 'customer' from ticketing.workspaces w where w.is_default;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Leaving: a workspace's only member can delete their account
-- ---------------------------------------------------------------------------

-- The last admin still can't leave others behind with no admin, but an
-- admin alone in their workspace can delete their account (and the
-- workspace goes with them, below).
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
  if v_member.role = 'admin'
    and not exists (
      select 1 from ticketing.workspace_members m
      where m.workspace_id = v_member.workspace_id and m.role = 'admin' and m.user_id <> old.id
    )
    and exists (
      select 1 from ticketing.workspace_members m
      where m.workspace_id = v_member.workspace_id and m.user_id <> old.id
    )
  then
    raise exception 'last_admin: the only admin cannot delete their account';
  end if;
  return old;
end;
$$;

-- A workspace with no members left is deleted, with everything in it. The
-- default workspace is kept.
create function ticketing.delete_empty_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from ticketing.workspaces w
  where w.id = old.workspace_id
    and not w.is_default
    and not exists (select 1 from ticketing.workspace_members m where m.workspace_id = old.workspace_id);
  return null;
end;
$$;

revoke all on function ticketing.delete_empty_workspace() from public;

create trigger workspace_members_delete_empty_workspace
  after delete on ticketing.workspace_members
  for each row execute function ticketing.delete_empty_workspace();
