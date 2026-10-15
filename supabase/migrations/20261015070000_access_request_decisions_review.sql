-- SUP-68 review fixes (20261015060000 is already applied).
--
-- decide_access_request():
-- - granting changes the role only for a customer, making them an agent.
--   Someone already on the staff (an admin, say) keeps their role, and the
--   request is just closed, so granting never demotes anyone;
-- - takes admin_set_role()'s advisory lock before the profile row, the same
--   order a plain role change uses, so the two can't deadlock.
-- The backfill in 20261015060000 marked every earlier requester pending.
-- Anyone already on the staff is marked granted instead (their request was
-- in effect already granted).

update ticketing.profiles
set access_request_status = 'granted'
where access_request_status = 'pending' and role <> 'customer';

create or replace function ticketing.decide_access_request(p_user uuid, p_grant boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  perform pg_advisory_xact_lock(hashtext('ticketing.admin_set_role'));

  select p.access_request_ticket_id, p.role into v_ticket, v_role
  from ticketing.profiles p
  where p.id = p_user and p.access_request_status = 'pending'
  for update;
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

  select t.status into v_status from ticketing.tickets t where t.id = v_ticket;
  if v_status is not null and v_status <> 'closed' then
    insert into ticketing.ticket_comments (ticket_id, author_id, body, is_internal)
    values (
      v_ticket,
      auth.uid(),
      case
        when p_grant and v_role <> 'customer'
          then 'Your request is closed: you already have staff access to Support Triage.'
        when p_grant
          then 'Good news: you now have agent access to Support Triage. Reload the app to see the queue.'
        else 'Thanks for your interest in Support Triage. We can''t offer team access right now, but you can keep filing and following your own tickets here.'
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

revoke all on function ticketing.decide_access_request(uuid, boolean) from public, anon;
grant execute on function ticketing.decide_access_request(uuid, boolean) to authenticated;
