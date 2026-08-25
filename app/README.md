# Cynth — Application Foundation (Milestone 1)

This is the application shell only: no database, no AI integrations, no API keys, no WordPress integration, no authentication, no business logic. See [../docs/13_MILESTONES.md](../docs/13_MILESTONES.md) and [../docs/03_SYSTEM_ARCHITECTURE.md](../docs/03_SYSTEM_ARCHITECTURE.md).

## Structure

```
app/
├── client/   React + TypeScript (Vite) — the editorial workspace UI
└── server/   Node.js + Express (TypeScript) — backend foundation
```

Both are feature-based (`features/` + `shared/`) and run as two independent local processes. They are not wired together yet — there's no business logic yet for a REST call to carry.

## Running locally

Each app is installed and run separately.

**Client** (http://localhost:5173):
```bash
cd client
npm install
npm run dev
```

**Server** (http://localhost:4000):
```bash
cd server
npm install
npm run dev
```

Health check once the server is running: `GET http://localhost:4000/api/health`.

## Other commands

| | Client | Server |
|---|---|---|
| Type-check + production build | `npm run build` | `npm run build` |
| Run built output | `npm run preview` | `npm start` (after `npm run build`) |
