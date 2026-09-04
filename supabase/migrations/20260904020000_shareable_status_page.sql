-- Hard-tier optional task: shareable AI outputs. Staff can publish a
-- read-only public status page for a ticket -- its subject, status, and the
-- AI's summary -- to an unguessable URL. Unauthenticated visitors can view
-- that one page and nothing else: this table is never exposed to `anon`
-- through the Data API (unlike every other table here, which grants to
-- `authenticated`, this one grants nothing to either `anon` or
-- `authenticated` for the public read path -- see app/lib/db/shares.ts).
-- The token's 128 bits of entropy is the actual access control for the
-- public read, the same trust model as a password-reset or magic-link URL:
-- knowing it is what proves you're allowed to see it, not a database policy.

create extension if not exists pgcrypto with schema extensions;

create table ticketing.shared_ticket_summaries (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references ticketing.tickets (id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  published_by uuid not null references auth.users (id) on delete cascade,
  -- Snapshot at publish time, not a live join to tickets/triage_results.
  -- The public route (service role) only ever queries this one table by
  -- exact token match -- it never touches tickets, profiles, or
  -- triage_results, so there is no join to get wrong and no way for a
  -- future change to this table's policies to leak anything beyond what
  -- staff explicitly chose to publish.
  subject text not null,
  status ticketing.ticket_status not null,
  summary text not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create index shared_ticket_summaries_ticket_id_idx on ticketing.shared_ticket_summaries (ticket_id);

alter table ticketing.shared_ticket_summaries enable row level security;

-- Staff-side management (publish/view/revoke) goes through the normal
-- authenticated client and is scoped exactly like every other child table:
-- can_view_ticket() ties it to the same visibility rule as the ticket
-- itself. Grants are select/insert/update only -- no delete, so a
-- published-then-revoked link stays as an audit record.
grant select, insert, update (revoked) on ticketing.shared_ticket_summaries to authenticated;
grant all on ticketing.shared_ticket_summaries to service_role;

create policy "shared_ticket_summaries_select_staff" on ticketing.shared_ticket_summaries
  for select
  to authenticated
  using (
    (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

create policy "shared_ticket_summaries_insert_staff" on ticketing.shared_ticket_summaries
  for insert
  to authenticated
  with check (
    published_by = auth.uid()
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

create policy "shared_ticket_summaries_revoke_staff" on ticketing.shared_ticket_summaries
  for update
  to authenticated
  using (
    (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  )
  with check (
    (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

-- Deliberately no grant to `anon` at all -- see the comment at the top of
-- this file. The public page reads this table with the service-role
-- client, doing an exact `where token = $1 and revoked = false` lookup and
-- selecting only the four display columns, never a broad select.
