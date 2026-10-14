-- SUP-43: learning from corrections. When staff correct the AI's triage,
-- that correction becomes an example the AI sees when it triages similar
-- tickets later. Examples carry only the AI's one-line summary of the past
-- ticket plus what the AI said and what staff changed it to -- never the
-- ticket's own text.
--
-- A correction: a reviewed ticket whose working priority/category/team
-- differ from the AI run the reviewer was shown (reviewed_result_id).
-- Any staff member's correction counts (the owner's choice); an admin can
-- exclude a bad one from learning without touching the review itself.

alter table ticketing.ticket_triage_state
  add column learning_excluded_at timestamptz,
  add column learning_excluded_by uuid references auth.users (id) on delete set null;

-- The tickets whose corrections an AI run was shown, for the triage panel
-- ("Learned from 2 past corrections") and for auditing a run later.
alter table ticketing.triage_results
  add column learned_from uuid[] not null default '{}';

-- The most similar corrected tickets to a new one. Service role only (the
-- triage pipeline); the caller passes the new ticket's embedding.
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
  select
    s.ticket_id,
    r.summary,
    r.priority::text, r.category::text, r.team::text,
    s.priority::text, s.category::text, s.team::text,
    1 - (e.embedding operator(extensions.<=>) p_embedding)
  from ticketing.ticket_triage_state s
  join ticketing.triage_results r on r.id = s.reviewed_result_id
  join ticketing.ticket_embeddings e on e.ticket_id = s.ticket_id
  where s.ticket_id <> p_exclude_ticket_id
    and s.reviewed_at is not null
    and s.learning_excluded_at is null
    and (r.priority, r.category, r.team) is distinct from (s.priority, s.category, s.team)
    and 1 - (e.embedding operator(extensions.<=>) p_embedding) >= p_threshold
  order by e.embedding operator(extensions.<=>) p_embedding
  limit least(greatest(p_limit, 0), 5);
$$;

revoke all on function ticketing.match_triage_corrections(extensions.vector, uuid, double precision, int) from public;
grant execute on function ticketing.match_triage_corrections(extensions.vector, uuid, double precision, int) to service_role;

-- Admins only: stop (or resume) learning from one ticket's correction.
create or replace function ticketing.set_learning_excluded(p_ticket_id uuid, p_excluded boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select ticketing.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update ticketing.ticket_triage_state
  set learning_excluded_at = case when p_excluded then now() else null end,
      learning_excluded_by = case when p_excluded then auth.uid() else null end
  where ticket_id = p_ticket_id;
  return found;
end;
$$;

revoke all on function ticketing.set_learning_excluded(uuid, boolean) from public;
grant execute on function ticketing.set_learning_excluded(uuid, boolean) to authenticated;
