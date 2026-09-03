-- AI triage: the append-only record of what the model said about a ticket,
-- the vector store used to find duplicate/related tickets, and the
-- similarity-search function. Everything here is written exclusively by
-- server-only code holding the service-role key (app/lib/ai/, app/lib/db/
-- triage.ts) -- `authenticated` can only ever *read* triage_results, and
-- only as staff.

create extension if not exists vector with schema extensions;

-- What the AI said, kept separately from tickets' working state so the UI
-- can show "AI said High -> agent set Normal" and the feature stays
-- auditable rather than magic. One row per triage run (re-runs append).
create table ticketing.triage_results (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references ticketing.tickets (id) on delete cascade,
  model text not null,
  prompt_version text not null,
  summary text not null,
  category ticketing.ticket_category,
  priority ticketing.ticket_priority,
  priority_reason text,
  team ticketing.ticket_team,
  frustration smallint check (frustration between 1 and 5),
  is_escalation_risk boolean not null default false,
  duplicate_of uuid references ticketing.tickets (id) on delete set null,
  related_ticket_ids uuid[] not null default '{}',
  suggested_reply text,
  missing_info text[] not null default '{}',
  confidence real check (confidence between 0 and 1),
  needs_human_review boolean not null default false,
  raw jsonb,
  prompt_tokens int,
  completion_tokens int,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index triage_results_ticket_id_idx on ticketing.triage_results (ticket_id, created_at desc);

alter table ticketing.triage_results enable row level security;

grant select on ticketing.triage_results to authenticated;
grant all on ticketing.triage_results to service_role;

-- Customers must never see triage output: it contains a draft reply the
-- agent hasn't approved, the model's priority reasoning, and the IDs of
-- *other customers'* tickets it judged similar.
create policy "triage_results_select_staff" on ticketing.triage_results
  for select
  to authenticated
  using (
    (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

-- Separate table so the 1536-float vector never rides along on ordinary
-- ticket selects, and so it can be deny-all to end users outright.
-- embedding_model is stored per row because changing the embedding model
-- silently breaks retrieval (vectors from different models aren't
-- comparable) -- the column is what lets a future migration find rows that
-- need re-embedding instead of guessing.
create table ticketing.ticket_embeddings (
  ticket_id uuid primary key references ticketing.tickets (id) on delete cascade,
  embedding extensions.vector(1536) not null,
  embedding_model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ticket_embeddings_embedding_idx on ticketing.ticket_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

alter table ticketing.ticket_embeddings enable row level security;
-- Deny-all: no policies, no grants to `authenticated`.
grant all on ticketing.ticket_embeddings to service_role;

-- Nearest-neighbour lookup by cosine distance (`<=>`). Returns subject and
-- the latest triage summary only -- never a full body -- so the amount of
-- another customer's text that flows into a triage prompt stays minimal.
-- SECURITY INVOKER is fine here because only service_role can execute it.
create or replace function ticketing.match_tickets(
  query_embedding extensions.vector(1536),
  match_count int,
  exclude_ticket_id uuid
)
returns table (
  ticket_id uuid,
  subject text,
  status ticketing.ticket_status,
  latest_summary text,
  similarity float
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    t.id,
    t.subject,
    t.status,
    (
      select tr.summary
      from ticketing.triage_results tr
      where tr.ticket_id = t.id
      order by tr.created_at desc
      limit 1
    ),
    1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
  from ticketing.ticket_embeddings e
  join ticketing.tickets t on t.id = e.ticket_id
  where e.ticket_id <> exclude_ticket_id
  order by e.embedding operator(extensions.<=>) query_embedding asc
  limit least(match_count, 20);
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default. Pull that
-- back so the only role that can run a similarity search is service_role.
revoke all on function ticketing.match_tickets(extensions.vector, int, uuid) from public;
grant execute on function ticketing.match_tickets(extensions.vector, int, uuid) to service_role;
