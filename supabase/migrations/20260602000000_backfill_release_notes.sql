-- Backfill release notes for everything shipped before today. The releases
-- table was set up in Phase 0 but never populated — owner asked for it to be
-- caught up so the in-app "What's new" page reflects reality.
--
-- Idempotent via ON CONFLICT (version) DO NOTHING so re-running this
-- migration on any later environment is safe.

set search_path = public;

insert into releases (version, released_at, notes) values
  ('0.1.0', '2026-05-23T12:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'Auth + family setup. Email + password sign-in; magic-link fallback.',
      'Lists: create / archive / categorize. Item-level notes, deadlines, lead time, priority.',
      'Calendar with ICS feed support. Day, week, and month views on the display.',
      'Brain dump home page — type or speak free-form, AI classifies into capture / query / follow-up and routes items to the right primitives.',
      'Routines primitive with interval and calendar cadences. Done / Skip / Snooze / Pause / Resume actions with atomic history logging.',
      'Household facts — durable retrievable facts about the household.',
      'Context notes — time-bounded situational context (max 30 days, auto-deleted).',
      'People & pets profiles for non-login family members.',
      'Family member management + invite by email.',
      'Theme system with light / dark / Double Jaded variants.'
    ),
    'improvements', jsonb_build_array(),
    'fixes', jsonb_build_array()
  )),

  ('0.2.0', '2026-05-24T15:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'Daily / weekly / monthly briefings. Calm partner-voice summaries auto-generated on a schedule.',
      'Briefing TTS audio via Google Chirp 3 HD voices, cached in private storage.',
      'Voice picker in Settings with live audition.',
      'Weekly planning meeting scribe — record audio on your phone, AI transcribes + extracts structured proposals (to-dos, events, routines, facts, context notes, open questions). Review on one screen before commit.',
      'Display app: briefing as the default view, alongside calendar.'
    ),
    'improvements', jsonb_build_array(
      'Briefings honor quiet hours + context notes (tone hints + suppression topics).'
    ),
    'fixes', jsonb_build_array()
  )),

  ('0.3.0', '2026-05-25T20:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'Deadline-aware tasks with effective_nag escalation (passive → surface → assertive as the deadline approaches).',
      'Quiet hours (household-level, default 9 pm – 7 am). Suppresses non-assertive items during the window.',
      'Two-way Google Calendar sync via OAuth. Connect your Google account from Settings; events you create in HARSH push to your primary calendar automatically.',
      'Hourly auto-sync of every connected calendar (ICS + Google) via pg_cron.',
      'Display voice: "sync my calendars" refreshes all connected calendars.',
      '"Sync all calendars" button in Settings.'
    ),
    'improvements', jsonb_build_array(),
    'fixes', jsonb_build_array()
  )),

  ('0.4.0', '2026-05-25T22:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'Screen Wake Lock: phone stays awake during voice capture so it does not sleep mid-sentence.',
      'In-app service-worker update banner. New deploys surface a small "Reload" pill instead of needing DevTools cache clears.',
      'Brain-dump fix: switched the wire schema to a required `label` field so the LLM no longer drops list-item text / routine names under structured output (the "undefined" item bug).'
    ),
    'improvements', jsonb_build_array(
      'Sign-up flow generates a strong password and offers one-tap copy.',
      'Change-password section in Settings.'
    ),
    'fixes', jsonb_build_array(
      'Mobile brain-dump hard error when Gemini returned partial JSON.',
      'Magic-link callback redirects home as soon as the session lands.'
    )
  )),

  ('0.5.0', '2026-05-27T18:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'Routines appear on the calendar (day / week / month views in the display, plus the portal calendar).',
      'New routines now compute an initial next_due so they show up in briefings immediately instead of waiting for first completion.',
      'Recurrence expander handles weekly + monthly RRULEs for calendar rendering; interval routines surface a single floating chip.'
    ),
    'improvements', jsonb_build_array(),
    'fixes', jsonb_build_array()
  )),

  ('0.6.0', '2026-05-28T18:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'Recipes page. Snap a photo (handwritten, printed, anything), give it a title, save.',
      'AI recipe extraction via Gemini Vision. Reads ingredients, instructions, prep / cook / total time, and provides rough per-ingredient cost estimates.',
      'Recipes integrated with the family briefing context.'
    ),
    'improvements', jsonb_build_array(),
    'fixes', jsonb_build_array()
  )),

  ('0.7.0', '2026-05-28T20:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'Inventory: items live inside categories. Boolean in/out tracking by default with opt-in quantity counts for things like toilet paper.',
      '12 pre-seeded categories (Pantry, Fridge, Freezer, Spices, Bread & baked, Drinks, Alcohol, Cleaning, Bathroom, Pet, Tobacco/nicotine, Misc). Editable per family.',
      'Waste tracking as a first-class primitive. Six reasons (spoiled, disliked, leftover not eaten, accident, not worth dealing with, other).',
      'Fridge-cleanout brain dump on the Waste page — paste a stream of items with partial-waste percentages, AI matches against inventory for cost.',
      'Meal events: log a meal cooked + a separate discard later. Servings_wasted and value_wasted derive automatically.',
      'List items gain category and notes fields. Categories on grocery items can route into inventory.',
      'Brain dump recognizes incidental waste mentions ("we threw out the moldy bread") and routes them to waste, not list items.'
    ),
    'improvements', jsonb_build_array(),
    'fixes', jsonb_build_array()
  )),

  ('0.8.0', '2026-06-01T16:00:00Z', jsonb_build_object(
    'new_features', jsonb_build_array(
      'Auto-analyze on recipe upload. Tick the box, pick a photo, save — Gemini fills the title and structured fields automatically.',
      'Full edit mode in the recipe lightbox. Title, total cost, instructions, notes, and every ingredient row are editable (name, quantity, unit, notes, cost). Add or remove ingredient rows freely.',
      'Re-extract button to re-run vision OCR on an existing recipe.',
      'Shared portal header. Brand + email + hamburger menu on every authenticated page; per-page back buttons retired.'
    ),
    'improvements', jsonb_build_array(
      'Recipe lightbox shows the cost row even before extraction, with editable estimate.',
      'Recipe photos preview before save; mobile camera opens via capture=environment.'
    ),
    'fixes', jsonb_build_array(
      'Recipes page no longer breaks when opened (was an infinite-loop in the thumbnail effect).'
    )
  ))
on conflict (version) do nothing;
