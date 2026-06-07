-- Release 0.10.0: dedicated /meals page, weekly meal+waste recap in
-- briefings, and a grocery → inventory autoroute when items get checked
-- off the grocery list. Turns the meal/waste data the family has been
-- collecting into a recurring behavioral signal instead of a one-off audit.
--
-- Idempotent via ON CONFLICT (version) DO NOTHING.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.10.0', '2026-06-07T18:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'New /meals page. Every cook event grouped by week with cost / cost-per-serving / waste status. Manual add form for backfilling a meal you cooked without going through the recipe page. Quick "close out" action prompts for servings eaten when a meal is still open.',
      'Weekly + monthly briefings include a Meals recap line. Number cooked, total cost, total wasted — rolled up server-side from meal_events + waste_events so the numbers are exact. Daily briefings unchanged.',
      'Grocery → inventory autoroute. Tick something off the grocery list and HARSH runs it through the D2 resolution ladder; if it matches a tracked inventory item that was marked out, it flips back in stock automatically. No-op when nothing matches.'
    ),
    'improvements', jsonb_build_array(
      'Lists page now loads inventory state on open so the autoroute resolves without waiting on a round-trip.',
      'Briefing TTS audio includes the meal recap line for weekly / monthly briefings.'
    ),
    'fixes', jsonb_build_array()
  ))
on conflict (version) do nothing;
