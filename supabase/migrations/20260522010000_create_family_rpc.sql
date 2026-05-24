-- create_family: atomically insert a family + its seed members and link the
-- owner to the calling auth.uid(). Runs as SECURITY DEFINER to bypass the
-- chicken-and-egg where the new family has no members yet and therefore is
-- invisible to RLS during the INSERT ... RETURNING.

create or replace function public.create_family(
  family_name text,
  members jsonb,
  owner_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_family_id uuid;
  uid uuid := auth.uid();
  m jsonb;
  is_owner boolean;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_typeof(members) <> 'array' or jsonb_array_length(members) = 0 then
    raise exception 'members must be a non-empty array';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(members) elem
    where lower(elem->>'display_name') = lower(owner_display_name)
  ) then
    raise exception 'owner display_name must match one of the members';
  end if;

  insert into families (name) values (family_name) returning id into new_family_id;

  for m in select value from jsonb_array_elements(members) loop
    is_owner := lower(m->>'display_name') = lower(owner_display_name);
    insert into family_members (family_id, display_name, color, role, user_id, invited_email)
    values (
      new_family_id,
      m->>'display_name',
      coalesce(m->>'color', '#6b8e9e'),
      case
        when is_owner then 'owner'::family_member_role
        else coalesce(nullif(m->>'role','')::family_member_role, 'adult'::family_member_role)
      end,
      case when is_owner then uid else null end,
      case when not is_owner then nullif(m->>'invited_email','') else null end
    );
  end loop;

  return new_family_id;
end;
$$;

revoke all on function public.create_family(text, jsonb, text) from public;
grant execute on function public.create_family(text, jsonb, text) to authenticated;
