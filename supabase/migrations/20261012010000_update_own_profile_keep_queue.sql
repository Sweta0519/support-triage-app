-- Review of SUP-22 (PR #29): a customer's settings form has no queue
-- fields, so the action re-sent the stored queue defaults and the function
-- rewrote them -- a stale value could overwrite a newer one. Null now means
-- "leave it as it is" for the two queue defaults.

create or replace function ticketing.update_own_profile(
  p_full_name text,
  p_theme text,
  p_queue_default_filter text,
  p_queue_default_sort text
)
returns ticketing.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  result ticketing.profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not ticketing.consume_rate_limit('update_profile') then
    raise exception 'rate_limited:update_profile';
  end if;

  if v_name is not null and (char_length(v_name) > 80 or v_name ~ '[[:cntrl:]]') then
    raise exception 'invalid_full_name' using errcode = '22023';
  end if;

  update ticketing.profiles
  set full_name = v_name,
      theme = p_theme,
      queue_default_filter = coalesce(p_queue_default_filter, queue_default_filter),
      queue_default_sort = coalesce(p_queue_default_sort, queue_default_sort),
      updated_at = now()
  where id = v_uid
  returning * into result;

  if result.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

