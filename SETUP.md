# HARSH — first-time setup checklist

Run these once per machine. Most of this is reference for future-you (or another family member helping set up a dev box).

## 1. Tooling

- Node 20+ (`node --version`)
- npm 10+
- git
- Docker Desktop (only needed if you want the local Supabase stack via `npm run db:start`)
- A modern Chromium-based browser for testing the PWA + Web Speech API

## 2. Install dependencies

```bash
npm install
```

## 3. Decide: local Supabase stack or hosted project?

**Hosted is simpler to start.** Local is better once you start writing migrations.

### Option A — Hosted (recommended for now)

1. In a browser, go to https://supabase.com/dashboard/project/bdqvpdobywqbyvjehyjs/settings/api
2. Copy the **anon public** key
3. Paste it into `projects/portal/src/environments/environment.development.ts` (and `projects/display/.../environment.development.ts`) as `supabaseAnonKey`

To push the initial schema to the hosted project:

```bash
# Generate a Personal Access Token at https://supabase.com/dashboard/account/tokens
# Set it as SUPABASE_ACCESS_TOKEN, or pass it when prompted by the next command.
npm run db:link
npm run db:push        # applies supabase/migrations/*.sql to the remote DB
npm run db:types       # regenerates projects/data-access/src/lib/database.types.ts
```

### Option B — Local stack

```bash
npm run db:start
```

The CLI will print a local API URL (usually `http://127.0.0.1:54321`) and an anon key. Paste those into the `environment.development.ts` files. Migrations under `supabase/migrations/` are applied automatically.

Reset with `npm run db:reset` whenever you want a clean DB.

## 4. Run the apps

```bash
npm run start:portal      # http://localhost:4200
npm run start:display     # http://localhost:4201
```

## 5. Verify the first connection

Open the portal, then in the browser console:

```js
// Should log a non-null session object once you sign in (we'll add UI for this in Phase 1).
```

We'll add a real auth flow + first feature ("hello family" + a grocery list) in the next session.

---

## Open items still to decide (from GAMEPLAN.md §11)

- [ ] Hosting: Cloudflare Pages vs Netlify
- [ ] Wake-word on the Pi vs Portal-only voice
- [ ] Google Calendar two-way sync — desired or skip?
- [ ] Pi hardware procurement (model + storage)
