-- Phase 1 primitives — see FEATURES.md §4 and §6.
-- Adds: profiles, routines (+history), household_facts, weekly_context_notes,
-- and extends list_items with the richer metadata described in §4.1.
-- All tables family-scoped + RLS-gated using the existing macro.

set search_path = public;

-- =========================================================================
-- Profiles — non-auth household entities (kids, pets, dependents).
-- §7.3: polymorphic assignee references either family_members.id or profiles.id.
-- =========================================================================

create type profile_kind as enum ('child', 'pet', 'dependent', 'other');

create table profiles (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  kind profile_kind not null default 'other',
  color text not null default '#9aa8b0',
  attributes jsonb not null default '{}'::jsonb,
  -- Optional link to a real auth user if/when this profile gets their own login.
  member_id uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index profiles_family_idx on profiles(family_id);

-- =========================================================================
-- list_items metadata extension (§4.1)
-- All optional — default is still a one-line item.
-- =========================================================================

create type effort_size as enum ('xs', 's', 'm', 'l');
create type energy_level as enum ('low', 'medium', 'high');
create type nag_level as enum ('passive', 'surface', 'assertive');

alter table list_items
  add column notes               text,
  add column how                 text,
  add column when_hint           text,
  add column why                 text,
  add column deadline            timestamptz,
  add column lead_time_minutes   int,
  add column estimated_effort    effort_size,
  add column energy              energy_level,
  add column nag                 nag_level not null default 'surface',
  add column assignee_member_id  uuid references family_members(id) on delete set null,
  add column assignee_profile_id uuid references profiles(id) on delete set null,
  -- exactly-one (or none) of the assignee columns can be set
  add constraint list_items_single_assignee
    check (assignee_member_id is null or assignee_profile_id is null);

-- =========================================================================
-- Routines (§4.3)
-- =========================================================================

create type routine_cadence_type as enum ('calendar', 'interval');
create type routine_history_status as enum ('completed', 'skipped', 'snoozed');

create table routines (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  category text,                                  -- 'household' | 'yard' | 'bills' | 'maintenance' | 'kids' | 'pets' | custom
  cadence_type routine_cadence_type not null,
  cadence_rrule text,                             -- when cadence_type = 'calendar'
  interval_days int,                              -- when cadence_type = 'interval'
  next_due timestamptz,                           -- computed; null = compute on first surface
  owner_member_id uuid references family_members(id) on delete set null,
  owner_profile_id uuid references profiles(id) on delete set null,
  nag nag_level not null default 'surface',
  lead_time_days int,                             -- null = use cadence defaults (1d weekly, 3d weekly, 1w monthly, 2w quarterly+)
  estimated_effort effort_size,
  notes text,
  fair_rotation boolean not null default false,
  active boolean not null default true,
  pause_until date,
  pause_reason text,
  created_at timestamptz not null default now(),
  -- exactly-one (or none) of the owner columns can be set
  constraint routines_single_owner
    check (owner_member_id is null or owner_profile_id is null),
  -- cadence shape matches type
  constraint routines_cadence_shape
    check (
      (cadence_type = 'calendar' and cadence_rrule is not null and interval_days is null)
      or
      (cadence_type = 'interval' and interval_days is not null and cadence_rrule is null)
    )
);

create index routines_family_active_idx on routines(family_id, active);
create index routines_next_due_idx on routines(family_id, next_due) where active;

create table routine_history (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references routines(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  status routine_history_status not null,
  occurred_at timestamptz not null default now(),
  by_member_id uuid references family_members(id) on delete set null,
  snooze_until date,
  note text
);

create index routine_history_routine_idx on routine_history(routine_id, occurred_at desc);
create index routine_history_family_idx on routine_history(family_id, occurred_at desc);

-- =========================================================================
-- Household facts (§4.7)
-- Persistent facts about the household; queried by AI as retrieval context.
-- =========================================================================

create table household_facts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  key text not null,
  value text not null,
  category text,                                  -- 'medical' | 'services' | 'preferences' | 'household' | custom
  source text,                                    -- 'manual' | 'meeting' | 'voice' | ...
  last_updated timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (family_id, key)
);

create index household_facts_family_idx on household_facts(family_id);

-- =========================================================================
-- Weekly Context Notes (§4.6.1)
-- Ephemeral by design. Max 30-day expiry enforced; auto-deleted by scheduled job.
-- =========================================================================

create type context_note_type as enum ('emotional', 'situational', 'privacy_restriction', 'celebration');

create table weekly_context_notes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  content text not null,
  type context_note_type not null default 'situational',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  influences text[] not null default array['briefing_tone']::text[],
  suppress_topics text[] not null default array[]::text[],
  created_by_member_id uuid references family_members(id) on delete set null,
  -- §4.6.1 design principle 5: capped duration, enforced.
  constraint weekly_context_notes_max_30d
    check (expires_at <= created_at + interval '30 days'),
  constraint weekly_context_notes_future_expiry
    check (expires_at > created_at)
);

create index weekly_context_notes_family_active_idx
  on weekly_context_notes(family_id, expires_at);

-- Reaper: hard-delete expired notes. Run via pg_cron or scheduled Edge Function.
create or replace function public.reap_expired_context_notes()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  reaped int := 0;
begin
  delete from weekly_context_notes where expires_at <= now();
  get diagnostics reaped = row_count;
  return reaped;
end;
$$;

revoke all on function public.reap_expired_context_notes() from public;
grant execute on function public.reap_expired_context_notes() to authenticated;

-- =========================================================================
-- RLS — family-scoped on all new tables (same macro as init schema).
-- =========================================================================

alter table profiles              enable row level security;
alter table routines              enable row level security;
alter table routine_history       enable row level security;
alter table household_facts       enable row level security;
alter table weekly_context_notes  enable row level security;

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'routines', 'routine_history',
    'household_facts', 'weekly_context_notes'
  ];
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
-- Realtime — surface routines/facts/notes to subscribers (Display app needs them).
-- =========================================================================

alter publication supabase_realtime add table
  profiles, routines, routine_history, household_facts, weekly_context_notes;
