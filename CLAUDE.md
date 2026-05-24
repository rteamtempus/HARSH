# CLAUDE.md — Implementer's Technical Reference

Living technical doc maintained alongside the code. Source of truth for *what is built today*. See [FEATURES.md](FEATURES.md) for the spec and [PROGRESS.md](PROGRESS.md) for the implementation checklist.

> **Discipline:** Update this file in the same commit as the change it documents. Never "I'll update the docs next."

---

## What this codebase is

A two-app household assistant for an ADHD/dyslexic family:
- **Portal** — Angular PWA (phones + desktop) for capture, config, brain-dump entry, admin.
- **Display** — Angular kiosk app running on a Raspberry Pi-attached TV; ambient briefing surface.

Both apps share one Supabase backend (Postgres + Auth + Edge Functions + Realtime). Multi-tenant from day one via `family_id` + RLS on every domain table.

---

## Architecture overview

```
projects/
├── portal/               Angular PWA
├── display/              Angular kiosk app
├── data-access/          Supabase client, typed DB models, services
└── ui/                   Shared components, theme primitives (DO NOT REFACTOR THEME)
supabase/
├── migrations/           SQL schema (timestamped)
└── functions/            Edge Functions
    ├── ai-intent/        Gemini intent parser (current)
    └── sync-ics/         External ICS calendar pull
```

### Adapter layers (planned, see Phase 0)

All AI-provider calls funnel through thin adapters so vendor choice stays reversible:

- `LlmAdapter` — chat/structured-output (Gemini today)
- `TtsAdapter` — speech synthesis (Google Chirp 3 HD today)
- `SttAdapter` — short utterance STT (Gemini/Google STT today, browser Web Speech fallback)
- `TranscriptionAdapter` — long-form audio (cloud now, local Whisper later)
- `WeatherAdapter` — Phase 3, provider TBD

---

## Data model — current shape

> Source: [supabase/migrations](supabase/migrations/)

### Core (init schema, 20260522000000)

- `families` — id, name, settings (jsonb), created_at
- `family_members` — family_id, user_id (nullable for invited), role (`owner|adult|kid`), display_name, color, invited_email
- `lists` — family_id, name, kind (`grocery|todo|custom`), sort_order
- `list_items` — list_id, family_id, text, checked, added_by_member_id, sort_order, added_at, checked_at
- `events` — family_id, title, starts_at, ends_at, all_day, location, notes, owner_member_id, source (`manual|gcal|voice`), external_id
- `notes` — family_id, body, pinned, created_by_member_id
- `display_config` — family_id, name, layout (jsonb), active_view, device_pairing_code
- `ai_log` — family_id, member_id, surface, transcript, parsed_intent, result, error, latency_ms

### Subsequent migrations
- `20260522010000` — `create_family_rpc()` (atomic family+owner creation)
- `20260522020000` / `020100` — default-lists seed trigger + one-time backfill
- `20260522030000` — `claim_invitations()` RPC + `calendar_accounts` + `events.source_account_id`
- `20260522040000` — `families.timezone` column

### Planned (Phase 1)
- `profiles` — non-auth household entities (kids, pets); attaches to `family_members.profile_id` later
- `routines` — name, cadence (rrule | interval), next_due, owner (User|Profile|null), nag_level, fair_rotation, pause_until, pause_reason, history
- `household_facts` — key, value, category, source, last_updated
- `weekly_context_notes` — content, type, expires_at (max 30d, enforced), influences[], suppress_topics[]
- `releases` + `user_release_acks` — release-notes pop-up flow
- `list_items` extension — notes, how, when, why, deadline, lead_time_required, estimated_effort, energy_level, assignee_member_id, assignee_profile_id
- `family_settings` (jsonb on families, or extracted table) — voice_id, tts_provider, briefing_schedule

### RLS pattern
Every domain table follows the same family-scoped policy macro (see init migration lines 222-245). Use `public.current_user_family_ids()` as the gate. New tables must replicate this pattern.

---

## External integrations

| What | How | API key | Adapter location |
|---|---|---|---|
| Supabase | `@supabase/supabase-js` via `SUPABASE` injection token | env at build/runtime | `projects/data-access/src/lib/supabase.client.ts` |
| Gemini (intent) | Supabase Edge Function `ai-intent` | `GEMINI_API_KEY` (function env) | `supabase/functions/ai-intent/` |
| External calendars | Edge Function `sync-ics` | none (ICS URL) | `supabase/functions/sync-ics/` |
| Google TTS | **planned** — Chirp 3 HD | `GOOGLE_TTS_API_KEY` | `projects/data-access/src/lib/tts/` (planned) |
| Google STT / Gemini audio | **planned** | shared with TTS | `projects/data-access/src/lib/stt/` (planned) |
| Weather | **deferred to Phase 3** | TBD | TBD |
| Wake word (Pi only) | **planned** — Porcupine or openWakeWord | n/a (local) | `projects/display/` (planned) |

---

## Feature implementation status

See [PROGRESS.md](PROGRESS.md) for the authoritative checklist mapped to FEATURES.md sections.

High-level snapshot (2026-05-24):
- **Phase 0** — in progress (CLAUDE.md + PROGRESS.md created; adapter scaffolding, release-notes flow, How-to-Use page pending)
- **Phase 1** — not started
- **Phases 2-5** — not started

---

## Known limitations and TODOs

- **AI intent vocabulary is narrow** — `ai-intent` only handles list ops + calendar view changes. Brain-dump capture (multi-intent extraction with confirmation) is not implemented.
- **No briefings yet** — display app shows raw calendar/lists; the briefing surface described in FEATURES.md §4.5 is unbuilt.
- **No routines/profiles/facts schema yet** — Phase 1 migration not landed.
- **No release-notes infrastructure** — pop-up, page, and tables all pending.
- **TTS is browser-native today** — sounds robotic; replacement with Google Chirp 3 HD is queued (FEATURES.md §5.4).
- **No tests** — initial scaffold did not include test coverage. Add as features land.

---

## Recent significant changes

| Date | Summary | Ref |
|---|---|---|
| 2026-05-24 | Add CLAUDE.md + PROGRESS.md handoff scaffolding | (this commit) |
| earlier | Initial Angular workspace + Supabase schema + ai-intent function | `143841e` |

(Keep this table rolling — newest first, max ~20 entries.)

---

## Conventions

### File layout for components
Every Angular component is split into three sibling files:

```
<feature>/
  <feature>.component.ts     // class + decorator (templateUrl + styleUrl)
  <feature>.component.html   // template
  <feature>.component.scss   // styles
  <feature>.component.spec.ts (optional)
```

- Class name follows `<Feature>Component` (e.g. `HomeComponent`, `BoardComponent`).
- Decorator uses `templateUrl: './x.component.html'` and `styleUrl: './x.component.scss'`. **Never** inline `template:` or `styles:` arrays in new code — keep templates and styles in their own files for diff readability and IDE tooling.
- App shells (`app.component.ts`) follow the same pattern as regular pages — no special casing.
- Lazy-loaded route imports use the `.component` suffix: `import('./home/home.component').then(m => m.HomeComponent)`.

### Service layer
- One service per primitive (`ListService`, `RoutineService`, etc.) in `projects/data-access/src/lib/`.
- Services own realtime channels and a `signal()` cache, plus CRUD + domain methods. Mirror the pattern in `list.service.ts`.
- All Postgres writes that need atomicity (e.g. routine action + history) go through SECURITY DEFINER RPCs — see `routine.service.ts` for examples.

### Adapter layer
- Vendor-neutral interfaces in `projects/data-access/src/lib/adapters/`. Feature code consumes the interface (via `inject<LlmAdapter>(LLM_ADAPTER)`), not the concrete impl. Wire the concrete impl once in `app.config.ts`.

## Gotchas

- **Theme system is off-limits for refactoring.** Owner is attached to it. Extend through existing primitives; do not replace.
- **Multi-tenant from day one** — every new domain table must carry `family_id` and replicate the RLS macro. Skipping RLS is a security regression.
- **FEATURES.md §0 lists "stop and ask" triggers.** Read them before doing anything that adds external services, removes features, or shifts user-visible tone.
- **Memory says Cloudflare Pages, FEATURES.md says Vercel.** FEATURES.md wins — it post-dates the memory.
- **`ai_log` is non-negotiable** for any new AI call. Voice misfires are debugged from transcript + parsed intent.
- **Briefings must be pre-computed + cached.** Generating on render burns tokens for content nobody might look at.
- **Weekly Context Notes are ephemeral by design** — `expires_at` cap of 30 days is enforced server-side, and notes are *deleted* on expiry, not archived. Do not add an archive table.
