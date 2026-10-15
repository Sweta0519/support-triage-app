-- SUP-53 review: tokens are created by the database, not by the client.
--
-- The column INSERT grant let a signed-in user store any token_hash they
-- liked, i.e. register a weak, self-chosen secret (sha256 of "password") that
-- the MCP endpoint would then accept. create_access_token() now generates
-- the secret itself (32 random bytes, "st_" + base64url), stores only its
-- SHA-256 hash, and returns the secret once. Users lose INSERT on the table.
-- The before-insert trigger still enforces the cap and the rate limit.

create or replace function ticketing.create_access_token(p_name text, p_expires_in_days int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- The Account page's choices (TOKEN_LIFETIMES); null is "no expiry".
  if p_expires_in_days is not null and p_expires_in_days not in (30, 90, 365) then
    raise exception 'invalid_lifetime' using errcode = '22023';
  end if;

  v_token := 'st_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into ticketing.access_tokens (owner_id, name, token_hash, prefix, expires_at)
  values (
    auth.uid(),
    btrim(p_name),
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    left(v_token, 11),
    case when p_expires_in_days is null then null else now() + make_interval(days => p_expires_in_days) end
  );
  return v_token;
end;
$$;

revoke all on function ticketing.create_access_token(text, int) from public, anon;
grant execute on function ticketing.create_access_token(text, int) to authenticated;

drop policy access_tokens_insert_own on ticketing.access_tokens;
revoke insert on ticketing.access_tokens from authenticated;
