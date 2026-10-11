-- SUP-26: customer satisfaction (CSAT). When a ticket is resolved, its
-- customer can rate it 1-5 with an optional comment. One rating per
-- ticket; it can be changed while the ticket is resolved and is locked
-- once it's closed (or reopened). The rating credits the assignee at the
-- moment it was first given (agent_id), so reassigning the ticket later
-- doesn't move the credit.

create table ticketing.ticket_ratings (
  ticket_id uuid primary key references ticketing.tickets (id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  -- The customer who rated. Account deletion cascades the rating away.
  rated_by uuid not null references auth.users (id) on delete cascade,
  -- Snapshot of the assignee when the rating was first given; null if the
  -- ticket was unassigned. A deleted staff account keeps the score
  -- (team CSAT) but drops the attribution.
  agent_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ticket_ratings_agent_id_idx on ticketing.ticket_ratings (agent_id);

create trigger ticket_ratings_set_updated_at
  before update on ticketing.ticket_ratings
  for each row execute function ticketing.set_updated_at();

alter table ticketing.ticket_ratings enable row level security;

-- Read-only for clients; every write goes through rate_ticket() below.
grant select on ticketing.ticket_ratings to authenticated;
grant all on ticketing.ticket_ratings to service_role;

-- The customer sees their own rating; an admin sees every rating; an
-- agent sees only ratings credited to them (not colleagues').
create policy "ticket_ratings_select" on ticketing.ticket_ratings
  for select
  to authenticated
  using (
    rated_by = (select auth.uid())
    or (select ticketing.is_admin())
    or ((select ticketing.is_staff()) and agent_id = (select auth.uid()))
  );

create or replace function ticketing.consume_rate_limit(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_window_seconds int;
  v_key text;
  v_window_start timestamptz;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  case p_action
    when 'create_ticket' then v_limit := 10; v_window_seconds := 3600;
    when 'staff_create_ticket' then v_limit := 30; v_window_seconds := 3600;
    when 'add_comment'   then v_limit := 30; v_window_seconds := 600;
    when 'rerun_triage'  then v_limit := 5;  v_window_seconds := 600;
    when 'assistant_message' then v_limit := 20; v_window_seconds := 600;
    when 'save_note'     then v_limit := 30; v_window_seconds := 600;
    when 'rate_ticket'   then v_limit := 10; v_window_seconds := 600;
    else raise exception 'unknown rate limit action';
  end case;

  v_key := auth.uid()::text || ':' || p_action;
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds
  );

  insert into ticketing.rate_limits (key, window_start, count)
  values (v_key, v_window_start, 1)
  on conflict (key, window_start)
    do update set count = ticketing.rate_limits.count + 1
  returning count into v_count;

  if random() < 0.01 then
    delete from ticketing.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= v_limit;
end;
$$;

-- The only way to write a rating. SECURITY DEFINER because authenticated
-- has no write grant on ticket_ratings; every rule is checked here:
--   * the caller is the ticket's customer (staff can't rate)
--   * the ticket is resolved (not open, not closed)
--   * score 1-5, comment <= 500 chars (also table constraints)
--   * rate limited ('rate_ticket', 10 per 10 minutes)
-- First rating snapshots the current assignee into agent_id; a later
-- change while still resolved keeps that snapshot.
create or replace function ticketing.rate_ticket(
  p_ticket_id uuid,
  p_score smallint,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ticket ticketing.tickets%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_uid is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_ticket from ticketing.tickets where id = p_ticket_id;
  if not found or v_ticket.customer_id <> v_uid then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_ticket.status <> 'resolved' then
    raise exception 'not_resolved' using errcode = '22023';
  end if;
  if p_score is null or p_score < 1 or p_score > 5 then
    raise exception 'invalid_score' using errcode = '22023';
  end if;

  if not ticketing.consume_rate_limit('rate_ticket') then
    raise exception 'rate_limited:rate_ticket';
  end if;

  insert into ticketing.ticket_ratings (ticket_id, score, comment, rated_by, agent_id)
  values (p_ticket_id, p_score, v_comment, v_uid, v_ticket.assignee_id)
  on conflict (ticket_id) do update
    set score = excluded.score,
        comment = excluded.comment;
end;
$$;

revoke all on function ticketing.rate_ticket(uuid, smallint, text) from public;
grant execute on function ticketing.rate_ticket(uuid, smallint, text) to authenticated;

-- The GDPR export (Art. 15/20) gains the customer's own ratings. Same
-- function as 20260915000000 with one added key, 'ratings_i_gave'.
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
    'ratings_i_gave', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ticket_id', r.ticket_id, 'score', r.score, 'comment', r.comment,
        'created_at', r.created_at, 'updated_at', r.updated_at
      ) order by r.created_at), '[]'::jsonb)
      from ticketing.ticket_ratings r
      where r.rated_by = (select auth.uid())
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
