-- SUP-53 review fixes (20261015000000 is already applied).
--
-- The BEFORE INSERT trigger runs before RLS's WITH CHECK, and as security
-- definer it counted new.owner_id's tokens without checking who that is:
-- an insert with someone else's owner_id answered "too_many_tokens" when
-- they had 10 (an oracle), and spent the caller's rate-limit quota. It now
-- refuses another user's owner_id first. Concurrent inserts could also each
-- count 9 and all succeed; a per-owner transaction lock serialises them, so
-- the cap of 10 active tokens (MAX_ACTIVE_TOKENS in
-- app/lib/access-token-options.ts) holds exactly.

create or replace function ticketing.access_tokens_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A signed-in user only ever creates their own tokens. (The service role,
  -- with no auth.uid(), is the only other writer.)
  if auth.uid() is not null and new.owner_id is distinct from auth.uid() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('access_tokens:' || new.owner_id::text));

  if (
    select count(*) from ticketing.access_tokens t
    where t.owner_id = new.owner_id
      and t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
  ) >= 10 then
    raise exception 'too_many_tokens' using errcode = 'P0001';
  end if;
  if auth.uid() is not null and not ticketing.consume_rate_limit('access_token') then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function ticketing.access_tokens_before_insert() from public;
