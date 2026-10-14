-- SUP-43 review fixes, part 2.
--
-- 1. match_triage_corrections() ranked by distance over ticket_embeddings,
--    so the HNSW index returned its ~40 nearest tickets first and the
--    corrected/not-excluded filter ran after that. Corrections are a small
--    share of tickets, so on a larger table none of those 40 would qualify
--    and the AI would silently stop learning. Now the corrected tickets are
--    selected first (a materialized CTE the index can't apply to) and only
--    those are ranked.
-- 2. triage_results.learned_examples: a snapshot of each correction exactly
--    as the AI was shown it (what the AI said, what staff changed it to), so
--    the panel shows what a run learned from even if that ticket is
--    reviewed again later.

create or replace function ticketing.match_triage_corrections(
  p_embedding extensions.vector(1536),
  p_exclude_ticket_id uuid,
  p_threshold double precision,
  p_limit int
)
returns table (
  ticket_id uuid,
  summary text,
  ai_priority text,
  ai_category text,
  ai_team text,
  priority text,
  category text,
  team text,
  similarity double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with corrections as materialized (
    select
      s.ticket_id,
      r.summary,
      r.priority::text as ai_priority, r.category::text as ai_category, r.team::text as ai_team,
      s.priority::text as priority, s.category::text as category, s.team::text as team,
      e.embedding
    from ticketing.ticket_triage_state s
    join ticketing.triage_results r on r.id = s.reviewed_result_id
    join ticketing.ticket_embeddings e on e.ticket_id = s.ticket_id
    where s.ticket_id <> p_exclude_ticket_id
      and s.reviewed_at is not null
      and s.learning_excluded_at is null
      and (r.priority, r.category, r.team) is distinct from (s.priority, s.category, s.team)
  ), ranked as (
    select c.*, 1 - (c.embedding operator(extensions.<=>) p_embedding) as similarity
    from corrections c
  )
  select ticket_id, summary, ai_priority, ai_category, ai_team, priority, category, team, similarity
  from ranked
  where similarity >= p_threshold
  order by similarity desc
  limit least(greatest(p_limit, 0), 5);
$$;

alter table ticketing.triage_results
  add column learned_examples jsonb not null default '[]'::jsonb;
