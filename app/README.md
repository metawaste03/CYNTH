# Cynth — Application

The Cynth editorial engine: a local-first, single-user tool for drafting articles for EveryFiveDays with a human editor as the final authority. Current state reflects Milestones 0–13 — see [../docs/13_MILESTONES.md](../docs/13_MILESTONES.md) and [../docs/CHANGELOG.md](../docs/CHANGELOG.md).

## Structure

```
app/
├── client/   React + TypeScript (Vite) — the editorial workspace UI
└── server/   Node.js + Express (TypeScript) — REST API, SQLite, AI generation
```

Both are feature-based (`features/` + `shared/`).

**In production Cynth is one process:** Express serves both the API and the built client from `app/client/dist`. **In development it is two:** the Vite dev server proxies `/api` and `/uploads` to the Express server, so the browser sees same-origin requests and no CORS configuration is needed. The server decides which mode it is in from its own file extension — `.ts` under `tsx watch`, `.js` from `dist` — so nothing has to be configured to get the right behaviour.

## What exists

**Backend** — SQLite persistence (Node's built-in `node:sqlite`, no third-party driver) with idempotent schema creation and additive migrations on every startup. Full CRUD for authors (with writing samples), products (with local image upload and storage), and article drafts. Read-only article types and dashboard summary endpoints. AI provider configuration, live model discovery from a provider's own catalogue, and a provider-independent model registry. A Model Router that resolves either a task purpose or an explicitly chosen model. A Prompt Builder that assembles a complete prompt from a draft. An AI generation engine with provider adapters for OpenRouter, Anthropic, and OpenAI. A CMS connector layer with a WordPress implementation that creates and updates **drafts only**.

**Frontend** — Dashboard with live counts, Authors and Products management, an eight-step New Article wizard (Article Type → Author → Topic → Title → Keywords → Product → Content Brief → Editorial Review) with draft persistence at every step, a prompt preview page, a Generate Article panel with a model picker showing each model's price, a Discover Models browser over the provider's live catalogue, WordPress connection settings, a push-to-WordPress panel on the article view, and a backend health indicator in the app shell.

**Not built yet** — SEO Review and Quality Gate exist as navigation entries with placeholder pages only. There is no article editor, no web-intelligence crawler, no backlink engine, no Novamira integration, no affiliate-link placement, and no authentication (single-user by design). **Nothing in the application can publish**: a generated article stays a draft until a human approves it, and the CMS connector contract has no publish operation at all — Cynth creates WordPress drafts, and a human publishes them in WordPress.

## Running Cynth

### Production — one process

From the project root:

```bash
npm run install:all
```

```bash
npm run build
```

```bash
npm start
```

Then open `http://localhost:4100`. One process serves the UI and the API — no Vite dev server, no proxy, and no watch child that can orphan itself and hold the port.

To have Cynth start with Windows and restart after a crash, register the scheduled task once from the project root:

```powershell
.\scripts\install-startup-task.ps1 -Build
```

`.\scripts\status.ps1` reports whether it is running (checking both the task state and `/api/health`, because those can disagree); `.\scripts\uninstall-startup-task.ps1` removes it. See [../docs/14_LOCAL_SERVICE_MANAGEMENT.md](../docs/14_LOCAL_SERVICE_MANAGEMENT.md).

### Development — two processes

Install once per app, then run both processes.

**Server** (http://localhost:4100):

```bash
cd app/server && npm install && npm run dev
```

**Client** (http://localhost:5173):

```bash
cd app/client && npm install && npm run dev
```

Open the client, not the server. Health check: `GET http://localhost:4100/api/health` — the UI also shows backend status in its top bar on every screen, so a stopped server is never mistaken for a rejected request.

### Tests

From the project root:

```bash
npm test
```

95 tests across four suites (`pipeline`, `models`, `wordpress`, `server`), all against local mocks. No test contacts a real AI provider or a real WordPress site, no test spends money, and no test publishes anything.

### A note on ports

The server listens on **4100**, deliberately not 4000: Local (the WordPress development environment used for EveryFiveDays) occupies 4000, and Cynth is expected to run alongside it. Both can be running at the same time.

The Vite dev server reads the same `CYNTH_SERVER_PORT` setting the Express server uses, so changing the port in one place keeps the proxy pointed at the backend. On startup Vite prints the target it resolved:

```
[cynth] Vite dev server proxying /api and /uploads -> http://localhost:4100
```

## Environment variables

Server configuration lives in `app/server/.env.local`, which is gitignored and must never be committed. Copy [`server/.env.example`](server/.env.example) to `.env.local` to start. Every variable is optional — the defaults below work with no configuration at all.

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `CYNTH_SERVER_PORT` | `4100` | server + Vite proxy | Port the Express server listens on. The single setting both sides read, so they cannot drift apart. |
| `CYNTH_SERVER_URL` | `http://localhost:<port>` | Vite proxy | Overrides the proxy target outright, for a backend that isn't on localhost. |
| `CYNTH_CLIENT_PORT` | `5173` | Vite | Port the Vite dev server listens on. |
| `CYNTH_DB_DIR` | `<repo>/database` | server | Directory holding `cynth.db` and `uploads/`. Intended for tests, which point it at a throwaway directory. |
| `PORT` | — | server | Honoured as a fallback when `CYNTH_SERVER_PORT` is unset, so a generic host or process manager can place the server. |
| `CYNTH_PROVIDER_<id>_API_KEY` | — | server | An AI provider's API key. See below. |

### API keys

Provider API keys are **never stored in SQLite**. The database records only the *name* of the environment variable holding a key (`ai_providers.api_key_env_var`); the value lives in `app/server/.env.local` and is loaded into `process.env` at startup.

You do not normally write these by hand. Saving a key in **Settings → AI Providers** makes the server write it to `.env.local` itself, following the convention `CYNTH_PROVIDER_<provider id>_API_KEY`. A real environment variable of the same name takes precedence over the file, so a key can also be supplied by the shell without touching disk.

No key value is ever returned by an API response, written to the database, or logged. Provider error text is redacted before it is stored or displayed, because some providers echo a partially-masked key back in their own error messages.

## Other commands

| | Client | Server |
|---|---|---|
| Type-check + production build | `npm run build` | `npm run build` |
| Type-check only | `npx tsc -b` | `npx tsc -p tsconfig.json --noEmit` |
| Lint | `npm run lint` | — |
| Run built output | `npm run preview` | `npm start` (after `npm run build`) |

There is no automated test suite in the repository.
