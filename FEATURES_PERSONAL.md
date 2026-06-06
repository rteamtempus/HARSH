# HARSH — Personal / Work Mode

> Companion to [FEATURES.md](FEATURES.md). Adds a per-user "work" surface alongside the family/household surface, so HARSH supports both the household-coordination use case it was built for AND personal task management for the signed-in user.
>
> **Status:** spec only — not started.

---

## 1. Vision

Owner is an executive-dysfunction-prone person who relied on a project manager who recently left. Note-taking is poor (`new notepad files everywhere`). Wants HARSH to be the single brain it offloads to — but household and work data are different audiences with different access rules, so they need separate surfaces.

**Core idea:** every adult in the family can flip into a private "work" view that uses the same capture-and-organize machinery (brain dump, meeting scribe) but with separate data, separate AI prompts, and zero leakage into the family surface or the display.

---

## 2. Design Principles

Inherits everything from FEATURES.md §1 (AI as orchestrator, surface don't nag, low friction, token-efficient). Plus:

1. **Strict separation.** Work data is **per-user**, never `family_id`-scoped. RLS gates strictly to `user_id = auth.uid()`.
2. **No display surface.** The Pi TV is a family appliance. Work tasks never appear there.
3. **Family briefing stays clean.** Optional setting to surface "you have a 9am meeting" in the family briefing for logistics (don't be late for pickup), but never tasks or content.
4. **Same capture muscles.** Brain dump, meeting scribe, voice — same UX, separate executor → separate tables.

---

## 3. Mode Separation Strategy

**Recommendation: separate routes, not a mode toggle.**

A mode toggle on the home page creates "did I dump my dentist appointment into work by accident?" anxiety. Separate URLs are unambiguous.

Proposed structure:
- `/` → family/household brain dump (today's behaviour)
- `/work` → personal/work surface, scoped to the signed-in user
- Hamburger has a "Switch to work" / "Switch to family" entry
- Optional per-user setting: `work_mode_enabled` (off by default) — hides `/work` from people who don't want it

**Visual differentiation.** Work surface uses a distinct accent color or background tint so you can tell at a glance which mode you're in. Same components, themed.

---

## 4. Work Brain Dump

Same textarea + mic UX, but the LLM prompt + executor differ:

- **Capture:** extracts tasks, projects, deadlines, meetings, notes-to-self
- **Query:** "what do I owe Bob this week?" / "what's blocking the Acme project?"
- **Routes to per-user tables**, not family tables

### Data model

```
projects (per user)
  id, user_id, name, status (active/paused/done), color, created_at, archived_at

work_items (tasks/notes per user)
  id, user_id, project_id (nullable — standalone tasks ok),
  text, notes, kind (task | note | reference),
  due_date, completed_at, priority (low/med/high),
  source (manual | brain_dump | meeting),
  external_id (e.g. Linear/Jira id), created_at

work_meetings (mirrors meeting_notes but per-user)
  id, user_id, recorded_at, transcript, proposals, ai_summary, status, ...
```

**Why a `projects` primitive?** Long-running work has structure. "Write the API doc" lives under "Acme launch." Grouping is what the owner's PM used to provide.

### LLM prompt differences

- Sense of project containers ("this sounds like part of the Acme work")
- Status awareness ("this looks done, mark complete?")
- Doesn't extract emotional/family content as work items
- Recognizes meeting fragments and routes them to a work_meeting if user is "capturing a meeting"

### Open questions

- **Do you want project auto-creation?** ("you mention 'the Acme launch' often — make it a project?") Or only user-created?
- **External integrations?** Linear/Jira/Asana sync, or HARSH is a self-contained alternative?
- **Calendar integration:** do work meetings come from your Google Calendar and surface in work mode? (We have the OAuth, just need to filter by source.)
- **Notes vs tasks:** keep them in one table with a `kind` field, or separate primitives?

---

## 5. Work Meeting Capture

Same flow as Phase 4 (record → transcribe → extract → review → commit), but:

- Stored in `work_meetings` not `meeting_notes`
- Extraction prompt focuses on: action items assigned to you, action items assigned to others, decisions made, open questions, follow-ups
- Speaker diarization labels can map to "me" vs "others" via a one-time setup
- Committed items become `work_items`

### Open questions

- **Multiple speakers, who's who?** Owner can label "Speaker A = me" in the review screen once, the rest are just "Speaker B/C/..." since you don't know them by name
- **Meeting types:** standups (very brief) vs 1:1s vs project syncs — does the prompt need to know which kind, or one prompt fits all?
- **Same 19MB Gemini inline cap** applies as for family meetings. A 60-min meeting could exceed that. Long-form STT is a Phase 5 concern.

---

## 6. Per-User Daily Briefing

A "your day at work" briefing that's distinct from the family briefing:

- Generated daily at start of workday (configurable, e.g. 7:30am)
- Surfaces: today's calendar events (from your Google), tasks due today, overdue items, top-of-mind project status
- Tone: same calm partner voice, but more focused/professional
- Only visible to that user

### Open questions

- **One per user, or shared "morning briefing" page that flips between modes?**
- **Timing:** show on first visit of day, or push a notification?

---

## 7. Cross-Cutting Decisions

- **Auth:** existing password sign-in is fine. Each user has their own surface.
- **Family member ↔ user mapping:** `family_members.user_id` already exists. Use it.
- **Database:** new tables get `user_id` not `family_id`. RLS policy: `user_id = auth.uid()`.
- **Backups:** same Supabase project.
- **Voice on display:** N/A — display is family-only.

---

## 8. Open Questions for the Owner

Marked with **Q:** for easy scanning.

1. **Q: How separated do you want it?** Hard line (work data invisible in family mode) or soft (your calendar events show in both)? I'd default to hard separation with optional opt-in for calendar surfacing.
2. **Q: Both adults will use work mode?** Or just you for now?
3. **Q: Project structure** — do you want a Kanban-style view (todo / in progress / done), or a flat list with status field?
4. **Q: Linear/Asana/Jira sync?** Or self-contained?
5. **Q: Daily/weekly digest** — do you want a Friday end-of-week recap email? (We can reuse the briefing infrastructure.)
6. **Q: Confidentiality** — should work transcripts/notes be encrypted at rest (pgsodium)? Current tables are RLS-gated but unencrypted in DB.
7. **Q: Meeting recording on what device?** Your phone like the family meeting flow? A desktop browser session? (Browser mic + MediaRecorder works on desktop too.)

---

## 9. Implementation Phasing

Roughly:

**Phase W1 — Foundation**
- `/work` route, hamburger toggle, `work_mode_enabled` setting
- `projects` + `work_items` tables + service
- Work brain dump (reuse home component, separate executor)
- Simple project list + task list UI

**Phase W2 — Meeting Scribe**
- `work_meetings` table + service
- New extraction prompt
- Reuse meeting recording + review UX

**Phase W3 — Briefings**
- Per-user briefing (separate from family briefing)
- Optional Google Calendar integration for surfacing meetings

**Phase W4 — Polish**
- Project auto-suggestion
- Status / priority management
- Optional external sync
