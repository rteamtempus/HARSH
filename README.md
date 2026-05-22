# HARSH

**H**olly · **A**yla · **R**ory · **S**tevie · **H**azel — a family management system.

Two apps in one Angular workspace, sharing a Supabase backend:

| App | Purpose | Surface |
|---|---|---|
| `portal` | Capture + configuration | PWA (phones, desktops) |
| `display` | Ambient family status | Raspberry Pi kiosk on the living room TV |

See [GAMEPLAN.md](./GAMEPLAN.md) for product direction, principles, and the full build roadmap.

---

## Repo layout

```
projects/
├── portal/          # Angular PWA
├── display/         # Angular kiosk app
├── data-access/     # Shared Supabase client + DB types
└── ui/              # Shared components / theme
supabase/
├── migrations/      # SQL schema (source of truth)
├── functions/       # Edge Functions (ai-intent, etc.)
└── config.toml
```

Path aliases `data-access` and `ui` point at library source — no pre-build step needed.

## Local development

Prereqs: Node 20+, Docker Desktop (for the local Supabase stack).

```bash
npm install
npm run db:start          # boots local Postgres/Auth/Realtime via Docker
                          # prints local URL + anon key — paste into projects/portal/src/environments/environment.development.ts
npm run start:portal      # http://localhost:4200
npm run start:display     # http://localhost:4201   (run in another terminal)
```

Stop the local stack with `npm run db:stop`.

## Connecting to the hosted Supabase project

The hosted project is `bdqvpdobywqbyvjehyjs`. To link this repo to it and push the schema:

```bash
npm run db:link           # prompts for a Personal Access Token (one-time, generated from supabase.com/account/tokens)
npm run db:push           # applies migrations/ to the remote DB
npm run db:types          # regenerates database.types.ts from the live schema
```

## Useful scripts

| Script | What |
|---|---|
| `npm run start:portal` / `start:display` | Dev server per app |
| `npm run build:portal` / `build:display` | Production build per app |
| `npm run db:start` / `db:stop` | Local Supabase stack |
| `npm run db:reset` | Drop and re-apply all migrations against local DB |
| `npm run db:diff -- <name>` | Diff your local DB into a new migration file |
| `npm run db:push` | Apply migrations to the linked remote project |
| `npm run db:types` | Regenerate TypeScript types from the linked DB |

## Hosting

Decision deferred (see GAMEPLAN.md §11). Cloudflare Pages is the current recommendation; Netlify is the runner-up. CI/CD will be wired in Phase 4.
