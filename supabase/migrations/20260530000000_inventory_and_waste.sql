-- H2: Inventory + Waste foundation.
-- See FEATURES_HOUSEHOLD_EXPANSION.md §4–§5 and §9 (D1–D11) for design decisions.

set search_path = public;

-- ============================================================
-- Categories
-- ============================================================
-- User-extensible. Pre-seeded with the §9/D3 default set for every family
-- (new families via trigger; existing families via the one-off loop at end).

create table inventory_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  description text,
  color text default '#717744',
  sort_order int not null default 0,
  default_grocery_list_id uuid references lists(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index inventory_categories_family_idx
  on inventory_categories(family_id, sort_order);
-- Case-insensitive uniqueness per family (couldn't use a table constraint
-- with lower() — needs to be an expression index).
create unique index inventory_categories_unique_name
  on inventory_categories(family_id, lower(name));

alter table inventory_categories enable row level security;
create policy inv_cat_select on inventory_categories
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));
create policy inv_cat_insert on inventory_categories
  for insert to authenticated
  with check (family_id in (select public.current_user_family_ids()));
create policy inv_cat_update on inventory_categories
  for update to authenticated
  using (family_id in (select public.current_user_family_ids()))
  with check (family_id in (select public.current_user_family_ids()));
create policy inv_cat_delete on inventory_categories
  for delete to authenticated
  using (family_id in (select public.current_user_family_ids()));

-- ============================================================
-- Items
-- ============================================================
-- D4: boolean `in_stock` is the primary signal; `quantity_count` is opt-in
-- per item (toggleable via `tracks_count`) for things like toilet paper.

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  category_id uuid references inventory_categories(id) on delete set null,
  name text not null,
  brand text,
  size_text text,
  variant_notes text,
  -- Lowercase concat of name+brand+variant for fast voice match. App keeps
  -- this current on write; index it for ilike lookups.
  normalized_name text generated always as (
    lower(coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(variant_notes, ''))
  ) stored,
  in_stock boolean not null default true,
  tracks_count boolean not null default false,    -- D4 opt-in
  quantity_count int,
  unit text default 'count',
  last_purchased_at timestamptz,
  last_purchased_price_cents int,
  typical_price_cents int,                          -- rolling avg from receipts
  is_category_default boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index inventory_items_family_idx on inventory_items(family_id);
create index inventory_items_cat_idx on inventory_items(category_id);
create index inventory_items_name_idx on inventory_items(family_id, normalized_name);
-- One default per (family, category) — partial unique to enforce.
create unique index inventory_items_default_per_cat
  on inventory_items(family_id, category_id)
  where is_category_default and not archived;

alter table inventory_items enable row level security;
create policy inv_items_select on inventory_items
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));
create policy inv_items_insert on inventory_items
  for insert to authenticated
  with check (family_id in (select public.current_user_family_ids()));
create policy inv_items_update on inventory_items
  for update to authenticated
  using (family_id in (select public.current_user_family_ids()))
  with check (family_id in (select public.current_user_family_ids()));
create policy inv_items_delete on inventory_items
  for delete to authenticated
  using (family_id in (select public.current_user_family_ids()));

-- ============================================================
-- Item events (audit log + price history)
-- ============================================================

create type inventory_event_kind as enum (
  'added', 'removed', 'price_changed', 'manual_edit', 'wasted'
);
create type inventory_event_source as enum (
  'voice', 'grocery_check', 'receipt_ocr', 'manual'
);

create table inventory_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  item_id uuid references inventory_items(id) on delete cascade,
  kind inventory_event_kind not null,
  source inventory_event_source not null,
  quantity_delta int,
  price_cents int,
  member_id uuid references family_members(id) on delete set null,
  occurred_at timestamptz not null default now(),
  note text
);

create index inventory_events_family_idx
  on inventory_events(family_id, occurred_at desc);
create index inventory_events_item_idx
  on inventory_events(item_id, occurred_at desc);

alter table inventory_events enable row level security;
create policy inv_events_select on inventory_events
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));
create policy inv_events_insert on inventory_events
  for insert to authenticated
  with check (family_id in (select public.current_user_family_ids()));

-- ============================================================
-- Waste events
-- ============================================================
-- D6 enum: simplified set; `not_worth_it` replaces "lazy" per tone discussion.

create type waste_reason as enum (
  'spoiled', 'disliked', 'leftover_not_eaten', 'accident', 'not_worth_it', 'other'
);

create table waste_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  item_id uuid references inventory_items(id) on delete set null,
  -- meal_event_id will be added in H4 when meal_events lands. Until then,
  -- waste can stand alone (half a melon, no meal).
  free_text_name text,
  reason waste_reason not null default 'other',
  quantity_text text,
  -- 0–100. 100 = whole item lost. 50 = half wasted (e.g. mustard bottle).
  percentage_wasted int not null default 100
    check (percentage_wasted between 0 and 100),
  -- Snapshot at log time so a later price change doesn't rewrite history.
  estimated_value_cents int,
  member_id uuid references family_members(id) on delete set null,
  source text not null default 'manual',           -- 'manual'|'voice'|'brain_dump'|'waste_dump'
  occurred_at timestamptz not null default now(),
  note text
);

create index waste_events_family_idx
  on waste_events(family_id, occurred_at desc);
create index waste_events_item_idx on waste_events(item_id);

alter table waste_events enable row level security;
create policy waste_select on waste_events
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));
create policy waste_insert on waste_events
  for insert to authenticated
  with check (family_id in (select public.current_user_family_ids()));
create policy waste_update on waste_events
  for update to authenticated
  using (family_id in (select public.current_user_family_ids()))
  with check (family_id in (select public.current_user_family_ids()));
create policy waste_delete on waste_events
  for delete to authenticated
  using (family_id in (select public.current_user_family_ids()));

-- ============================================================
-- Realtime
-- ============================================================

alter publication supabase_realtime add table
  inventory_categories, inventory_items, inventory_events, waste_events;

-- ============================================================
-- Default-category seeding (D3)
-- ============================================================
-- Per-family. Trigger seeds for new families; loop at the end backfills
-- existing families so the migration works on the live DB.

create or replace function public.seed_inventory_categories(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cat record;
  defaults text[][] := array[
    -- name, color, sort_order
    ['Pantry',           '#a86f3f', '10'],
    ['Fridge',           '#4f7a9a', '20'],
    ['Freezer',          '#7aa5c9', '30'],
    ['Spices',           '#c98a3f', '40'],
    ['Bread & baked',    '#b48a5a', '50'],
    ['Drinks',           '#5a9aa6', '60'],
    ['Alcohol',          '#7a4a4a', '70'],
    ['Cleaning',         '#7a9a4f', '80'],
    ['Bathroom',         '#9a7ac0', '90'],
    ['Pet',              '#9a8a4f', '100'],
    ['Tobacco/nicotine', '#6b6b6b', '110'],
    ['Misc',             '#717744', '120']
  ];
  i int;
begin
  for i in 1 .. array_length(defaults, 1) loop
    insert into inventory_categories(family_id, name, color, sort_order)
    values (p_family_id, defaults[i][1], defaults[i][2], defaults[i][3]::int)
    on conflict (family_id, lower(name)) do nothing;
  end loop;
end;
$$;

-- Trigger: when a family is created, seed its default categories.
create or replace function public.tg_seed_inventory_categories()
returns trigger
language plpgsql
as $$
begin
  perform public.seed_inventory_categories(new.id);
  return new;
end;
$$;

drop trigger if exists families_seed_inv_categories on families;
create trigger families_seed_inv_categories
  after insert on families
  for each row execute function public.tg_seed_inventory_categories();

-- Backfill existing families.
do $$
declare
  fam record;
begin
  for fam in select id from families loop
    perform public.seed_inventory_categories(fam.id);
  end loop;
end $$;
