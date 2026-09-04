-- Suggestion from audit #4 (docs/security/audit-4-fresh-context-rescan.md):
-- the shared-auth.users triggers correctly swallow unique_violation on the
-- lower(email) unique index so they never abort the other app's write, but
-- did so silently -- a stale ticketing.profiles.email would leave no trace.
-- Log it (does not fail the transaction) so it's discoverable in Postgres
-- logs instead of invisible.
create or replace function ticketing.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null then
    return new;
  end if;

  begin
    insert into ticketing.profiles (id, email, role)
    values (new.id, new.email, 'customer')
    on conflict (id) do nothing;
  exception when unique_violation then
    raise warning 'ticketing.handle_new_user: email % already used by another profile (auth.users id %)', new.email, new.id;
  end;
  return new;
end;
$$;

create or replace function ticketing.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and new.email is distinct from old.email then
    begin
      update ticketing.profiles
      set email = new.email, updated_at = now()
      where id = new.id;
    exception when unique_violation then
      raise warning 'ticketing.sync_profile_email: email % already used by another profile (auth.users id %)', new.email, new.id;
    end;
  end if;
  return new;
end;
$$;
