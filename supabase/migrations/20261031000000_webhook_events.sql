-- SUP-94: log of signed outbound webhooks (n8n). One row per (event, ticket),
-- so re-running triage never sends the same escalation twice. Written only by
-- the service role; admins can read their own workspace's rows.
create table ticketing.webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('ticket.escalation_flagged')),
  ticket_id uuid not null references ticketing.tickets (id) on delete cascade,
  workspace_id uuid not null references ticketing.workspaces (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (event_type, ticket_id)
);

create trigger webhook_events_000_set_workspace before insert or update of ticket_id, workspace_id
  on ticketing.webhook_events for each row execute function ticketing.set_workspace_from_ticket();

alter table ticketing.webhook_events enable row level security;
revoke all on ticketing.webhook_events from anon, authenticated;
grant select on ticketing.webhook_events to authenticated;
grant all on ticketing.webhook_events to service_role;

create policy webhook_events_select_admin on ticketing.webhook_events for select to authenticated
  using (workspace_id = (select ticketing.current_workspace_id()) and (select ticketing.is_admin()));
