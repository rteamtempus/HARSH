# Dev Infrastructure Setup

> Running checklist of one-time setup the **owner** needs to do (accounts, keys, billing). Feature work doesn't depend on these being complete — but deploys, TTS, and voice features do. Tick boxes as you go.

Status legend: `[x]` done · `[ ]` not started · `[~]` partial · `[!]` blocked

Last updated: 2026-05-24

---

## 1. Supabase

- [x] Production project created (`bdqvpdobywqbyvjehyjs`)
- [x] CLI linked (`npm run db:link`)
- [x] Migrations pushed (auto-applied as features land)
- [ ] Edge Function secrets configured
  - [ ] `GEMINI_API_KEY` — used by `ai-intent`, `llm`, `generate-briefing`
  - [ ] `GOOGLE_CLOUD_API_KEY` — used by `tts` AND `generate-briefing` (briefing TTS is conditional on this; if unset, briefings stay text-only)
  - [ ] `CRON_SECRET` — used by `tick-briefings` to authenticate scheduled calls. Generate with `openssl rand -hex 32`.
- [ ] **Deploy edge functions** as features land:
  - [ ] `npx supabase functions deploy llm` (brain-dump backend)
  - [ ] `npx supabase functions deploy tts` (voice synthesis)
  - [ ] `npx supabase functions deploy generate-briefing` (daily/weekly/monthly briefings)
  - [ ] `npx supabase functions deploy tick-briefings` (cron orchestrator)
  - [ ] `npx supabase functions deploy transcribe-meeting` (meeting audio → transcript)
  - [ ] `npx supabase functions deploy extract-meeting` (transcript → proposals)
  - [ ] `npx supabase functions deploy tick-calendar-sync` (hourly ICS refresh orchestrator)
- [ ] Schedule the context-note reaper (`reap_expired_context_notes()`) via pg_cron — see below
- [ ] Schedule briefing regeneration via pg_cron — 6am / 12pm / 4:30pm / 7:30pm per FEATURES.md §4.5

### Setting up pg_cron schedules

Both pg_cron and pg_net are pre-installed on Supabase. Enable them once in your project, then run the SQL script below.

**1. Enable extensions** (Database → Extensions in the dashboard — toggle on):
- `pg_cron`
- `pg_net`

**2. Store secrets in vault** (run as SQL in the SQL Editor — one-time):

```sql
-- Replace placeholders with your actual values.
select vault.create_secret('https://bdqvpdobywqbyvjehyjs.supabase.co', 'project_url');
select vault.create_secret('<your CRON_SECRET>', 'cron_secret');
```

**3. Schedule jobs** (run as SQL — one-time):

```sql
-- Context-note reaper: every hour at :05
select cron.schedule(
  'reap-context-notes',
  '5 * * * *',
  $$ select public.reap_expired_context_notes(); $$
);

-- Briefing tick: 6am, 12pm, 4:30pm, 7:30pm (UTC; adjust to your timezone offset)
-- Replace 'America/Chicago' with your family timezone.
-- pg_cron runs in UTC; convert your local times to UTC cron expressions.

-- 06:00 local daily briefing
select cron.schedule('briefing-morning', '0 12 * * *',  -- 06:00 CT (UTC-6) = 12:00 UTC
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/tick-briefings',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')
    ),
    body := jsonb_build_object('type','daily')
  );
  $$
);
-- Repeat the same pattern for 12pm / 4:30pm / 7:30pm by changing the cron expression
-- and the literal job name. Sunday-evening weekly: '0 1 * * 1' (Sun 19:00 CT). Monthly: '0 12 1 * *'.

-- Hourly calendar sync (every hour at :15 to avoid colliding with the reaper at :05).
select cron.schedule('calendar-sync-hourly', '15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/tick-calendar-sync',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

See the Supabase docs: https://supabase.com/docs/guides/database/extensions/pg_cron

---

## 2. Vercel

- [x] Account exists, repo imported
- [x] Two projects created (portal + display)
- [x] Build settings: build command, output dir, framework "Other"
- [x] `vercel.json` in repo for SPA fallback + cache headers
- [ ] Environment variables set on **both** projects (Settings → Environment Variables, scope: All)
  - [ ] `SUPABASE_URL` = `https://bdqvpdobywqbyvjehyjs.supabase.co`
  - [ ] `SUPABASE_ANON_KEY` = the long JWT (same value as in your local `environment.development.ts`)
- [ ] First successful production deploy on both projects
- [ ] Custom domain (optional, later)

---

## 3. Google Cloud (TTS + STT)

- [~] Project created (you're in the middle of this)
- [x] Billing enabled with threshold alert
- [ ] APIs enabled
  - [ ] Cloud Text-to-Speech API
  - [ ] Cloud Speech-to-Text API
- [ ] **API key** (recommended path — skip service-account roles entirely)
  - [ ] APIs & Services → Credentials → Create API key
  - [ ] Restrict the key: API restrictions → only Text-to-Speech + Speech-to-Text
  - [ ] Save key for paste into Supabase Edge Function secrets as `GOOGLE_CLOUD_API_KEY`

> Why API key over service account here: TTS doesn't have a user role at all, STT needs `roles/speech.client` (not "Service Agent" — that's Google's own), and an API key restricted to two APIs gives the same security shape with a fraction of the setup. See chat log for full reasoning.

---

## 4. Gemini

- [x] API key exists, wired into `ai-intent` Edge Function as `GEMINI_API_KEY`
- [ ] **Cost threshold alert at $30/mo** (FEATURES.md §5.4 reconsider-self-hosting line)
  - GCP Billing → Budgets & alerts → Create budget filtered on **Generative Language API**
  - Alert thresholds: 50%, 90%, 100%

---

## 5. Wake word (Phase 2 — not blocking)

- [ ] **Decision: Porcupine vs. openWakeWord** — recommend Porcupine (free for personal, easier custom wake word)
- [ ] Sign up at https://console.picovoice.ai
- [ ] Create a wake phrase (2-3 syllables, distinctive, e.g. "hey house", "house assist")
- [ ] Download `.ppn` files: one for Linux ARM (the Pi), one for Web/WASM (desktop testing)
- [ ] Save Picovoice access key
- [ ] Hand both to Claude when ready to wire into display app

---

## 6. Raspberry Pi (Display device, later)

- [ ] Pi OS Lite or full Pi OS installed
- [ ] Chromium kiosk mode autostart (`chromium --kiosk --noerrdialogs --disable-infobars <display-url>`)
- [ ] Wake-word library installed (Porcupine SDK or openWakeWord)
- [ ] Microphone hardware connected + tested
- [ ] Auto-login + screen-blank-disable

---

## 7. Domain & email (way later)

- [ ] Domain registered (when ready to share with other families)
- [ ] DNS pointed at Vercel projects
- [ ] Supabase SMTP / magic-link sender email branded

---

## Notes

- API keys (Gemini, Google Cloud, Picovoice) all live in **Supabase Edge Function secrets**, never in client code or git.
- The anon Supabase key in `environment.*.ts` is safe to deploy — RLS enforces all security.
- When in doubt, set a budget alert. $30/mo for Gemini, $20/mo for Google Cloud — interrupt is cheaper than surprise.
