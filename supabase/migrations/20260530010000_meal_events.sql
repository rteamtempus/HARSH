-- H2 follow-on: meal_events + recipe cost fields.
-- Owner asked to pull meal-cost tracking into H2 (originally scheduled for H4)
-- so we capture both "what did this meal cost" AND "what did we waste from it"
-- in the same iteration.
--
-- D1 (editable cost) and D9 (multi-path meal capture) drive the schema choices.

set search_path = public;

-- ============================================================
-- Recipe cost fields (extend existing recipes table)
-- ============================================================

alter table recipes
  add column if not exists estimated_cost_cents int,   -- editable; wife can update for sale prices (D1)
  add column if not exists servings int,                -- default servings the recipe makes
  add column if not exists last_made_at timestamptz;

-- ============================================================
-- Meal events
-- ============================================================
-- Each row is one cook event. Created at cook time, edited at discard time
-- to record what got wasted. Cost is snapshotted from the recipe at cook
-- time so later recipe edits don't rewrite history, but is editable per D1.

create table meal_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  recipe_id uuid references recipes(id) on delete set null,
  recipe_name_snapshot text not null,                   -- captured at cook time
  occurred_at timestamptz not null default now(),
  servings_made int,
  servings_eaten int,
  servings_wasted int generated always as (
    case
      when servings_made is null or servings_eaten is null then null
      else greatest(servings_made - servings_eaten, 0)
    end
  ) stored,
  -- Cost snapshot at cook time; editable for sale prices (D1).
  estimated_total_cost_cents int,
  -- Derived view-side; not stored. Use the computed column below.
  estimated_value_wasted_cents int generated always as (
    case
      when servings_made is null or servings_made = 0 or estimated_total_cost_cents is null then null
      when servings_eaten is null then null
      else round(
        (greatest(servings_made - servings_eaten, 0)::numeric / servings_made::numeric)
        * estimated_total_cost_cents
      )::int
    end
  ) stored,
  member_id uuid references family_members(id) on delete set null,
  source text not null default 'manual',                -- 'manual'|'voice'|'brain_dump'|'weekly_recap'
  notes text,
  created_at timestamptz not null default now()
);

create index meal_events_family_idx on meal_events(family_id, occurred_at desc);
create index meal_events_recipe_idx on meal_events(recipe_id, occurred_at desc);

alter table meal_events enable row level security;

create policy meal_events_select on meal_events
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));
create policy meal_events_insert on meal_events
  for insert to authenticated
  with check (family_id in (select public.current_user_family_ids()));
create policy meal_events_update on meal_events
  for update to authenticated
  using (family_id in (select public.current_user_family_ids()))
  with check (family_id in (select public.current_user_family_ids()));
create policy meal_events_delete on meal_events
  for delete to authenticated
  using (family_id in (select public.current_user_family_ids()));

alter publication supabase_realtime add table meal_events;

-- ============================================================
-- Link waste events to meal events (was nullable from the start; now wire FK)
-- ============================================================

alter table waste_events
  add column if not exists meal_event_id uuid references meal_events(id) on delete set null;

create index if not exists waste_events_meal_idx on waste_events(meal_event_id);
