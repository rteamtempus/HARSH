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
  - [ ] `GEMINI_API_KEY` — verify it's set on the `ai-intent` AND new `llm` functions
  - [ ] `GOOGLE_CLOUD_API_KEY` — add to the new `tts` function once you have the key from §3
- [ ] **Deploy edge functions** as features land:
  - [ ] `npx supabase functions deploy llm` (brain-dump backend)
  - [ ] `npx supabase functions deploy tts` (voice synthesis)
  - [ ] `npx supabase functions deploy generate-briefing` (daily/weekly/monthly briefings)
- [ ] Schedule the context-note reaper (`reap_expired_context_notes()`) via pg_cron
- [ ] Schedule briefing regeneration via pg_cron — 6am / 12pm / 4:30pm / 7:30pm per FEATURES.md §4.5

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
