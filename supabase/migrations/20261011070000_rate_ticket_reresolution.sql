-- Review of SUP-26 (PR #25): a reopened ticket kept its rating credited
-- to the agent of the first resolution. If the customer rates again after
-- the ticket was resolved a second time (resolved_at is later than the
-- rating's last change), the credit moves to the current assignee. The
-- analytics page also only counts ratings of tickets that are currently
-- resolved or closed, so a reopened ticket's old rating doesn't count
-- while it's being worked again.

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

  -- FOR SHARE: a concurrent close (UPDATE of the ticket) waits for this
  -- rating, or this waits for the close and then sees 'closed'.
  select * into v_ticket from ticketing.tickets where id = p_ticket_id for share;
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
        comment = excluded.comment,
        -- Rated again after a *new* resolution (the ticket was reopened and
        -- resolved again since the last rating): credit whoever has it now.
        -- Otherwise keep the original snapshot.
        agent_id = case
          when v_ticket.resolved_at > ticketing.ticket_ratings.updated_at then excluded.agent_id
          else ticketing.ticket_ratings.agent_id
        end;
end;
$$;
