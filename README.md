# AI-Native Conversational Dashboard Builder

Upload a CSV/XLSX, build charts by hand on a drag-and-drop grid canvas, or
describe what you want in plain language and let the AI assistant do it —
both paths go through the exact same validated command pipeline, so nothing
the AI does is any less safe or reversible than a manual edit. Full undo/redo,
a themeable UI, and PNG/CSV export round out this MVP-complete slice.

## Monorepo layout

```
frontend/          React 18 + Vite + Tailwind — the dashboard canvas, chat UI, theme system
backend/           Express 4 + Prisma + SQLite — ingestion, command validation/execution, AI layer
packages/types/    Shared TypeScript types (Theme, Command*, AI*, Api*) — single source of truth
e2e/               Playwright end-to-end tests, driven against a real browser
```

## Prerequisites

- Node.js >= 20
- A Chrome/Chromium install if you'll run the E2E suite (see [Testing](#testing))

## Dev setup

```bash
npm install

# Shared types must be compiled before the backend can resolve @ai-vis/types
# at runtime (the frontend consumes it straight from source via a Vite alias,
# but the backend imports it as a real package) — re-run this after editing
# anything in packages/types/src.
npm run build -w @ai-vis/types

# Backend: copy the example env and fill in what you need (defaults work
# out of the box with no AI API key — see "Environment variables" below)
cp backend/.env.example backend/.env

# Create the SQLite database from the Prisma schema
npm run prisma:push -w backend   # or: cd backend && npx prisma db push

npm run dev
```

`npm run dev` runs the backend (`:4000`) and frontend (`:5173`) concurrently.
The Vite dev server proxies `/api/*` to the backend (see
`frontend/vite.config.ts`), so just open **http://localhost:5173**.

Run them individually with `npm run dev:backend` / `npm run dev:frontend` if
you want separate terminals/logs.

## Testing

**Backend unit/integration tests** (schema/semantic/scope validation, undo/redo,
the AI layer, acceptance scenarios — 150+ tests, no browser needed):

```bash
npm test -w backend
```

**End-to-end tests** (Playwright, against a real browser): upload → manual
chart creation → AI chat command → undo → theme change → export, run against
both a desktop and a mobile viewport.

```bash
npm install --workspace=e2e   # first time only
cd e2e && npx playwright test
```

The suite reuses backend/frontend dev servers if they're already running
(`playwright.config.ts`'s `webServer` blocks set `reuseExistingServer: true`),
or starts them itself otherwise. It drives the system-installed Chrome via an
explicit `executablePath` rather than a Playwright-managed browser download —
set `PLAYWRIGHT_CHROME_PATH` if Chrome isn't at the default Windows install
path, or delete that override in the config on a machine where
`npx playwright install` can actually reach the network.

## Building for production

```bash
npm run build
# equivalent to:
#   npm run build -w @ai-vis/types   (tsc)
#   npm run build -w backend         (prisma generate && tsc -> backend/dist)
#   npm run build -w frontend        (tsc && vite build -> frontend/dist)
```

Then:

- **Backend**: set `NODE_ENV=production` and run `node backend/dist/server.js`
  (or `npm run start -w backend`). Point `DATABASE_URL` at a real database file
  (or, beyond local scale, Postgres — see [Known limitations](#known-limitations)).
  With `NODE_ENV=production`, error responses never include a stack trace or
  internal validation detail — only a `code` and a human-readable `message`
  (see `backend/src/middleware/error-handler.ts`).
- **Frontend**: serve `frontend/dist` as static files. The app calls
  `VITE_API_URL` (or `/api` if unset) for every request — either:
  - reverse-proxy `/api/*` on the same origin the static files are served
    from to the backend (mirroring what the Vite dev server does), **or**
  - set `VITE_API_URL` to the backend's full URL at *build* time (Vite inlines
    it, so this must be set before `vite build`, not after).

## Environment variables

All backend configuration lives in `backend/.env` (see `backend/.env.example`
for the full annotated list). The frontend needs at most one.

| Variable | Where | Required? | Notes |
|---|---|---|---|
| `PORT` | backend | no (default `4000`) | |
| `NODE_ENV` | backend | no | Set to `production` in prod — gates verbose error detail (see above). |
| `DATABASE_URL` | backend | yes | Prisma connection string, e.g. `file:./dev.db`. |
| `CORS_ORIGIN` | backend | no (default `http://localhost:5173`) | |
| `AI_PROVIDER` | backend | no (default `mock`) | `mock` needs no API key and is fully deterministic — what dev/tests use out of the box. Set `anthropic` to use a real model. |
| `ANTHROPIC_API_KEY` | backend | only if `AI_PROVIDER=anthropic` | Never sent to the frontend; read once at process start. |
| `ANTHROPIC_MODEL` | backend | no (default `claude-opus-5`) | |
| `AUTH_ENABLED` | backend | no (default `false`) | Off by default — every request is attributed to a fixed dev user. See below. |
| `API_AUTH_TOKEN` | backend | only if `AUTH_ENABLED=true` | A single shared bearer token (see [Known limitations](#known-limitations)). |
| `MAX_CONCURRENT_UPLOADS` | backend | no (default `3`) | Caps simultaneous dataset parses (CPU/memory-bound work). |
| `MAX_DATASET_ROWS` | backend | no (default `200000`) | Hard cap on rows kept in memory per dataset, CSV or Excel alike. |
| `MAX_XLSX_DECOMPRESSED_BYTES` | backend | no (default `200MB`) | Zip-bomb guard — checked against a `.xlsx`'s ZIP central directory *before* it's decompressed. |
| `VITE_API_URL` | frontend | no (default `/api`) | Only needed if the frontend isn't served from behind a proxy to the backend (see production build notes above). |

### Turning on auth

Auth is a stub by default so local dev needs no setup: every request is
attributed to a fixed dev user, no token required. Before this API is
reachable from anywhere other than your own machine:

```
AUTH_ENABLED=true
API_AUTH_TOKEN=<a long random secret>
```

Every request then needs `Authorization: Bearer <API_AUTH_TOKEN>` or is
rejected with 401 before any route handler runs; misconfiguring this (enabled
with no token set) fails closed with a 500 rather than silently falling back
to the dev user. This is intentionally simple — a single shared token, not
per-user sessions/OAuth — see the docstring in
`backend/src/middleware/auth.ts` for the upgrade path once there's more than
one real user to distinguish.

## Known limitations

- **SQLite is dev/local scale.** It's the right choice for this MVP (zero
  setup, one file, fast for a single operator's dataset sizes) but it is
  **not** meant for concurrent multi-tenant production traffic — SQLite
  serializes writes at the file level, so many simultaneous users editing
  dashboards will contend with each other. **Migration path to Postgres:**
  swap the Prisma `datasource` provider from `sqlite` to `postgresql` in
  `backend/prisma/schema.prisma`, point `DATABASE_URL` at a real Postgres
  instance, regenerate a migration history with `prisma migrate dev` (this
  project has been using `prisma db push` for its single `dev.db`, so there is
  no existing migration history to carry over — start one fresh against
  Postgres), and run `prisma generate`. No application code depends on
  SQLite-specific behavior; every query goes through Prisma's query builder.
- **In-memory rate limiting, upload concurrency limiting, and the dashboard
  state cache** (see `backend/src/middleware/rateLimit.ts`,
  `backend/src/data/upload.ts`, `DashboardEngine`'s cache) all live in a
  single process's memory. Fine for one backend instance; a horizontally
  scaled deployment needs a shared store (e.g. Redis) for these instead.
- **Single shared auth token**, not per-user accounts — see "Turning on auth"
  above. Adequate for one operator; not a multi-tenant identity system.
- **Export formats**: PNG (screenshot of the current view) and CSV (raw
  dataset re-download) only, by design for this milestone. PDF export and
  shareable public links are explicitly out of scope until this slice is
  confirmed working end-to-end.
- **AI provider**: ships with a deterministic `mock` provider so the app and
  its tests need no API key. A real model (`AI_PROVIDER=anthropic`) needs its
  own field-hallucination guard tuning verified against your actual dataset
  vocabulary before production use — the guard rejects anything not in the
  dataset schema, but a model with a different behavior profile than the mock
  may need its prompt/context tuned differently.
