# Implementation Progress — Handoff Checklist

> Living checklist of what's been implemented against [FEATURES.md](FEATURES.md). When context fills up and a new chat takes over, this file is the fastest way to see what's done, what's in flight, and what's still TODO. **Update this file as part of every change.**

Status legend: `[x]` done · `[~]` partial (see notes) · `[ ]` not started · `[!]` blocked (requires owner input)

Last updated: 2026-05-24

---

## Pre-existing baseline (before FEATURES.md handoff)

These shipped in the initial scaffold (commit `143841e`):

- [x] Angular workspace with two app targets: `portal` (PWA), `display` (Pi kiosk)
- [x] Shared libs: `data-access`, `ui`
- [x] Supabase init schema: families, family_members, lists, list_items, events, notes, display_config, ai_log + RLS
- [x] Migrations 010 (family RPC), 020/020100 (default lists seed + backfill), 030 (invitations + calendar_accounts), 040 (family timezone)
- [x] Supabase Edge Function `ai-intent` (Gemini intent parsing for lists + calendar view changes)
- [x] Supabase Edge Function `sync-ics`
- [x] Portal pages: sign-in, setup, home, calendar, settings
- [x] Display pages: sign-in, board
- [x] Auth guard on both apps
- [x] Theme system (do NOT refactor — owner is attached, per FEATURES.md §0)

---

## Phase 0 — Setup

- [!] Hosting setup (Vercel + Supabase production project) — **needs owner**: accounts, env vars, DNS. Note: FEATURES.md §8 picked Vercel; earlier memory said Cloudflare Pages — go with FEATURES.md.
- [~] AI adapter layer scaffolding — **LLM concrete impl done; TTS/STT pending API key**
  - [x] `LlmAdapter` interface ([projects/data-access/src/lib/adapters/llm.adapter.ts](projects/data-access/src/lib/adapters/llm.adapter.ts))
  - [x] `TtsAdapter` interface ([projects/data-access/src/lib/adapters/tts.adapter.ts](projects/data-access/src/lib/adapters/tts.adapter.ts))
  - [x] `SttAdapter` interface ([projects/data-access/src/lib/adapters/stt.adapter.ts](projects/data-access/src/lib/adapters/stt.adapter.ts))
  - [x] `TranscriptionAdapter` interface ([projects/data-access/src/lib/adapters/transcription.adapter.ts](projects/data-access/src/lib/adapters/transcription.adapter.ts))
  - [x] Concrete Gemini LLM adapter ([gemini-llm.adapter.ts](projects/data-access/src/lib/adapters/gemini-llm.adapter.ts)) + new `llm` Edge Function ([supabase/functions/llm/index.ts](supabase/functions/llm/index.ts)) — **needs `supabase functions deploy llm` from owner**
  - [ ] Concrete Google Chirp 3 HD TTS adapter (needs Edge Function proxy + `GOOGLE_CLOUD_API_KEY`)
  - [ ] Concrete browser/cloud STT adapters
- [x] CLAUDE.md initial scaffolding
- [~] "How to Use" page scaffolding — **page exists, hamburger menu entry pending**
  - [x] Route `/help` + [HelpComponent](projects/portal/src/app/help/help.ts)
  - [ ] Link from hamburger menu (no global hamburger yet — add when home page redesign lands)
- [x] Release notes data model and pop-up flow
  - [x] DB: `releases`, `user_release_acks` tables + RLS ([20260524010000_releases.sql](supabase/migrations/20260524010000_releases.sql))
  - [x] Portal `ReleaseService` ([projects/data-access/src/lib/release.service.ts](projects/data-access/src/lib/release.service.ts))
  - [x] First-open-of-day pop-up component ([projects/portal/src/app/release-notes/release-popup.ts](projects/portal/src/app/release-notes/release-popup.ts)) — mounted in [app.html](projects/portal/src/app/app.html)
  - [x] Persistent release-notes page ([projects/portal/src/app/release-notes/release-notes.ts](projects/portal/src/app/release-notes/release-notes.ts)) at `/release-notes`

## Phase 1 — Foundation rework

- [~] List item metadata — **columns added, UI pending** ([20260524000000_phase1_primitives.sql](supabase/migrations/20260524000000_phase1_primitives.sql))
- [~] Routines primitive — **service layer done, UI pending**
  - [x] Schema (`routines`, `routine_history`)
  - [x] Pause-with-duration (`pause_until`, `pause_reason`)
  - [x] Complete / Skip / Snooze / Pause / Resume actions ([RoutineService](projects/data-access/src/lib/routine.service.ts) + atomic Postgres RPCs in [20260524020000](supabase/migrations/20260524020000_routine_actions_and_events_assignee.sql))
  - [x] `next_due` advancement for **interval** cadence (calendar cadence rrule expansion deferred — caller can pass `nextDue` explicitly)
  - [x] Fair rotation column wired through (briefing-side surfacing pending in Phase 2)
  - [ ] Pattern detection: list-item-to-routine suggestion at 4+ occurrences (Phase 1 stretch)
  - [x] Portal CRUD UI ([routines.component.ts](projects/portal/src/app/routines/routines.component.ts)) at `/routines`
- [~] Household memory / facts — **service done, portal CRUD pending**
  - [x] Schema (`household_facts`)
  - [x] [HouseholdFactsService](projects/data-access/src/lib/household-facts.service.ts) with upsert-by-key + ILIKE search for RAG retrieval
  - [ ] Portal CRUD UI
- [~] Profile model + polymorphic `assignee` on items/events/routines
  - [x] `profiles` table + `assignee_member_id`/`assignee_profile_id` on `list_items` and `routines`
  - [x] `assignee_profile_id` on `events` ([20260524020000](supabase/migrations/20260524020000_routine_actions_and_events_assignee.sql))
  - [x] [ProfileService](projects/data-access/src/lib/profile.service.ts)
  - [ ] Portal CRUD for profiles
- [~] Weekly Context Notes — **data + service + reaper landed, UI pending; reaper schedule pending**
  - [x] Schema with `expires_at` (max 30 days, enforced via check constraint)
  - [x] [ContextNotesService](projects/data-access/src/lib/context-notes.service.ts) with client-side duration clamping
  - [x] Auto-delete RPC `reap_expired_context_notes()`
  - [ ] **Schedule the reaper via pg_cron** (in DEV_SETUP.md infra checklist)
  - [ ] Portal CRUD screen in hamburger menu
- [x] Mobile UI redesign with **brain dump home page** (replaces current home)
  - [x] Single text input + transcription toggle ([home.ts](projects/portal/src/app/home/home.ts))
  - [x] Multi-turn via `follow_up` mode; context cleared on commit / fresh query
  - [x] Per-item confirmation cards + prominent "Confirm All"
  - [x] LLM mode detection (capture / query / follow_up) — no manual toggle
  - [x] Lists / members / profiles / snapshot fed to LLM as context
  - [x] Executor routes confirmed items to ListService / EventService / RoutineService / HouseholdFactsService / ContextNotesService
  - [x] Hamburger nav to Lists, Calendar, Settings, Help, Release Notes
  - [x] Existing list CRUD moved to [/lists](projects/portal/src/app/lists/lists.ts)
  - [ ] Inline per-item editing (current UX is confirm/skip only — edit means re-dumping)
- [ ] Family-level voice settings (TTS provider integration)
  - [ ] `family_settings.voice_id`, `tts_provider` columns
  - [ ] Audition + switch in hamburger menu

## Phase 2 — Ambient intelligence

- [ ] Briefing data model (`briefings` table with `source_data_hash`)
- [ ] Daily briefing generation (hero line + sections)
- [ ] Weekly briefing (zoom-out, Sunday/Monday)
- [ ] Monthly briefing (light touch)
- [ ] Scheduled regeneration cadence (6am / 12pm / 4:30pm / 7:30pm) via pg_cron
- [ ] Event-triggered regeneration
- [ ] TTS synthesis + audio caching for briefings
- [ ] "What should I do now" endpoint
- [ ] Display app redesign around briefing (briefing primary, calendar strip, list panel)
- [ ] Weekly Context Notes surfacing in briefings (tone-layer only, suppression honored)

## Phase 3 — Deadline awareness

- [ ] Hard-deadline + lead-time tasks computing `act_by`
- [ ] Auto-escalation by deadline math (`passive` → `surface` → `assertive` as `act_by` approaches)
- [ ] Quiet hours enforcement (household-level, default 9pm-7am)
- [ ] Weather API integration (provider TBD — defer per FEATURES.md §8)

## Phase 4 — Meeting scribe

- [ ] Audio capture (mobile, with marker tagging)
- [ ] Background transcription pipeline
- [ ] Multi-domain extraction (lists, events, routines, facts, context notes, open questions)
- [ ] Review + commit flow with speaker-based assignment (diarization)
- [ ] Searchable meeting artifact (`meeting_notes` + summary)

## Phase 5 — Polish

- [ ] Self-hosted LLM evaluation
- [ ] Kid-aware briefing features
- [ ] Touch on display
- [ ] Local Whisper transcription migration

---

## Blocked / Needs owner input

- [!] **Vercel + Supabase production accounts** — required for any deploy
- [!] **Google Cloud project + TTS/STT API keys** — required before TTS or transcription work
- [!] **Gemini API key budget threshold** — FEATURES.md §5.4 mentions a $30/mo reconsider point; not yet set
- [!] **Wake-word library choice** — Porcupine (commercial, free for personal) vs. openWakeWord (open source); FEATURES.md §8 says decide later

---

## Notes for the next session

- FEATURES.md §0 mandates: ask before adding/removing top-level features, before adding new external services, before changing resolved decisions (§7), before any security/privacy implication around audio or context notes, and before user-visible copy that shifts away from "calm warm partner."
- The existing **theming system is sacred** — extend, never refactor.
- Update FEATURES.md inline (mark items, add to §7 Resolved Decisions Log when new decisions arise).
- Update CLAUDE.md in the same commit as the code change — never deferred.
- Conflict between memory (Cloudflare Pages) and FEATURES.md (Vercel): **FEATURES.md is the source of truth.**
