-- SUP-53: personal access tokens for the MCP connector (epic SUP-47).
--
-- A token lets an MCP client (Claude, Cursor, ...) act as its owner. Only a
-- SHA-256 hash of the secret is stored; the secret itself is shown once, at
-- creation, and never again. A short visible prefix ("st_a1b2c3d4") lets the
-- owner tell their tokens apart. Tokens can expire and can be revoked; the
-- MCP endpoint (SUP-54) resolves a token through resolve_access_token(),
-- which only the service role may call.

create table ticketing.access_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references ticketing.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  prefix text not null check (prefix ~ '^st_[0-9a-zA-Z_-]{8}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  check (expires_at is null or expires_at > created_at)
);

create index access_tokens_owner_idx on ticketing.access_tokens (owner_id, created_at desc);

alter table ticketing.access_tokens enable row level security;

-- Owners see their own tokens (never the hash: it isn't granted below).
create policy access_tokens_select_own on ticketing.access_tokens
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Owners create tokens for themselves only.
create policy access_tokens_insert_own on ticketing.access_tokens
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and revoked_at is null and last_used_at is null);

revoke all on ticketing.access_tokens from anon, authenticated;
grant select (id, owner_id, name, prefix, created_at, last_used_at, expires_at, revoked_at)
  on ticketing.access_tokens to authenticated;
grant insert (owner_id, name, token_hash, prefix, expires_at) on ticketing.access_tokens to authenticated;
grant all on ticketing.access_tokens to service_role;

-- At most 10 active (unrevoked, unexpired) tokens per person, and creation is
-- rate-limited like the app's other actions.
create or replace function ticketing.access_tokens_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from ticketing.access_tokens t
    where t.owner_id = new.owner_id
      and t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
  ) >= 10 then
    raise exception 'too_many_tokens' using errcode = 'P0001';
  end if;
  if auth.uid() is not null and not ticketing.consume_rate_limit('access_token') then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function ticketing.access_tokens_before_insert() from public;

create trigger access_tokens_before_insert
  before insert on ticketing.access_tokens
  for each row execute function ticketing.access_tokens_before_insert();

-- Revoking: owners only, their own tokens, once.
create or replace function ticketing.revoke_access_token(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update ticketing.access_tokens
  set revoked_at = now()
  where id = p_id and owner_id = auth.uid() and revoked_at is null;
  return found;
end;
$$;

revoke all on function ticketing.revoke_access_token(uuid) from public;
grant execute on function ticketing.revoke_access_token(uuid) to authenticated;

-- For the MCP endpoint only (service role): a valid token's owner, and the
-- time it was last used, recorded at most once a minute.
create or replace function ticketing.resolve_access_token(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_owner uuid;
  v_last timestamptz;
begin
  select id, owner_id, last_used_at into v_id, v_owner, v_last
  from ticketing.access_tokens
  where token_hash = p_token_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now());
  if v_id is null then
    return null;
  end if;
  if v_last is null or v_last < now() - interval '1 minute' then
    update ticketing.access_tokens set last_used_at = now() where id = v_id;
  end if;
  return v_owner;
end;
$$;

revoke all on function ticketing.resolve_access_token(text) from public, anon, authenticated;
grant execute on function ticketing.resolve_access_token(text) to service_role;

-- The rate-limit actions, as in 20261012020000_profile_pictures.sql, plus
-- access_token (10 an hour).
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
