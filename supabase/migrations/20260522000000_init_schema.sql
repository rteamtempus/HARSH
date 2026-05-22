-- HARSH initial schema
-- Multi-tenant from day one: every domain table carries family_id and is gated by RLS.
-- See GAMEPLAN.md §4 for the data-model rationale.

set search_path = public;

create extension if not exists "pgcrypto";

-- =========================================================================
-- Families & membership
-- =========================================================================

create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create type family_member_role as enum ('owner', 'adult', 'kid');

create table family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  role family_member_role not null default 'adult',
  display_name text not null,
  color text not null default '#6b8e9e',
  avatar_url text,
  invited_email text,
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);

create index family_members_family_idx on family_members(family_id);
create index family_members_user_idx on family_members(user_id);

-- Helper: families the current auth user belongs to.
create or replace function public.current_user_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from family_members where user_id = auth.uid();
$$;

-- =========================================================================
-- Lists
-- =========================================================================

create type list_kind as enum ('grocery', 'todo', 'custom');

create table lists (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  kind list_kind not null default 'custom',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index lists_family_idx on lists(family_id);

create table list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  text text not null,
  checked boolean not null default false,
  added_by_member_id uuid references family_members(id) on delete set null,
  sort_order int not null default 0,
  added_at timestamptz not null default now(),
  checked_at timestamptz
);

create index list_items_list_idx on list_items(list_id);
create index list_items_family_idx on list_items(family_id);

-- =========================================================================
-- Events (calendar)
-- =========================================================================

create type event_source as enum ('manual', 'gcal', 'voice');

create table events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  notes text,
  owner_member_id uuid references family_members(id) on delete set null,
  source event_source not null default 'manual',
  external_id text,
  created_at timestamptz not null default now()
);

create index events_family_starts_idx on events(family_id, starts_at);

-- =========================================================================
-- Notes
-- =========================================================================

create table notes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  body text not null,
  pinned boolean not null default false,
  created_by_member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index notes_family_idx on notes(family_id);

-- =========================================================================
-- Display configuration
-- =========================================================================

create table display_config (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null default 'Living Room',
  layout jsonb not null default '{"widgets": []}'::jsonb,
  active_view text not null default 'home',
  device_pairing_code text,
  device_paired_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (family_id, name)
);

create index display_config_family_idx on display_config(family_id);

-- =========================================================================
-- AI log -- non-negotiable per GAMEPLAN.md §4
-- =========================================================================

create table ai_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  member_id uuid references family_members(id) on delete set null,
  surface text not null,                  -- 'portal' | 'display'
  transcript text not null,
  parsed_intent jsonb,
  result jsonb,
  error text,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index ai_log_family_created_idx on ai_log(family_id, created_at desc);

-- =========================================================================
-- Row-Level Security
-- =========================================================================

alter table families        enable row level security;
alter table family_members  enable row level security;
alter table lists           enable row level security;
alter table list_items      enable row level security;
alter table events          enable row level security;
alter table notes           enable row level security;
alter table display_config  enable row level security;
alter table ai_log          enable row level security;

-- families: a user can see/update families they are a member of; insert is allowed
-- to any authenticated user (used by the new-family signup flow, which also creates
-- the owning family_members row in a transaction).
create policy families_select on families
  for select to authenticated
  using (id in (select public.current_user_family_ids()));

create policy families_insert on families
  for insert to authenticated
  with check (true);

create policy families_update on families
  for update to authenticated
  using (id in (select public.current_user_family_ids()))
  with check (id in (select public.current_user_family_ids()));

-- family_members: visible to anyone in the same family; only owners can modify membership.
create policy family_members_select on family_members
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));

create policy family_members_self_insert on family_members
  for insert to authenticated
  with check (
    -- either you're the owner of an existing family
    family_id in (
      select fm.family_id from family_members fm
      where fm.user_id = auth.uid() and fm.role = 'owner'
    )
    -- or you're claiming your own newly-created family row
    or user_id = auth.uid()
  );

create policy family_members_owner_update on family_members
  for update to authenticated
  using (
    family_id in (
      select fm.family_id from family_members fm
      where fm.user_id = auth.uid() and fm.role = 'owner'
    )
    or user_id = auth.uid()
  );

create policy family_members_owner_delete on family_members
  for delete to authenticated
  using (
    family_id in (
      select fm.family_id from family_members fm
      where fm.user_id = auth.uid() and fm.role = 'owner'
    )
  );

-- Uniform family-scoped policies for the rest.
-- Macro pattern: select/insert/update/delete gated on family_id membership.
do $$
declare
  t text;
  tables text[] := array['lists','list_items','events','notes','display_config','ai_log'];
begin
  foreach t in array tables loop
    execute format($f$
      create policy %1$I_select on %1$I
        for select to authenticated
        using (family_id in (select public.current_user_family_ids()));
      create policy %1$I_insert on %1$I
        for insert to authenticated
        with check (family_id in (select public.current_user_family_ids()));
      create policy %1$I_update on %1$I
        for update to authenticated
        using (family_id in (select public.current_user_family_ids()))
        with check (family_id in (select public.current_user_family_ids()));
      create policy %1$I_delete on %1$I
        for delete to authenticated
        using (family_id in (select public.current_user_family_ids()));
    $f$, t);
  end loop;
end $$;

-- =========================================================================
-- Realtime publication
-- =========================================================================
-- Tables the Display app subscribes to for live updates.
alter publication supabase_realtime add table lists, list_items, events, notes, display_config;
