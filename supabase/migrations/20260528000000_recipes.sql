-- Recipes v1: capture photos of recipes + minimal metadata.
-- See FEATURES_HOUSEHOLD_EXPANSION.md §3.

set search_path = public;

create table recipes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  title text not null,
  notes text,
  -- Storage object key in the recipe-photos bucket. Convention: <family_id>/<recipe_id>.<ext>
  photo_path text,
  source text not null default 'photo'
    check (source in ('photo', 'handwritten', 'web', 'manual')),
  source_url text,
  tags text[] not null default '{}'::text[],
  created_by_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index recipes_family_idx on recipes(family_id, created_at desc);
create index recipes_tags_idx on recipes using gin (tags);

alter table recipes enable row level security;

create policy recipes_select on recipes
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));
create policy recipes_insert on recipes
  for insert to authenticated
  with check (family_id in (select public.current_user_family_ids()));
create policy recipes_update on recipes
  for update to authenticated
  using (family_id in (select public.current_user_family_ids()))
  with check (family_id in (select public.current_user_family_ids()));
create policy recipes_delete on recipes
  for delete to authenticated
  using (family_id in (select public.current_user_family_ids()));

alter publication supabase_realtime add table recipes;

-- Private storage bucket. Same family-scoped policies as briefing-audio /
-- meeting-audio. Path convention: <family_id>/<recipe_id>.<ext>
insert into storage.buckets (id, name, public)
  values ('recipe-photos', 'recipe-photos', false)
  on conflict (id) do nothing;

create policy "recipe photos read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recipe-photos'
    and split_part(name, '/', 1)::uuid in (select public.current_user_family_ids())
  );

create policy "recipe photos insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recipe-photos'
    and split_part(name, '/', 1)::uuid in (select public.current_user_family_ids())
  );

create policy "recipe photos delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'recipe-photos'
    and split_part(name, '/', 1)::uuid in (select public.current_user_family_ids())
  );
