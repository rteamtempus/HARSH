-- Release 0.11.0: brain dump v2 — photo capture, more item types, shared
-- question-answering primitive between portal and display.
--
-- Idempotent via ON CONFLICT (version) DO NOTHING.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.11.0', '2026-06-07T22:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'Photo brain dump on the home page. Snap a handwritten to-do list, a dentist appointment card, a school flier, a prescription label — Gemini Vision reads it and proposes the same review cards as a text dump. Add a caption first to hint the assistant ("from the vet" / "from school").',
      'Brain dump recognises inventory restocks ("I picked up milk", "we just got bread") and meals cooked ("made lasagna for dinner"). The latter logs a meal_event tied to the matched recipe with cost snapshot, just like the recipe page button.',
      'Brain dump query mode is now grounded in much more of the household: events (next 3 weeks), facts, active context notes, routines with next-due, recipes by title, and inventory (in / out of stock). "Is the soy sauce out?" / "what''s due tomorrow?" / "do we have a lasagna recipe?" all answer correctly.',
      'Display voice falls back to the same Q&A primitive when ai-intent can''t classify a command. Ask the display "is cheese on the grocery list?" or "when''s Ayla''s next dentist appointment?" and it answers from the same grounding the portal uses.'
    ),
    'improvements', jsonb_build_array(
      'Home page now hydrates events / facts / context / routines / inventory / recipes on open so brain dump queries don''t need a round-trip to gather context.',
      'Weekly meeting scribe inherits the new types automatically — inventory restocks and meals cooked become reviewable proposals alongside to-dos and events.'
    ),
    'fixes', jsonb_build_array()
  ))
on conflict (version) do nothing;
