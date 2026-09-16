-- GDPR access/portability (Art. 15/20) and erasure (Art. 17), the two
-- Critical findings the gdpr-compliance audit left open after PR #9.
--
-- Deletion itself is `auth.admin.deleteUser()` from the service-role client
-- (app/lib/db/account.ts); the ticketing tables already cascade from
-- auth.users. This migration fixes the two things a bare cascade got wrong
-- and adds the export.

-- 1. A staff member's comments used to cascade-delete with their account,
--    silently erasing replies from customers' ticket histories. Keep the
--    comment, drop the author -- the same "actor unknown" precedent
--    ticket_events.actor_id already uses. The customer's own comments still
--    disappear with their tickets, which is the erasure they asked for.
alter table ticketing.ticket_comments
  alter column author_id drop not null;

alter table ticketing.ticket_comments
  drop constraint ticket_comments_author_id_fkey;

alter table ticketing.ticket_comments
  add constraint ticket_comments_author_id_fkey
  foreign key (author_id) references auth.users (id) on delete set null;

-- 2. The last admin must not be able to delete themselves and leave the app
--    with nobody who can manage roles. admin_set_role() already refuses to
--    demote the last admin; mirror that for deletion. Because the cascade
--    from auth.users deletes the profiles row inside the same transaction, a
--    BEFORE DELETE row trigger here aborts the whole account deletion.
create or replace function ticketing.guard_last_admin_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and not exists (
    select 1 from ticketing.profiles p
    where p.role = 'admin' and p.id <> old.id
  ) then
    raise exception 'last_admin: the only admin cannot delete their account';
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_guard_last_admin_delete on ticketing.profiles;
create trigger profiles_guard_last_admin_delete
  before delete on ticketing.profiles
  for each row execute function ticketing.guard_last_admin_delete();

-- 3. One call that returns everything the caller can see about themselves.
--    SECURITY INVOKER on purpose: RLS still applies, so a customer's export
--    cannot contain internal comments, triage results, or anyone else's
--    rows, and every branch is additionally pinned to auth.uid(). Staff-only
--    tables simply come back as empty arrays for a customer.
create or replace function ticketing.export_own_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'email', p.email, 'full_name', p.full_name,
        'role', p.role, 'created_at', p.created_at
      )
      from ticketing.profiles p
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

revoke execute on function ticketing.export_own_data() from public, anon;
grant execute on function ticketing.export_own_data() to authenticated;
