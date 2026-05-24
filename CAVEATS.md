# Caveats & Open Questions

> Things Claude noticed while building that the owner should think about when there's time. Not blockers — judgment calls, deferred work, and known UX rough edges. Each item lists when/why it came up.

Date format: YYYY-MM-DD. Items roughly newest first.

---

## Architecture / Convention

### File naming for components — `.component.ts` vs bare names (2026-05-24)
Owner asked for `*.component.{ts,html,scss}`. Existing scaffold uses bare `app.ts` + `app.html` + `app.scss` (no `.component.` infix). Claude is migrating everything to the `.component.` pattern for consistency with the owner's explicit instruction, including the `app` shells. CLAUDE.md documents this as the convention going forward.

### Vercel hosting decision conflicts with prior memory (2026-05-24)
Owner's stored memory said Cloudflare Pages; FEATURES.md (newer, the spec) says Vercel. Going with Vercel. If costs/perf become an issue later, Cloudflare Pages is a 1-day migration (no Vercel-specific APIs in use).

### Two LLM Edge Functions exist side-by-side (2026-05-24)
`ai-intent` is purpose-built for the legacy intent-classify-then-execute flow (still used by the existing voice path). `llm` is the new generic Gemini proxy used by the brain-dump service. Eventually `ai-intent` should be retired and the legacy voice path migrated to brain-dump — but that's a behavior change to the existing voice/wake-word UX, so leaving it for owner to greenlight.

---

## Brain dump (FEATURES.md §2.1.1)

### No inline per-item editing (2026-05-24)
Cards offer Confirm / Skip only. If the LLM parses something wrong (e.g. "Hardware" instead of "Hardware Store"), the user has to skip + retype. A real edit affordance — at minimum, editing the text + list_name fields, ideally a per-type form — should land before this is the main daily flow.

### Calendar-cadence routines depend on LLM emitting valid RRULE (2026-05-24)
"Mow every 7 days" → `cadence_type: interval, interval_days: 7` — bulletproof.
"Trash every Friday" → `cadence_type: calendar, cadence_rrule: 'FREQ=WEEKLY;BYDAY=FR'` — works when Gemini gets it right, fails the insert when it doesn't. A server-side rrule validator + better prompting could harden this. Or convert calendar routines client-side to next intervals.

### Brain-dump confidence is shown only as a quote, not a percentage (2026-05-24)
Spec mentions confidence scores. Current implementation just shows the LLM's quote/reasoning. Adding a confidence number is cheap if the owner wants it surfaced — but quotes feel more human and probably enough. Decide later.

### Multi-turn only handles one follow-up question (2026-05-24)
If the LLM asks again, the second answer goes in fresh (no chained prior). Probably fine for the use case (one ambiguity = one clarification) but if conversations deepen, this is the place to fix.

### LLM context snapshot does NOT yet include household_facts or events (2026-05-24)
Brain-dump's query mode passes lists + recent items + some event titles but not the household_facts table contents or routines. Means "what's our pediatrician's name?" might not get answered until we wire facts into the snapshot. Easy fix in the home component's `submit()` — just inject the services and add to ctx.snapshot. Deferred because the brain-dump-as-query flow isn't widely used yet.

---

## Routines (FEATURES.md §4.3)

### `next_due` calendar-cadence advancement is a no-op in Postgres today (2026-05-24)
`routine_advance_next_due()` only advances interval cadences. For calendar (rrule) routines, the caller must pass `p_next_due` explicitly. Either:
1. Add an rrule library (e.g. plv8 + rrule.js) inside the function, or
2. Compute the next occurrence client-side and pass it through

Option 2 is simpler and avoids new pg extensions; flagged for whenever a routine UI needs to do this.

### Fair rotation column exists; logic doesn't (2026-05-24)
`routines.fair_rotation` is a boolean column wired through the schema. The briefing surfacing ("Rory's done it 4 weeks in a row") isn't implemented because briefings themselves aren't built yet (Phase 2). When briefings land, fair-rotation surfacing is one of the first weekly-briefing features to add.

### Pattern detection (list-item → routine suggestion) is a Phase 1 stretch (2026-05-24)
FEATURES.md §4.3 "Pattern Detection" — "you've added 'mow lawn' 5 weekends in a row, make this a routine?" — not yet built. Could be a nightly Edge Function or a one-shot when the brain-dump sees a repeat.

---

## Release notes (FEATURES.md §9.3)

### Pop-up shape ranks by `released_at` not version string (2026-05-24)
Lexicographic version sort would break ("1.10.0" < "1.9.0"). The popup + history use `released_at` timestamps as the order key. Means if you ever backdate or insert out-of-order releases, the order will look wrong. Don't backdate.

### No release records exist yet (2026-05-24)
Data model is ready, but no `INSERT INTO releases` has happened. First time we cut a real release, Claude (or owner) should write the entry. Convention: add via SQL in a follow-up migration or via the Supabase dashboard.

---

## Schema / migrations

### Migrations run blind on prod (2026-05-24)
Owner explicitly authorized running `db:push` straight to prod. No staging environment. Fine for personal-scale dev — risky for multi-tenant later. When a second family signs up, add a staging Supabase project.

### Postgres types regen has a stderr-pollution quirk (2026-05-24)
`npx supabase gen types typescript --linked` writes its progress lines ("Initialising login role...") to stderr, but on Windows they sometimes land in the captured stdout if not redirected. The `db:types` npm script doesn't suppress stderr; Claude uses `2>nul` explicitly. If you ever run `db:types` and end up with garbage at the top of `database.types.ts`, that's why.

---

## Privacy / safety guardrails

### Weekly Context Notes reaper is not yet scheduled (2026-05-24)
The RPC `reap_expired_context_notes()` exists and works, but nothing calls it. Until it's wired to pg_cron, expired notes stay in the table (they're still filtered out of every query by `expires_at > now()`, so they don't *leak* — but they accumulate). To schedule: SQL `select cron.schedule('reap-context-notes', '0 3 * * *', $$select public.reap_expired_context_notes()$$);` once pg_cron is enabled on the project. Tracked in DEV_SETUP.md.

### Audio capture for meetings is unbuilt (Phase 4 work)
FEATURES.md §4.6 spells out the privacy posture (cloud transcription via swappable adapter, audio deleted after transcription, etc.). Important to revisit the design when actually building this — the spec calls out specific guardrails.

---

## UI / accessibility

### Hamburger menu is not keyboard-accessible (2026-05-24)
Click to open works; ESC to close, focus trap, tab order — none of that yet. The opener is a button but the menu items don't get focus on open. Fix when polishing.

### CSS budget warnings (cosmetic, pre-existing) (2026-05-24)
Several components (home, settings, board) exceed Angular's 4kB per-component style budget. Pre-existing; not introduced by recent work. Either bump the budget in angular.json or split styles. Cosmetic — doesn't affect runtime.

---

## Tests

### No tests anywhere (2026-05-24)
Initial scaffold didn't include test coverage. Worth adding once Phase 1 settles — the routine action RPCs in particular are good integration-test candidates.
