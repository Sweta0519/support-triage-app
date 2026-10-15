-- SUP-68 review: a role change made on the Users page settles a pending
-- access request too. admin_set_role() is as in 20260903090000_audit3_fixes.sql,
-- plus marking the request granted when the new role is agent or admin.

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

  perform pg_advisory_xact_lock(hashtext('ticketing.admin_set_role'));

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
    where assignee_id = target_user_id;
  end if;
end;
$$;
