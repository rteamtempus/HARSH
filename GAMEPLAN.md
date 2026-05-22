# Family Management System — Game Plan

A two-app household system: a **Portal PWA** (phones + computers) for capture/config, and a **Display** app (Raspberry Pi TV kiosk) for ambient, glanceable family status. Both share one Supabase backend and one AI assistant powered by Gemini 2.5 Flash.

Designed for a dyslexic, ADHD-prone household: voice-first, low cognitive load, fast capture, and intentionally minimal. Built to be multi-tenant from day one so other families can join later.

---

## 1. Guiding Principles

1. **Capture in under 3 seconds, or it didn't get captured.** Voice on every surface.
2. **Visible response beats spoken confirmation** when a screen is in view.
3. **Externalize memory, don't add to it.** Show "what's now / what's next" — never a backlog.
4. **One household, one source of truth.** No per-kid logins, no permission mazes.
5. **Ambient on the TV.** No notifications, no popups, no touch interactions required.
6. **Build for our family first.** Multi-tenant infra, but don't design for hypothetical users.
7. **Boring infra, interesting product.** Use the obvious tool unless there's a real reason not to.

---

## 2. Recommended Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend (both apps) | **Angular 18+** (standalone components, signals) | Familiar to you. One workspace, two apps shares code cleanly. |
| Portal delivery | **PWA** (Angular service worker) | Installs to phone home screen, works on desktop. |
| Display delivery | Same Angular workspace, separate app target, **Chromium kiosk mode** on the Pi | `chromium --kiosk --noerrdialogs --disable-infobars <url>` autostarted via systemd. |
| Backend / DB / Auth / Realtime / Storage | **Supabase** | One service covers Postgres, row-level security, auth, websockets, file storage. Free tier easily handles a family. |
| Hosting | **Cloudflare Pages** (recommended) or Netlify | Free, fast, great Angular support, generous bandwidth. GitHub Pages works but no env-var server-side bits. See §3. |
| AI / NLU | **Gemini 2.5 Flash** via a Supabase Edge Function | Edge Function keeps your API key out of the client. |
| Voice → text | **Web Speech API** (browser) on Portal; **Vosk** or **whisper.cpp** local on the Pi for offline-friendly STT | Free. Web Speech is good enough on Chrome/Android/iOS. |
| Text → voice (optional) | Web Speech API `SpeechSynthesis` | Free, native. |
| Source / CI | **GitHub** + **GitHub Actions** | Build + deploy to Cloudflare Pages on push. |
| Calendar source of truth | Supabase tables; **two-way sync to Google Calendar** later via a scheduled Edge Function | Don't depend on Google as primary store — keeps you portable. |

### Why not Google Cloud
You're not attached to it, and you don't need Cloud Run / Firestore for this scale. Supabase + Cloudflare Pages is cheaper, simpler, and the auth/RLS story is better. Keep Google only for *Calendar sync* (optional, later).

### Why Cloudflare Pages over Netlify
Nearly identical DX. CF Pages has unlimited bandwidth on free tier and faster global edge. Netlify is fine too — pick whichever onboarding you prefer. **GitHub Pages** I'd skip: no environment variables, no server functions, awkward for PWAs with auth callbacks.

---

## 3. Monorepo Layout

```
family-system/
├── apps/
│   ├── portal/          # Angular PWA
│   └── display/         # Angular kiosk app
├── libs/
│   ├── data-access/     # Supabase client, typed DB models, RLS-aware queries
│   ├── ai/              # Gemini intent client, prompt templates
│   ├── voice/           # STT/TTS wrappers, wake-word handling
│   └── ui/              # Shared components, theme, dyslexia-friendly typography
├── supabase/
│   ├── migrations/      # SQL schema
│   └── functions/       # Edge Functions (ai-intent, calendar-sync, etc.)
└── pi/
    └── kiosk-setup.md   # Raspberry Pi provisioning notes
```

Use **Nx** or **Angular CLI workspaces** to manage this. Nx is overkill for two apps but pays off if scope grows. Start with plain Angular workspace; migrate to Nx only if you feel pain.

---

## 4. Data Model (Supabase / Postgres)

Multi-tenant from day one. **Every row that belongs to a family carries `family_id`**, and **every table has RLS** that restricts access to `family_id IN (select family_id from family_members where user_id = auth.uid())`.

Core tables:

- `families` — id, name, settings (jsonb), created_at
- `family_members` — family_id, user_id, role (`owner` | `adult` | `kid`), display_name, color, avatar_url
- `events` — family_id, title, starts_at, ends_at, all_day, location, owner_member_id, source (`manual` | `gcal`), external_id
- `lists` — family_id, name, kind (`grocery` | `todo` | `custom`), sort_order
- `list_items` — list_id, text, checked, added_by_member_id, added_at
- `notes` — family_id, body, pinned, created_by, created_at
- `display_config` — family_id, layout (jsonb describing widgets + positions)
- `ai_log` — family_id, member_id, transcript, parsed_intent (jsonb), result, created_at *(critical for debugging the AI)*

Design choices:
- **JSONB for layout and settings** — flex without migrations for every UI tweak.
- **`ai_log` is non-negotiable.** When voice misfires, you need the transcript + parsed intent to fix prompts.
- **No soft deletes initially.** Add `deleted_at` when you actually need undo across sessions.
- **No premature normalization.** `list_items.text` is just text, not a `products` table.

---

## 5. Voice + AI Pipeline

```
[user speaks]
   ↓ Web Speech API (or Vosk on Pi)
[transcript: "add milk to groceries and remind me Tuesday to call the dentist"]
   ↓ POST to Supabase Edge Function `/ai-intent`
[Edge Function: Gemini 2.5 Flash with structured-output schema]
   ↓ returns array of intents:
   [
     {action: "list.add_item", list: "grocery", text: "milk"},
     {action: "event.create", title: "Call dentist", starts_at: "2026-05-26T09:00"}
   ]
   ↓ Edge Function executes each intent against the DB (with the user's auth)
   ↓ Returns result + spoken confirmation text
[client applies optimistic UI update; realtime channel updates the TV display]
```

Key decisions:
- **Structured output, not freeform.** Force Gemini to return JSON matching a strict schema. Reject and retry on parse failure.
- **Intents are verbs, not commands.** `list.add_item`, `event.create`, `display.show_view`, `note.add`. New features = new intents.
- **Server-side execution.** The model proposes; the Edge Function disposes. The model never writes to the DB directly — it returns intents, the function validates and applies them. This is your security boundary.
- **Log every transcript + intent + result to `ai_log`.** You will need this constantly.
- **Cheap before fancy.** Don't add function-calling tools or RAG until simple intent parsing fails you.

### What voice should control
- Lists: add/remove/check items, switch which list is shown on the TV
- Calendar: create events, ask what's coming up, switch between day/week/month views on TV
- Notes: add a quick note, pin/unpin
- Display: change which widgets are visible ("show the calendar full screen", "hide chores")

### What voice should NOT control (yet)
- Account/family member management — too risky, too rare. Do it in the Portal with buttons.
- Anything destructive without confirmation ("delete all events") — gate with an explicit confirm intent.

---

## 6. The Display App (TV / Raspberry Pi)

- **Pi 4 (4GB) or Pi 5.** Pi 5 if you can get one — Chromium is smoother.
- **Raspberry Pi OS Lite + minimal X / Wayland + Chromium in kiosk mode.** No desktop environment needed.
- Autostart via `systemd` user service running `chromium-browser --kiosk --app=https://your-portal.pages.dev/display`.
- **Display app authenticates as a "device" user** tied to the family — long-lived refresh token, no daily login. Pair the device once from the Portal.
- **Realtime updates via Supabase Realtime channels.** Portal adds milk → TV shows milk within ~200ms.
- **No clicks, no menus.** The TV is read-only-by-touch. Everything mutating happens through voice or the Portal.
- **Layout is data.** `display_config.layout` is JSONB describing widgets and grid positions. Edited from the Portal. Means new widgets only need a component + a layout entry, no app redeploy for arrangement changes.

### Dyslexia / ADHD considerations on the TV
- Font: **Atkinson Hyperlegible** or **Lexend** (Lexend is research-backed for reading fluency). OpenDyslexic is divisive — try it but don't commit.
- Background: warm off-white (`#f7f3e8`) or dark mode with `#e8e4d8` text. Avoid pure black-on-white.
- **Time-blindness aids:** "in 2 hours" labels next to absolute times.
- **One thing per zone.** Top: today. Middle: lists. Bottom: ambient (weather, next event).
- **Color-code people**, not categories. Each family member has one color, used consistently everywhere.

---

## 7. The Portal PWA

- **Installable** via Angular service worker + manifest. Add to home screen on iOS/Android.
- **Voice button is the primary UI.** Big mic button on the home screen. Tap → speak → done.
- **Secondary UI is forms** for the rare cases voice can't do (managing family members, editing display layout, connecting Google Calendar).
- **Works offline for capture.** Queue intents locally (IndexedDB) when offline, flush on reconnect.
- **Auth via Supabase Auth** — magic link email is simplest; add Google OAuth later if you want one-tap.

---

## 8. Multi-Tenancy (for future families)

You're already 90% there if every table has `family_id` + RLS. To onboard another family:
1. They sign up (Supabase Auth).
2. First sign-up triggers a function that creates a `families` row and adds them as owner.
3. They invite members by email (insert pending row, claimed on signup).

**Do not build a billing system, admin panel, or org switcher now.** When a second family asks, you'll know what they actually need.

---

## 9. Build Order

Cut scope ruthlessly. Each phase ends with something you actually use.

### Phase 0 — Foundations (week 1)
- Angular workspace with two app targets (`portal`, `display`)
- Supabase project + initial schema + RLS policies
- Cloudflare Pages deploy on push to `main` via GitHub Actions
- Magic-link auth working on Portal
- "Hello, family" page on Display, authenticated as a device

### Phase 1 — Lists (week 2)
- Grocery + todo lists, manual add/check/delete on Portal
- TV displays current grocery list with realtime updates
- **First win:** add an item on your phone, watch it appear on the TV

### Phase 2 — Voice + AI capture (week 3)
- Web Speech API on Portal mic button
- Supabase Edge Function calling Gemini 2.5 Flash with strict intent schema
- Intents: `list.add_item`, `list.check_item`
- `ai_log` table populated
- **Second win:** "add milk" actually works end-to-end

### Phase 3 — Calendar (week 4)
- Events table, week + day views on TV
- Voice intents: `event.create`, `event.query`
- Color-coded per family member

### Phase 4 — TV polish + Pi deployment (week 5)
- Layout JSON, widget components
- Pi kiosk setup (write the actual `kiosk-setup.md`)
- Voice control of TV from Portal: `display.show_view`
- Optional: wake-word listener on the Pi for hands-free TV voice control (Picovoice Porcupine has a free tier)

### Phase 5 — Family + future-proofing (week 6+)
- Invite family members
- Google Calendar two-way sync (Edge Function on a cron)
- Notes, pinned items
- Whatever you've learned you actually want by now

---

## 10. Things I'd Explicitly NOT Build

Based on what families actually abandon:
- **Meal planning module** — too much input cost, ignored after 3 weeks.
- **Habit trackers with streaks** — shame-inducing for ADHD users, kills motivation.
- **Notifications from the TV** — ambient only. No pings.
- **Chore reward systems / gamification** — adds maintenance burden, fades fast.
- **Kid logins** — friction kills it. One household account, color-coded members.
- **Touch UI optimized for the TV** — nobody walks over to tap. Voice + phone wins.

You can always add these later if a real need emerges. Don't pre-build them.

---

## 11. Open Questions for You

1. **Hosting:** Cloudflare Pages or Netlify? (My pick: Cloudflare Pages.)
2. **Wake word on the TV:** worth the complexity in Phase 4, or stay tap-to-talk on the Portal only?
3. **Google Calendar:** do you currently live in it, or are you happy with our calendar being primary? (Affects Phase 3 vs 4 priority.)
4. **Pi hardware:** do you already have a Pi, or do we need to spec one? (Pi 5 4GB recommended.)
5. **Repo name + Supabase project name** — so I can set up the skeleton when you're ready.

---

## 12. Next Concrete Step

When you're ready, the first session is "Phase 0 — Foundations." I'll walk you through:
1. Creating the Angular workspace with two apps
2. Creating the Supabase project + initial schema + RLS
3. Wiring GitHub → Cloudflare Pages deploys
4. Magic-link auth end-to-end

Each of those is ~30–60 minutes of focused work. We can do them in one sitting or spread across evenings.
