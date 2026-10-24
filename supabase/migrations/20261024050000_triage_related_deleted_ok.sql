-- SUP-81 review fixes (PR #88).

-- A related-ticket candidate can be deleted while triage runs (its
-- customer deletes their account). The left join counted a deleted ticket
-- as "outside the workspace", so the triage_results insert was refused and
-- the run failed. Only a ticket that exists in another workspace is refused
-- now, as nothing was refused before workspaces.
create or replace function ticketing.check_triage_result_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(new.related_ticket_ids) as r(id)
    join ticketing.tickets t on t.id = r.id
    where t.workspace_id <> new.workspace_id
  ) then
    raise exception 'related ticket outside the workspace' using errcode = '23503';
  end if;
  return new;
end;
$$;

-- With no membership (no default workspace to join), ensure_profile()
-- returned null and the app sent the user back to sign-in with no reason.
-- It now says what's wrong.
create or replace function ticketing.ensure_profile()
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
  if result is null then
    raise exception 'no workspace to join: the default workspace is missing';
  end if;
  return result;
end;
$$;
