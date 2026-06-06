-- Release 0.9.0: voice intents for inventory/waste/meals on the display, plus
-- cook/discard meal tracking in the recipe lightbox. Closes the loop on the
-- meal-cost-vs-waste story and surfaces inventory operations through the
-- existing voice path.
--
-- Idempotent via ON CONFLICT (version) DO NOTHING.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.9.0', '2026-06-06T18:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'Voice intents on the display for inventory. "We''re out of soy sauce" marks the matched item out + adds it to the grocery list. "We just got bread" puts it back in stock. "Do we have eggs?" reads the resolution ladder back. Multi-variant categories pick by indicator words ("low-sodium" / "dark") and fall back to the marked default.',
      'Voice intents for waste. "We threw out the moldy bread" logs a waste event with a guessed reason and a cost estimate when the item is tracked.',
      'Voice intents for meals. "I made lasagna" logs a meal event tied to the matched recipe (cost snapshot included). "We threw out the lasagna leftovers" closes the loop on the most recent cook within 7 days.',
      'Cook / discard buttons on every recipe in the portal. "I made this" logs a meal event with the recipe''s servings + cost snapshot. "Threw out leftovers" asks how many servings were eaten and derives waste against the most recent open meal_event.',
      'Recipe lightbox now shows the last 60 days of meals from that recipe with servings eaten / made and waste status.'
    ),
    'improvements', jsonb_build_array(
      'ai-intent edge function now classifies six new actions (inventory.out_of / inventory.have / inventory.query / waste.log / meal.cooked / meal.discarded).',
      'Display board now boots with InventoryService / WasteService / MealService / RecipeService loaded so voice intents resolve without round-trips.'
    ),
    'fixes', jsonb_build_array()
  ))
on conflict (version) do nothing;
