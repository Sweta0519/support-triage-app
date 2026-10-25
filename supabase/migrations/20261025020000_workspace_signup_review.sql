-- SUP-82 review fixes (PR #89).
--
-- A note on 20261025000000: its "the sign-up limits already cover" creating
-- a workspace holds for the app's sign-up form. A direct call to Supabase
-- Auth's sign-up endpoint (the anon key is public) skips the app's limiter;
-- Supabase Auth's own per-IP sign-up limit and the Vercel WAF rule apply
-- there. It can only ever make the caller admin of a new, empty workspace.

-- 1. The default workspace keeps an admin. Its only admin could delete
--    their account once they were its only member, and the workspace (kept,
--    as the default) would then take "Get in touch" sign-ups with no admin
--    to answer them.
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
    and (
      exists (
        select 1 from ticketing.workspace_members m
        where m.workspace_id = v_member.workspace_id and m.user_id <> old.id
      )
      or (select w.is_default from ticketing.workspaces w where w.id = v_member.workspace_id)
    )
  then
    raise exception 'last_admin: the only admin cannot delete their account';
  end if;
  return old;
end;
$$;

-- 2. An email that clashes with another profile used to drop the sign-up's
--    intent silently: the person was later put in the default workspace as
--    a customer, and an invite stayed open. With an intent the sign-up is
--    now refused instead; without one it behaves as before.
-- 3. The intent (a workspace name, or a join or invite token) is removed
--    from the account's metadata once used, so it doesn't sit in every
--    session token afterwards, as file_access_request() does for its own.
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
    if v_name is not null or v_join is not null or v_invite is not null then
      raise exception 'workspace_signup: email already used by another profile';
    end if;
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

  if v_meta ?| array['workspace_name', 'join_token', 'invite_token'] then
    update auth.users
    set raw_user_meta_data = raw_user_meta_data - 'workspace_name' - 'join_token' - 'invite_token'
    where id = new.id;
  end if;
  return new;
end;
$$;

-- 4. Every invite attempt counts against the admin's limit, including one
--    for an email that already has an account. Before, that refusal came
--    first and was free, so an admin of any workspace could check without
--    limit whether an address has an account anywhere in the app. That
--    refusal is returned ({"error": "already_has_account"}), not raised: a
--    raise would roll back the count it just took.
create or replace function ticketing.create_workspace_invite(p_email text)
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
  if not ticketing.consume_rate_limit('workspace_invite') then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if exists (select 1 from ticketing.profiles p where lower(p.email) = v_email) then
    return jsonb_build_object('error', 'already_has_account');
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

-- 5. The signed-out /join and /invite pages look a token up with the
--    service role. The tokens are long and random, but the lookups are a
--    public action, so they're limited per IP like the public status page:
--    30 every 5 minutes. A null IP (local development only, see
--    visitorIp()) has no bucket.
create function ticketing.consume_workspace_link_rate_limit(p_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz := to_timestamp(floor(extract(epoch from now()) / 300) * 300);
  v_count int;
begin
  if p_ip is null then
    return true;
  end if;
  insert into ticketing.rate_limits (key, window_start, count)
  values ('workspace_link:' || p_ip, v_window_start, 1)
  on conflict (key, window_start)
    do update set count = ticketing.rate_limits.count + 1
  returning count into v_count;

  if random() < 0.01 then
    delete from ticketing.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= 30;
end;
$$;

revoke execute on function ticketing.consume_workspace_link_rate_limit(text) from public, anon, authenticated;
grant execute on function ticketing.consume_workspace_link_rate_limit(text) to service_role;
