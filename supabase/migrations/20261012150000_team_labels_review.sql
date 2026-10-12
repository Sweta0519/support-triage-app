-- SUP-39 review fixes for team labels (20261012140000 is already applied).
--
-- 1. Deleting a ticket (or a customer account, which cascades to their
--    tickets) cascades to ticket_labels; the history trigger then inserted a
--    ticket_events row for a ticket that no longer exists, so the FK made the
--    whole delete fail. Skip the event when the ticket is gone.
-- 2. Deleting a label cascades to ticket_labels after the label row is gone,
--    so the trigger's name lookup returned NULL and the history said
--    "removed" with no name. A BEFORE DELETE trigger on labels now records
--    those removals (it still sees the name), and the ticket_labels trigger
--    skips cascaded removals.
-- 3. The column revoke on labels did nothing next to a table-level UPDATE
--    grant: staff could rewrite created_by / created_at. Grant UPDATE on the
--    editable columns only.

create or replace function ticketing.record_ticket_label_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    select l.name into v_name from ticketing.labels l where l.id = new.label_id;
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.ticket_id, auth.uid(), 'label_added', null, v_name);
    return new;
  end if;
  -- Cascaded from the ticket's own deletion: nothing left to record on.
  if not exists (select 1 from ticketing.tickets t where t.id = old.ticket_id) then
    return old;
  end if;
  select l.name into v_name from ticketing.labels l where l.id = old.label_id;
  -- Cascaded from the label's deletion: record_label_deleted() already
  -- recorded it, with the name.
  if not found then
    return old;
  end if;
  insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
  values (old.ticket_id, auth.uid(), 'label_removed', v_name, null);
  return old;
end;
$$;

create or replace function ticketing.record_label_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
  select tl.ticket_id, auth.uid(), 'label_removed', old.name, null
  from ticketing.ticket_labels tl
  where tl.label_id = old.id;
  return old;
end;
$$;

revoke all on function ticketing.record_label_deleted() from public;

create trigger labels_record_deleted
  before delete on ticketing.labels
  for each row execute function ticketing.record_label_deleted();

revoke update on ticketing.labels from authenticated;
grant update (name, color) on ticketing.labels to authenticated;
