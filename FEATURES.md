# Household Assistant — Feature & Architecture Plan

> Living document. Hand off to Claude Code for implementation planning. Sections marked **[DECISION NEEDED]** require input before implementation.

---

> **Implementation status:** See [PROGRESS.md](PROGRESS.md) for the live checklist mapped to every section below. Per-section status markers inline (e.g. `[Phase 1 — partial]`) added by Claude as features land.

## 0. For the Implementer (Claude Code, read this first)

This document is the source of truth for what gets built. The human owner is intentionally minimizing input during implementation — that means you have more autonomy than usual, but it also means **the cost of misinterpretation is higher** because there's no one watching every step. Read this section carefully before writing any code.

### Operating principles

1. **Never compromise these design principles** (from §1):
   - AI as orchestrator, not gatekeeper
   - Surface, don't nag
   - Low friction wins (every voice action has a tap equivalent)
   - Token-efficient by design

2. **When to stop and ask the human, even if it slows you down:**
   - Any time you'd add or remove a top-level feature not described in this doc
   - Any time you'd change the data model in a way that affects multiple primitives
   - Any time you'd add a new external service, vendor, or API beyond those listed
   - Any time you'd change a decision marked as resolved in §7 ("Resolved Decisions Log")
   - Any time you encounter a security/privacy implication not covered here (esp. around audio, transcripts, household memory, weekly context notes)
   - When user-visible copy in briefings or AI responses would meaningfully shift tone away from "calm warm partner"

3. **When to proceed without asking:**
   - Implementation details (libraries, file structure, testing approach) where the doc doesn't specify
   - Refactors that improve maintainability without changing behavior
   - UI polish within the existing theming system
   - Anything covered explicitly in §8 (existing stack) or §9 (documentation requirements)

4. **What to trust:**
   - This document over your assumptions
   - Resolved decisions (§7) over plausible-sounding alternatives
   - Explicit data model (§6) over inferred shapes
   - User intent expressed in the doc over patterns from other apps you've built

5. **What to be suspicious of:**
   - Anything that adds complexity to a system designed for executive-dysfunction users. If a feature adds friction, the feature is probably wrong, not the principle.
   - Convenience features that quietly become surveillance (especially around emotional/situational data — see Weekly Context Notes guardrails in §4.6.1)
   - Auto-committing AI-extracted data without human review

### Theming
The existing theming system is the one piece of the current codebase the owner is attached to. Do not refactor or replace it. New features must use the existing theming primitives. If a new theme is added, do it through the system that exists.

### Phasing
Follow the phasing in §10 unless you have a concrete reason to deviate, in which case ask. Phase 1 first; do not start Phase 2 work in parallel without explicit approval.

### Update this document as you go
You have write access to this file (it lives at the repo root as `FEATURES.md`). When a feature is implemented, mark it. When you discover a new decision the spec didn't cover, add it to §7 with your reasoning. When something can't be done as specified, document why and what was done instead. The document is alive; treat it that way.

---

## 1. Product Vision

A household assistant for two ADHD adults and a 4-year-old, designed to compensate for executive dysfunction by holding context the humans can't, surfacing the right thing at the right time, and reducing the cognitive cost of staying proactive instead of reactive.

**Design principles:**
- **AI as orchestrator, not gatekeeper.** AI handles synthesis, prioritization, drafting, and ambient awareness. Deterministic UI handles fast/frequent interactions (check off a to-do, add an item).
- **Surface, don't nag.** Default to informing ("trash day tomorrow") over commanding ("take out the trash now"). Nagging tone is configurable per-routine.
- **Out of sight is out of mind — so put it in sight.** The display app is an always-on ambient memory layer.
- **Low friction wins.** Voice is additive, never required. Every voice action has a tap equivalent.
- **Token-efficient by design.** Use cheap models (Gemini 2.5 Flash) for most calls; reserve heavier reasoning for synthesis tasks. Architect for swappable models including self-hosted.

---

## 2. Apps & Platforms

### 2.1 Mobile PWA
- Sign-in, family management, full CRUD on all data
- Primary capture device (voice + typing on the go)
- Manual sync triggers, settings, "source of truth" admin
- **Home page = brain dump surface** (see 2.1.1). Everything else lives in hamburger menu.

#### 2.1.1 Brain Dump Home Page (primary interaction)  *[v1 landed: capture/query/follow_up modes + confirm cards + Confirm All + hamburger nav; inline per-item editing deferred]*
The home page is a single large text input with a transcription toggle button above it. User types or speaks freely; Gemini parses the dump and routes content into the right primitives (lists, events, routines, household facts, deadlines).

**Why:** User has ADHD; structured forms cause blank-mind freeze. Brain dump is the strongest input modality. ~80% of mobile interactions will be capture, not navigation.

**Two modes from the same input box:**
1. **Capture** — "we need milk and eggs, and remind me to call the dentist by Thursday, oh and the lawn guy is coming next Tuesday at 10am" → Gemini extracts and proposes structured items with a confirmation step before committing.
2. **Query** — "is cheese on the grocery list?" / "what's on my calendar tomorrow?" / "when do we need to mow next?" → Gemini answers conversationally from family data.

**Mode detection:** Let the LLM decide. Don't make the user pick a mode. Intent classification is cheap and a single Gemini call can do both detection and execution.

**Confirmation UX for capture:**
- After parsing, show a compact review card per extracted item ("Add 'milk' to Grocery — confirm / edit / skip")
- **Prominent "Confirm All" action** for trusted parses; per-item edit/skip for ambiguous ones
- Every parsed item shown regardless of confidence — user confirms drafts, doesn't audit silent commits
- Speed of the confirm-all path matters most; per-item editing is the fallback when something needs adjustment

**Conversation context:**
- Brain dump supports **multi-turn** within a single capture/query flow — AI can ask follow-up questions if a dump is ambiguous ("Did you mean Tuesday this week or next?")
- Context **cleared** when: (a) the capture is confirmed/committed, (b) a query is answered and user doesn't continue, (c) the app backgrounds or closes
- No long-running session memory in the brain dump box — these are quick one-off interactions, not chat sessions
- Household memory + family data are always available as retrieval context, separate from conversational state

**Lists are user-defined:**
- No fixed list types in the data model — user creates lists with arbitrary names ("Grocery", "Hardware Store", "Books to Read", "Home Projects", "Daughter's Wishlist", etc.)
- Each list has metadata (name, icon, color, optional category hint for AI routing)
- Brain dump LLM gets the current set of lists as context; routes new items to the best match or proposes a new list if nothing fits
- Default lists seeded for new families ("To Do", "Grocery") but fully removable/renamable
- Future-proof: don't lock in list types you might wish you had later

**Hamburger menu contains:**
- List management (full CRUD, organization, archive, reordering)
- Calendar settings + sync
- Family / users / profiles
- Routines management
- Household facts editor
- Themes / preferences
- Voice / transcription settings

### 2.2 Display App (Raspberry Pi, mounted screen)
- Always-on ambient display
- Hamburger menu for setup/preferences only
- Wake-word voice as primary interaction; touch as fallback (future)
- Minimal direct interaction — the screen is a *briefing surface*

---

## 3. Existing Functionality (baseline)

**Mobile PWA:**
- Auth, family creation, multi-user families
- Shared lists (to-do, grocery, etc.) — CRUD via UI or Gemini voice
- Family member add/remove, basic settings
- Light/dark themes, extensible theme system
- Google Calendar integration (manual sync from phone)
- Upcoming events list view
- **Known issue:** UI is clunky, needs redesign pass

**Display App:**
- Hamburger menu: theme, calendar view (day/week/month), voice options, wake-word toggle
- Large calendar (left), list panel with tabs (right)
- Voice can change calendar date range, switch list tabs, add/remove items

---

## 4. Proposed Feature Areas

### 4.1 List Items: Richer Metadata  *[schema landed, UI pending]*
Optional fields per list item, so partners can communicate preferences without micromanaging in real time.

- `notes` — free-text ("the way she likes it done")
- `how` — method/approach notes
- `when` — soft target ("this week", "before dinner") — NOT a hard schedule
- `why` — context/motivation (helps with ADHD reframing)
- `deadline` — hard deadline with lead-time awareness (see 4.2)
- `estimated_effort` — XS / S / M / L (for "what can I do right now" suggestions)
- `energy_level` — low / medium / high (matches your evening brain-fog reality)

**Implementation note:** Keep all fields optional. Default to a one-line item; expand on tap.

### 4.2 Deadline-Aware Tasks (not "scheduled to-dos")
For tasks like "cancel appointment, requires 24hr notice." Different from calendar events because the *deadline* matters, not the *doing time*.

- Task has `hard_deadline` and `lead_time_required`
- System computes `act_by = hard_deadline - lead_time_required`
- Surfacing escalates as `act_by` approaches: gentle → prominent → urgent
- AI considers these in "what should I do now" suggestions
- Briefing surfaces upcoming `act_by` windows

### 4.3 Routines (recurring non-calendar obligations)  *[schema + services + portal UI landed; fair-rotation surfacing waits for briefings]*

A **routine** is a recurring household obligation that surfaces awareness, not action items. Different from a recurring to-do (which expects completion every time) and different from a calendar event (which has a specific time/place).

Defining trait: most routines have a cadence and an owner pattern, but the "doing" can shift around within the window. Trash needs to go out before Friday morning pickup, but whether that happens Thursday night or Friday at 6am doesn't matter — what matters is that one of you remembers.

#### Data Shape

```
Routine {
  id
  name                    // "Trash", "Mow lawn", "Pay bills", "HVAC filter"
  category                // "household", "yard", "bills", "maintenance", "kids", "pets", custom
  cadence                 // see below
  next_due                // computed from cadence + history
  owner                   // User | Profile | null (null = household-shared)
  nag_level               // passive | surface | assertive (default: surface)
  lead_time               // optional; default by cadence (see Surfacing)
  estimated_effort        // XS / S / M / L
  notes                   // free-text ("the bin is the green one, by the side gate")
  history[]               // completion log
  active                  // boolean — pauseable without deleting
  pause                   // optional { until: date, reason: string }
  fair_rotation           // bool, default false — track who completes for owner-null routines
}
```

#### Cadence Formats

Two types, with pause-with-duration providing the seasonal/conditional flexibility instead of a separate type:

**Calendar-based** — "every Friday", "first Monday of the month", "15th and last day of the month"
- Best for: external schedules you don't control (trash pickup, bill due dates)
- Stored as an rrule or equivalent

**Interval-based** — "every 7 days", "every 14 days", "every 90 days"
- Best for: things measured from last completion (mow lawn, oil change, HVAC filter)
- `next_due` slides based on actual completion timestamp

**Seasonal/temporary changes via Pause:** No separate seasonal cadence type. Use pause-with-duration to handle "mow weekly in summer, paused in winter" → pause mowing for 3 months. Same primitive handles: kid school breaks, soccer off-season, summer-only routines, snow shoveling, vacation interruptions. Pause has an `until` date and an optional `reason`; routine resumes automatically.

#### Completion Logging

When a routine is marked done, log:
- timestamp
- who completed it (always capture, even when owner is null)
- optional note ("had to use a different bin, ours is cracked")

History serves two purposes:
1. Answers "when did we last…" queries
2. Feeds AI context — patterns inform suggestions and the fair-rotation feature

#### Skip vs. Complete vs. Snooze vs. Pause

- **Complete**: done, history logged, `next_due` advances per cadence
- **Skip**: this instance won't happen, `next_due` advances per cadence, logged distinctly ("skipped, not done")
- **Snooze**: push `next_due` forward by N days without skipping ("can't mow today, try tomorrow")
- **Pause**: routine suspended until a future date with optional reason; doesn't surface during pause; auto-resumes

Distinction matters for AI context: skipping a mow during vacation is fine; snoozing it three weeks in a row is a signal worth surfacing in a weekly briefing.

#### Surfacing Rules

Routines appear in the briefing when:
- Within `lead_time` window (defaults: 1 day for short-cycle weekly, 3 days for weekly, 1 week for monthly, 2 weeks for quarterly+)
- Overdue
- Skipped/snoozed but next instance is approaching

Routines do **not** accumulate as a list of unchecked items — only the next instance matters at any given time. Previous instances either completed or skipped; they're not still waiting.

**Display surfacing: briefing-only.** No dedicated routines panel on the display. The briefing handles all routine awareness — adding a separate panel pulls focus from the briefing-first design.

**Mobile management:** Full routines CRUD lives in the hamburger menu. Brain dump can create routines ("trash goes out every Friday" → proposed routine card).

#### Interaction with Calendar

Routines do **not** auto-create calendar events. They live in the briefing and the routines system only. Cluttering the calendar with recurring "trash" entries adds noise without value — the calendar stays for actual scheduled events.

User can manually convert a routine instance to a calendar event if they want (e.g., "block 30 min Saturday morning for mowing"), but the routine itself isn't a calendar entity.

#### Fair Rotation (opt-in)

For routines with `owner: null` and `fair_rotation: true`, the system tracks completion-by-user and the briefing can gently surface rotation:

> "Trash this week — Rory's done it the last 4 weeks."

- Off by default per routine
- User must explicitly enable on routines where rotation tracking is wanted
- Tone stays neutral/observational, never accusatory
- Never auto-assigns; just surfaces the data

#### Pattern Detection: Routine Suggestions

If the same to-do item appears in any list 4+ times with a regular cadence, the system proposes converting it to a routine:

> "You've added 'mow lawn' to the to-do list 5 weekends in a row. Make this a routine?"

- High threshold to avoid noise
- One-tap dismiss; doesn't suggest again for that pattern
- Proposes a cadence based on observed intervals

#### Bills (future subtype)

For v1, bill payments are routines with notes capturing amount + payee. Data model leaves room for a future `Bill` subtype with structured `amount`, `payee`, `account` fields if we want richer features later (totals, reminders by due date, paid/unpaid status). Not needed for initial implementation.

### 4.4 "What Should I Do Right Now?" — Contextual Suggestions
The headline AI feature. Considers:
- Time of day, day of week
- Weather (lawn = no rain tomorrow; outdoor stuff today if storm coming)
- Calendar (free 20 min before pickup? quick task)
- Upcoming deadlines and `act_by` windows
- Pending routines
- Energy level (user-selected or time-of-day default — your evening brain-fog pattern)
- Task effort estimates
- External constraints ("lawn service comes tomorrow → dog poop today")

**Interaction model:** User asks ("what's a good thing to do right now?") OR ambient suggestion on display ("you have 25 min before pickup and trash goes out tomorrow"). Not auto-pushed to phone unless user opts in to nudges.

### 4.5 Daily / Weekly / Monthly Briefing

On the display, the briefing is the primary view. Generated by AI from family data, calendar, routines, deadlines, weather, and household memory.

#### Briefing Types

**Daily briefing** — visible on the display most of the time. Structure:
- **Hero line** (1-2 sentences, plain language): the "absorb in a 2-second glance" summary. Example: "Wednesday morning. Daughter has daycare today, and you've got the pediatrician at 3pm. Trash goes out tonight."
- **Today's shape**: today's events highlighted (next one, ones needing prep)
- **Needs your attention**: deadlines approaching `act_by`, routines due today/tomorrow, escalated items
- **Right now**: 1-2 ambient suggestions (see §7.2)
- **Heads up**: not-today-but-close items (lawn service tomorrow, bill due in 3 days)

**Weekly briefing** — "zoom out" view, generated Sunday evening or Monday morning:
- Week's calendar shape (heavy days, light days, conflicts)
- Routines hitting this week
- Deadlines landing this week
- Open items from last week's meeting that didn't get done
- Suggested focus areas based on free time and pending priorities
- **Positive reinforcement included here** (see Tone below)

**Monthly briefing** — lighter touch, generated start of month:
- Bills due this month
- Recurring obligations
- Seasonal items (HVAC filter, smoke detector batteries, etc.)
- Looking-back summary (routines maintained vs. slipped)

#### Tone

**Warm/conversational with restraint.** Like a calm partner casually updating you — not an enthusiastic AI mascot. No exclamation points, no "Have a great day!" filler, no participation-trophy praise. The voice should feel like reading a sticky note from someone who knows the household.

#### Positive Reinforcement

- **Include** in weekly and monthly briefings (where it's earned, infrequent, meaningful)
- **Exclude** from daily briefings — keep daily focused on what's ahead, not what was done
- Examples that work: "You stayed on top of trash for 4 weeks straight." "You closed out 80% of last week's planned items."
- Examples to avoid: anything that reads like praising routine effort ("Great job doing the dishes!")

#### Generation Architecture

**Pre-computed + cached**, not on-render. The display is on 24/7 — generating on every refresh burns tokens for content nobody might look at.

- Briefing stored as structured text/JSON with `generated_at` and `source_data_hash`
- Display reads from cache
- Regeneration triggers (see Cadence below) update the cache
- If display loads and cache is stale beyond a threshold (e.g., 2 hours past expected refresh), fall back to a lightweight "last updated" indicator and regenerate in background

#### Daily Regeneration Cadence

**Scheduled** (configurable per household):
- **6:00 AM** — morning briefing
- **12:00 PM** — midday refresh
- **4:30 PM** — evening briefing (timed to arriving home from work)
- **7:30 PM** — tomorrow preview (timed to winding down for bedtime)

**Event-triggered** (in addition to scheduled):
- Task with a deadline today gets completed
- Weather changes significantly (e.g., new precipitation forecast within next 24 hours)
- Calendar event added, edited, or deleted within today/tomorrow window
- New ambient suggestion needs to surface
- Routine completed/skipped

**Manual**: user can say "refresh briefing" via voice or tap a refresh icon on the display.

#### Layout

**On the display:**
- Briefing uses **sectioned format** with small section labels — easier to scan at a glance
- Hero line is visually prominent (larger type, top of the briefing area)
- Subsections collapse/expand based on whether they have content (no empty "Heads up" header if there's nothing to flag)

**On mobile (if added later):**
- Same content but **prose-flavored** — feels more like a personal note than a dashboard
- Accessible via voice query ("what's my briefing?") or a tile in the hamburger menu

**Display app layout (decided):**
- **Briefing = primary view**, occupies the largest area of the screen
- **Calendar strip** always visible (compact, shows next 3-5 events) — voice command can expand to full day/week/month
- **List panel** stays on the right, tabbed by list type (as today)
- Voice commands can swap any panel to full-screen temporarily

### 4.6 Weekly Planning Meeting — AI Scribe

User and spouse sit down for a planning conversation. AI listens, transcribes, and produces structured proposals across all data types for human review before anything commits.

#### Stage 1: Capture

**Recording surface: mobile app**, not the display. Reasoning:
- Phone is portable and can be placed between speakers
- Display app mic is calibrated for wake-word-at-distance, not 30-60min of conversation
- Phone allows intentional start/pause/stop without voice (which would get re-transcribed)

**Meeting screen UX:**
- Big record button, elapsed time, pause/resume, end
- "Drop a marker" button for tagging important moments
- No live transcription view — too distracting
- Audio captured locally on phone, uploaded at end of meeting (not streamed during)

#### Stage 2: Transcription

**Privacy (decided):** Start with cloud transcription (Gemini audio or Google STT). Architect the transcription step as a swappable module behind a clean interface so we can migrate to local Whisper later without rewriting the extraction/review pipeline. Revisit if: meetings become a weekly habit, OR a specific conversation makes you uncomfortable in retrospect, OR cost becomes meaningful.

- Cloud transcription (Gemini audio or Google STT) — see §4.6 privacy note
- **Background processing**: meeting ends, user does whatever, notification when ready
- No "processing..." waiting screen — transcripts of long meetings take real time
- Stored against a `MeetingNotes` record with timestamps

#### Stage 3: Extraction

AI processes transcript and extracts structured proposals across data types:

- **To-do items** (with notes/how/when/effort if mentioned in conversation)
- **Calendar events** (with date, time, attendees, location)
- **Routine changes** (new routines, pauses with duration, cadence adjustments)
- **Household facts** ("the new pediatrician is Dr. Y")
- **List items** (groceries from meal planning, etc.)
- **Deadline-aware tasks** (with `act_by` if mentioned)
- **Open questions** — things discussed but not decided. **High value: surfacing "you talked about whether to switch daycares but didn't decide" prevents the meeting from being wasted.**
- **Weekly context notes** (see §4.6.5 — drives briefing tone)

**Each extracted item carries:**
- the proposed structured data (normalized/cleaned for usability)
- a confidence score
- a transcript reference (timestamp range and exact quote)
- the AI's reasoning ("you said 'we should call about the pediatrician this week'")

**Assignment intelligence:** Speaker diarization (via Gemini audio) is used to auto-assign action items to the speaker who claimed them ("I'll handle the daycare research" → assigned to that speaker). Assignment is editable in review. If diarization accuracy proves unreliable in practice, downgrade to "always unassigned" globally.

#### Stage 4: Review & Commit

Mandatory review step. Nothing commits without human confirmation.

**Layout:**
- **Grouped by type** — all proposed to-dos together, all events together, etc. (scanning beats chronological)
- Each item shows: proposed structured data + "from this part of the conversation" (the supporting quote)
- **Per-item actions:** confirm / edit / skip
- **Group actions:** confirm-all-in-group, skip-all-in-group
- **Master action:** confirm everything currently approved → commits to respective systems

**"Review later"** saves the extraction without committing, for cases where you want to think about it.

**Forgotten reviews:**
- Single gentle notification after 24 hours
- Persistent mention in the briefing ("Tuesday's meeting still has 8 items waiting for review") until cleared
- **No auto-commit.** Auto-committing high-confidence items is exactly the trust-loss scenario we're avoiding.

#### Stage 5: Post-Commit Artifact

After commit, meeting becomes a searchable artifact:
- Full transcript stored (audio deleted after successful transcription; transcript kept indefinitely)
- List of what got committed where
- Open questions that didn't become anything
- AI-generated 1-2 paragraph meeting summary

**Powers downstream features:**
- Next-meeting prompts ("here's what was open from last time")
- Weekly briefing's "open items from last week's meeting" section
- Searchable history ("when did we last talk about daycare?")

#### Multiple Meetings Per Week

Treated as separate records. "Open items from last meeting" pulls from the most recent committed meeting regardless of timing.

#### Non-Actionable Content

Most of a planning meeting isn't action items — it's emotional processing, jokes, daughter anecdotes, complaints about work. The AI:

- **Does not extract** these into the structured systems (no surveillance profile)
- **Does include** a brief neutral summary of non-actionable parts in the meeting summary ("you also talked about how draining last week felt")
- **May propose Weekly Context Notes** (see below) when emotional/situational context would genuinely improve briefing tone

#### 4.6.1 Weekly Context Notes (Ephemeral Context)  *[schema + reaper landed, surfacing pending]*

A separate primitive that captures **time-bounded situational context** to inform briefing tone. Different from household facts (permanent) and different from briefings (regenerated content).

**Purpose:** Let the system show empathy and situational awareness without building a long-term emotional dossier. Examples:

- "Big presentation Friday — wish luck in Friday morning briefing"
- "Hard week expected — keep tone gentle, suggest rest where appropriate"
- "In-laws staying Tues-Sun — don't mention X, Y; daughter routines may shift"
- "Spouse traveling Wed-Fri — solo parent mode"

**Design principles — non-negotiable:**

1. **Ephemeral by design.** Every note has an `expires_at` set at creation. After expiration the note is **deleted**, not archived. System literally cannot accumulate a long-term emotional history because the data doesn't persist.

2. **User-visible and editable.** All active weekly context notes viewable in a single screen in the hamburger menu. User can see exactly what's influencing AI tone, edit any note, or delete instantly.

3. **Tone-layer only, not action-layer.** Notes influence *how* the briefing reads, not *what gets done* or *what gets surfaced as a task*. "Big presentation Friday" makes Friday's briefing supportive; it does **not** make the AI start asking how prep is going or auto-creating related to-dos.

4. **Privacy-suppression notes take precedence.** Notes that restrict content ("don't mention X while in-laws visit") are enforced strictly across all briefings and ambient suggestions during their active window.

5. **Capped duration.** Maximum `expires_at` is 30 days from creation. If user needs longer context, it should probably be a household fact, not a weekly context note. This cap is enforced.

**Data shape:**

```
WeeklyContextNote {
  id
  content              // free-text
  type                 // "emotional" | "situational" | "privacy_restriction" | "celebration"
  created_at
  expires_at           // max 30 days from creation
  influences           // ["briefing_tone", "ambient_suggestions", "suppression"]
  suppress_topics      // optional list of topics to avoid mentioning during active window
}
```

**Sources:**
- Proposed by AI during weekly meeting extraction (with review like everything else)
- Created manually via brain dump ("we have my sister staying next week, don't bring up her divorce")
- Created manually via hamburger menu

**Examples of tone influence:**

- Friday morning briefing without context note: "Friday. You've got the dentist at 11 and daughter's pickup at 4. Trash goes out tonight."
- Same briefing with "big presentation Friday" context note: "Friday — big day. Presentation this morning, you've got this. Dentist at 11 after, and daughter's pickup at 4. Trash tonight."
- Friday-end-of-hard-week context note: "It's Friday and you made it through. Tonight is yours — don't worry about the to-do list, take the win."

**Examples of suppression:**

- Context note: "Mother-in-law visiting Tue-Sun, don't mention bills or money stress in briefings"
- Briefings during that window simply omit financial routines/items from the visible content (still exist in the system, just not surfaced on the always-on display)

### 4.7 Household Memory / Knowledge Layer  *[schema landed, portal CRUD + RAG retrieval pending]*
A persistent store the AI can query for context. Not chat history — *facts about your household*.

Examples:
- "Daughter's pediatrician is Dr. X, last visit was…"
- "Lawn service comes Tuesdays, $X/month, contact…"
- "Wife prefers groceries from Aldi, except produce from…"
- "Our trash bin is the green one, recycling is blue"
- "Daughter is afraid of the vacuum"

Populated by: weekly meeting capture, explicit "remember that…" voice commands, periodic AI-prompted gap-filling ("I don't know who your vet is — want to add?").

**This is the moat for token efficiency.** Instead of stuffing context into every prompt, retrieve relevant facts per query (RAG pattern).

### 4.8 Kid-Aware Features (4yo daughter)
- Daughter's schedule as a first-class entity (daycare, activities, pickup/dropoff owner)
- "Who has [child] today?" — disambiguates parent responsibility
- Kid-friendly briefing view? (probably future — flagging it)
- Routines tied to her (bath nights, library day, etc.)

### 4.9 Decision Support / Light Coaching
Lower priority but worth scoping. AI helping with the "I'm overwhelmed, where do I start" moment.

- "I have 90 minutes and no energy" → AI suggests low-effort, high-impact options
- "Help me decide what to make for dinner" → considers what's in groceries, what was eaten this week, what's quick
- Specifically NOT: making decisions for you. It surfaces and reasons; you choose.

---

## 5. Architecture for AI Cost Efficiency

### 5.1 Model Tiering Strategy
- **Tier 1 (fast/cheap, ~all interactions):** Gemini 2.5 Flash for voice intent parsing, list operations, simple Q&A
- **Tier 2 (synthesis, scheduled):** Gemini 2.5 Pro (or Flash with more context) for briefings, weekly meeting processing — runs on a schedule or explicit trigger, not per-interaction
- **Tier 3 (local, optional):** Self-hosted LLM on gaming PC for privacy-sensitive tasks (meeting transcription processing, household memory queries). Worth it if: meeting recording becomes regular AND you're comfortable maintaining the stack.

### 5.2 Context Management (the token efficiency point)
- **Don't pass everything every time.** Build a retrieval layer over household memory.
- **Structured context, not chat history.** Pass JSON-ish facts ("today_calendar: […], pending_deadlines: […], weather: …") instead of natural-language history.
- **Cache aggressive.** Briefings can be cached and only regenerated when underlying data changes meaningfully.
- **Pre-compute, don't reason.** "What should I do" can pre-filter candidate tasks deterministically (deadline math, effort match), then ask LLM to narrate/rank the top N.

### 5.3 Voice Pipeline (decided)
- **Wake word: local** (Porcupine, openWakeWord, or similar) — never streams audio without intent. Non-negotiable.
- **STT: cloud** (Gemini or Google STT) for follow-up commands — latency + accuracy win
- **Intent routing:** small/cheap LLM call classifies → fast paths for known intents (add to list, change view) skip the heavier LLM entirely
- **LLM:** only invoked for genuinely conversational or contextual queries

### 5.4 Text-to-Speech (TTS)

The display's voice is heard dozens of times a day — quality matters. Browser-native Web Speech voices are robotic and must be replaced; they actively undermine the calm-partner tone designed into briefings and ambient suggestions.

#### Provider Choice

**Google Cloud TTS (Chirp 3 HD) as default.**

- Naturally extends the existing Google/Gemini ecosystem (one less vendor relationship)
- Chirp 3 HD voices are genuinely natural, not uncanny-valley
- Cost is negligible — typical briefing is 500-1500 characters; fractions of a cent per playback
- Quality is sufficient that ElevenLabs would only meaningfully improve things if voice cloning is wanted later

**Architecture for swappability:** Build TTS as a thin interface (`speak(text, voice_id, options) → audio_stream`) with a Google adapter first. Adding ElevenLabs or local Piper later becomes a one-file change. Small upfront investment, real long-term flexibility.

**Why not local (Piper / Coqui XTTS) initially:**
- Pi-hosted Piper is OK but not the natural-sounding step up we want
- Gaming-PC-hosted XTTS adds an availability dependency (PC + network must be up) for what's purely cosmetic
- TTS cost is the cheapest part of the AI stack; no real savings to chase

#### Voice Configuration

**Per-family voice setting**, persisted server-side so voice doesn't reset between sessions or devices.

- Voice character: **mature, warm-conversational, female** (per user preference)
- Voice selection lives in the hamburger menu (both apps) — audition and switch easily
- Setting is family-level, not user-level — household-shared assistant, household-shared voice
- New families get a sensible default; existing families keep their last selection

**Single voice, not multiple.** No separate voices for briefings vs. system confirmations vs. nags. One voice with prosody/tone variation by context is calmer than multiple AI personalities sharing one device.

#### SSML / Prosody (yes, with restraint)

**Cost:** essentially free. Google bills on text content; SSML tags don't count toward billable characters (with rare exceptions like `<sub alias>`).

**Latency:** negligible — server-side parsing adds milliseconds. The only real latency from SSML is when you insert long pauses, since a 2s pause genuinely plays for 2s.

**Use cases:**
- Pauses between briefing sections (natural rhythm)
- Soft emphasis on important specifics ("your dentist appointment is *tomorrow at 11am*")
- Soften endings instead of the default declarative drop

**Caveat:** Newer voice models (Chirp 3 HD) sometimes handle SSML *less* naturally than older Neural2 voices because they're trained to do prosody implicitly. Practical pattern: use SSML sparingly and only where it clearly helps; let the model handle natural prosody elsewhere. Don't over-engineer.

#### Audio Caching

Synthesized briefing audio is cached alongside the briefing text content. Since briefings are pre-computed (see §4.5), their audio can be pre-synthesized too:
- Playback is instant
- No re-synthesis on replay
- Cache invalidated when the briefing regenerates
- Tiny optimization, real UX win — feels responsive instead of waiting for synthesis on every play

### 5.4 Self-Hosted LLM — When It's Worth It
Honest take: probably not yet. Reasoning:
- Gemini 2.5 Flash is extremely cheap; you'd burn months/years of API cost before a GPU upgrade pays off
- Self-hosting adds operational burden (your time is the scarce resource here)
- Quality gap vs. Flash is non-trivial for the synthesis tasks that matter most

**Reconsider when:** privacy concerns become concrete (you actually want meeting audio off the cloud), OR API costs cross some threshold (set a number — e.g., $30/mo?), OR you want to experiment for its own sake (legit reason, just be honest about it).

---

## 6. Data Model Sketch

```
Family
  ├─ Users (authenticated members)
  ├─ Profiles (non-auth entities: kids, pets, dependents) { name, type, attributes }
  ├─ Lists (todo, grocery, custom)
  │    └─ Items { text, notes, how, when, why, deadline, lead_time, effort, energy,
  │              assignee (User|Profile), nag_level, done }
  ├─ Routines { name, cadence, next_due, owner (User|Profile|null),
  │             nag_level, category, history[] }
  ├─ Events (Google Calendar sync + native)
  │    └─ assignee (User|Profile|null)
  ├─ HouseholdFacts { key, value, category, source, last_updated }
  ├─ WeeklyContextNotes { content, type, created_at, expires_at (max 30d),
  │                       influences[], suppress_topics[] }
  ├─ Briefings { type (daily|weekly|monthly), generated_at, content, source_data_hash }
  ├─ Suggestions { content, generated_at, dismissed_at, source_data }
  └─ MeetingNotes { date, transcript_ref, extracted_actions[], confirmed: bool }

QuietHours (household-level) { start, end, days[], exceptions[] }
FamilySettings { voice_id, tts_provider, theme, briefing_schedule, ... }
Release { version, released_at, notes { new_features[], improvements[], fixes[] } }
UserReleaseAck { user_id, last_version_seen, last_popup_shown_date }
```

**Note on polymorphic assignee:** any item that can be "owned" by a household member references either a User or a Profile via the same field. Routines without an owner are household-shared (trash, lawn).

---

## 7. Resolved Decisions Log

All initial open decisions resolved:

1. **Display layout** — briefing primary, calendar strip + list panel alongside (see §4.5)
2. **Meeting transcription** — start cloud (Gemini audio), architect for migration to local Whisper later (see §4.6)
3. **STT for voice commands** — cloud (Gemini/Google STT); local wake word (see §5.3)
4. **Nag escalation** — per-task `nag_level` with auto-escalation by deadline math + household-level quiet hours (see §7.1)
5. **Ambient suggestions** — always-shown, sparse, contextual; 1-2 max, fades when stale (see §7.2)
6. **Dependents** — profile model with polymorphic assignee field (see §7.3)

New decisions captured here as they arise.

### 7.1 Nag Escalation
- Three levels per task/routine: `passive` (briefing only), `surface` (briefing + ambient suggestions), `assertive` (briefing + ambient + voice announcement when user is near display)
- Default for new items: `surface`
- **Auto-escalation by deadline math:** A `passive` task with a deadline approaching can temporarily promote itself based on `act_by` proximity. User doesn't have to remember to bump priority — system handles it.
- **Global quiet hours** (household-level, configurable; default 9pm-7am): suppress everything except `assertive`
- **Household-level, not per-user.** Shared assistant; per-user nag levels create resentment dynamics.
- AI tone follows the level: passive = neutral statement, surface = friendly heads-up, assertive = clear and direct (still not scolding)

### 7.2 Ambient Suggestions
- Lives as a small "right now" section within the briefing — not a separate panel
- Hard cap: 1-2 suggestions visible at any time
- Updates based on state changes (task completed, time crossed a threshold, weather changed) — not just a refresh timer
- After ~30 min stale, fades to neutral ("nothing pressing right now") rather than recycling the same suggestion
- Snoozed/dismissed suggestions don't reappear same day
- Principle: feels like a calm partner that occasionally has a thought, not a manager assigning work
- Quality scales with household memory + routines coverage — expect thin suggestions early, accept that as a feature

### 7.3 Dependents (Profiles)
- Daughter modeled as a `Profile` — structured entity with attributes (name, age, schedule, preferences) but no auth
- `assignee` fields across tasks/events/routines are **polymorphic** — can reference a `User` or a `Profile` interchangeably
- Routines and recurring events can target a profile ("daughter has swim Tuesdays")
- "Who has [profile] today?" becomes a first-class query
- Extends cleanly to: future kids, pets (vet appointments, medication), elderly parents — same data shape
- If/when daughter is old enough for her own login, attach a `User` to the existing `Profile` without data restructuring

---

## 8. Existing Stack & Migration Notes

### Current state

- **Frontend:** Angular for both apps. Mobile is a PWA. Display app runs on a Raspberry Pi-attached screen.
- **Backend / DB / Auth:** Supabase (managed Postgres, auth, storage, edge functions available).
- **Source control / CI:** GitHub + GitHub Actions.
- **External integrations (current):** Google Calendar (read), Gemini (voice + extraction).
- **Hosting:** None yet. Currently local-only.
- **Owner is attached to:** the existing theming system. Do not refactor it. New features must consume the existing theming primitives.

### What can be replaced freely

Aside from the theming system, the owner is not attached to current implementations. UI redesigns, restructured components, new data layer abstractions — all fair game in service of the spec.

### Hosting recommendation (decided)

- **Apps (mobile PWA + display app):** Vercel. Best Angular DX, generous free tier, automatic CI/CD from GitHub.
- **Backend logic (Google Calendar write endpoints, scheduled briefing generation, TTS synthesis, transcription orchestration):** Supabase Edge Functions where possible — keeps the stack consolidated and the bill predictable. Reach for Cloud Run only when an Edge Function can't do the job (long-running jobs > 60s, specific GCP dependencies).
- **Scheduled jobs (briefing regeneration cadence, routine `next_due` advancement):** Supabase scheduled functions or pg_cron — already in the stack, no new infra.

### Required new external services

- **Google Cloud TTS** (Chirp 3 HD) — see §5.4
- **Google STT or Gemini audio** for transcription — see §4.6
- **Weather API** — when Phase 3 hits; OpenWeatherMap or Pirate Weather are reasonable, low-cost choices. Defer this decision until Phase 3.
- **Wake-word detection library** running on the display Pi — Porcupine (commercial, free for personal use) or openWakeWord (open source). See §5.3.

### Architectural notes for the implementer

- All AI provider calls should go through a thin adapter layer. The doc commits to Gemini and Google TTS today; the code should not commit to them irreversibly. This matters for cost experimentation and the eventual self-hosting evaluation.
- Same pattern for transcription (cloud now, possibly local Whisper later).
- Same pattern for TTS (Google Chirp 3 HD now, swappable later).
- All scheduled work (briefing regeneration, routine advancement, expired context note cleanup) should be idempotent. The system will be restarted, jobs will overlap, and the cost of correctness here is low.

---

## 9. Documentation, Versioning, and Release Notes

The owner is vibe-coding with autonomous Claude Code. Documentation is not optional — it's the substrate that makes the workflow viable. Three artifacts are required:

### 9.1 CLAUDE.md (in repo root)  *[initial scaffold landed at repo root]*

A living technical document maintained by Claude Code as part of normal development. **Update it as part of the same PR/commit as the code change** — never deferred, never batched.

Contents:
- **What the codebase is** (one-paragraph orientation for someone reading fresh)
- **Architecture overview** — apps, services, where the lines are drawn
- **Data model** — current shape of all primitives, linked to source files
- **External integrations** — what we call, where the adapters live, what API keys are needed
- **Feature implementation status** — for every section in `FEATURES.md`, current state (not started / in progress / complete / partial-with-notes)
- **Known limitations and TODOs** — anything the implementer punted on, with reasoning
- **Recent significant changes** — rolling log of the last ~20 substantive changes with date, summary, and link to commit/PR
- **Gotchas** — anything weird about the codebase that would trip up a fresh reader

CLAUDE.md is for the implementer (Claude Code) and any human reading along. It's technical, not user-facing.

### 9.2 In-App "How to Use" Page (mobile)  *[page + route landed at `/help`; hamburger entry pending until home redesign]*

A dedicated page in the mobile app explaining every available feature to the user.

- Lives in the hamburger menu under a clearly labeled entry ("How to use" or "Help")
- Sections organized by feature area (Brain Dump, Lists, Calendar, Routines, Briefings, Weekly Meeting, Settings, etc.)
- Each section: what the feature does, how to use it (with voice command examples where relevant), what options/configurations exist
- Includes a link to the Release Notes page (§9.3)
- Maintained by Claude Code as features are added/changed — the implementer treats user-facing docs as a deliverable for any feature PR
- Written in a friendly, conversational tone matching the overall product voice — not as a dry manual

### 9.3 Release Notes System  *[data model + popup + history page landed; awaiting first release record]*

A user-facing release notes feature tied to user accounts.

**Versioning:**
- Semantic versioning (MAJOR.MINOR.PATCH)
- Claude Code determines version bumps based on change scope:
  - **PATCH**: bug fixes, small UI tweaks, copy changes
  - **MINOR**: new features, meaningful UX improvements, new settings
  - **MAJOR**: breaking changes to data model, major architecture shifts, fundamental UX changes
- A "release" is cut **when a feature or set of related changes is complete and shipped to production** — not per PR, not on a fixed schedule. Claude Code decides when changes constitute a release worth notifying users about. Small internal refactors with no user-visible impact don't get release notes.

**Release notes content:**
- User-facing language, not commit messages
- Grouped by category (New features / Improvements / Fixes)
- Include relevant feature names and how to access them
- Skip purely internal changes (new helper functions, refactors, dependency bumps)
- Include version number and date

**User-facing surface:**
- **Pop-up timing:** Shown on the **first app open of a new calendar day** when there are unread releases for the user. Not on every app load. If multiple sessions happen in one day, the pop-up only appears in the first.
- **Batched content:** If multiple releases have shipped since the user last saw a pop-up, the single pop-up shows **a combined list** of all unread releases (grouped by version, most recent first). User never sees multiple release pop-ups in succession.
- **Dismissal:** Dismissing the pop-up marks every version it contained as read for that user. Won't pop up again until a newer release ships.
- **Persistent release notes page** in the mobile app (linked from "How to Use"), showing full version history with timestamps. User can revisit any release any time.
- **No pop-up on display app** — the display is an ambient surface, not a place for product announcements. Release notes for the display are documented but never interrupt.

**Data shape:**

```
Release {
  version           // semver string
  released_at       // timestamp
  notes {
    new_features[]
    improvements[]
    fixes[]
  }
}
UserReleaseAck { user_id, version_seen }
```

### 9.4 Documentation discipline rules (non-negotiable)

- CLAUDE.md is updated **in the same commit** as the change it documents. Never "I'll update the docs next."
- User-facing "How to Use" copy is updated **as part of the feature PR**. A feature isn't done until its docs exist.
- Release notes are drafted **at the time of the change**, not reconstructed later from git logs (reconstructed release notes are always worse).
- If a documentation update is ambiguous (unclear how to describe a feature to users), this is a signal to stop and ask the human.

---

## 10. Phasing Suggestion (rough)

**Phase 0 — Setup**
- Hosting setup (Vercel, Supabase production project)
- AI adapter layer scaffolding (Gemini, Google TTS, Google STT abstractions)
- CLAUDE.md initial scaffolding
- "How to Use" page scaffolding
- Release notes data model and pop-up flow

**Phase 1 — Foundation rework**
- List item metadata (notes/how/when/effort)
- Routines as a new primitive (with pause-with-duration)
- Household memory store (schema + basic CRUD)
- Profile model for daughter
- Weekly Context Notes primitive (data layer only; surfacing comes with briefings in Phase 2)
- Mobile UI redesign with brain dump home page
- Family-level voice settings (TTS provider integration)

**Phase 2 — Ambient intelligence**
- Briefing generation (daily first, then weekly/monthly)
- Briefing scheduled regeneration (6am / 12pm / 4:30pm / 7:30pm) + event-triggered regeneration
- TTS synthesis + audio caching for briefings
- "What should I do now" endpoint
- Display app redesign around briefing
- Weekly Context Notes surfacing in briefings

**Phase 3 — Deadline awareness**
- Hard-deadline + lead-time tasks
- Auto-escalation by deadline math
- Quiet hours enforcement
- Weather integration

**Phase 4 — Meeting scribe**
- Audio capture (mobile, with marker tagging)
- Background transcription pipeline
- Multi-domain extraction (lists, events, routines, facts, context notes, open questions)
- Review + commit flow with speaker-based assignment
- Searchable meeting artifact

**Phase 5 — Polish**
- Self-hosted LLM evaluation (if warranted by then)
- Kid-aware briefing features
- Touch on display
- Local transcription migration (Whisper) — if privacy or cost arguments materialize
