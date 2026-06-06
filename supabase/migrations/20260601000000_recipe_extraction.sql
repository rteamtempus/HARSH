-- Recipe text extraction (Gemini Vision) + structured ingredients.
-- Photo stays the source of truth; extracted fields are the queryable layer
-- so the display can later answer "what's in the chicken curry?".

set search_path = public;

alter table recipes
  add column if not exists instructions text,
  add column if not exists total_time_minutes int,
  add column if not exists prep_time_minutes int,
  add column if not exists cook_time_minutes int,
  add column if not exists extracted_at timestamptz,
  add column if not exists extraction_model text;

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,                                  -- "low sodium soy sauce"
  -- Either structured quantity + unit, OR free-text amount when the recipe says
  -- something like "to taste" or "a splash". UI picks whichever is filled.
  quantity numeric,
  unit text,                                           -- 'cup', 'tbsp', 'oz', 'g', 'each', etc.
  free_text_amount text,                               -- "to taste", "a pinch"
  notes text,                                          -- "minced", "room temperature"
  estimated_cost_cents int,                            -- per-ingredient (editable per D1)
  matched_inventory_item_id uuid references inventory_items(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index recipe_ingredients_recipe_idx
  on recipe_ingredients(recipe_id, sort_order);
create index recipe_ingredients_family_idx
  on recipe_ingredients(family_id);

alter table recipe_ingredients enable row level security;

create policy recipe_ing_select on recipe_ingredients
  for select to authenticated
  using (family_id in (select public.current_user_family_ids()));
create policy recipe_ing_insert on recipe_ingredients
  for insert to authenticated
  with check (family_id in (select public.current_user_family_ids()));
create policy recipe_ing_update on recipe_ingredients
  for update to authenticated
  using (family_id in (select public.current_user_family_ids()))
  with check (family_id in (select public.current_user_family_ids()));
create policy recipe_ing_delete on recipe_ingredients
  for delete to authenticated
  using (family_id in (select public.current_user_family_ids()));

alter publication supabase_realtime add table recipe_ingredients;
