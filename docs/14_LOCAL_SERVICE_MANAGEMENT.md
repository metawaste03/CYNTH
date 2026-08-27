# 14 — Local Service Management

**Status: Implemented (Milestone 13).** The recommendation below was carried out as written — Step 0 (collapse to one Express-served process), then Option A (a Windows scheduled task with crash recovery). Option B was not built. Option C (Tauri) remains deliberately deferred.

**Decision (2026-08-27):** The Product Owner agreed with the direction below. Implementation followed in Milestone 13.

## What was built

| Concern | Implementation |
|---|---|
| One process, not two | `shared/static/clientStatic.ts` serves `app/client/dist` from the same Express process as the API |
| Production build | `npm run build` at the project root builds the client then the server; `npm start` runs the single process |
| Automatic start after boot | `scripts/install-startup-task.ps1` registers a Windows scheduled task (logon trigger by default, `-AtStartup` for a pre-login trigger) |
| Restart after crash | The same task, with `RestartCount 3` / `RestartInterval 1 minute` |
| Survive power loss | Follows from the boot/logon trigger; SQLite is already crash-safe per transaction |
| Remove the task | `scripts/uninstall-startup-task.ps1` |
| Is it actually up? | `scripts/status.ps1` checks the task state *and* `/api/health`, because those can disagree |
| Health visible in the UI | A persistent indicator in the app shell — see the revised decision below |

Development is unchanged: `npm run dev` in `app/server` and `app/client` still runs the two-process Vite setup. The server decides which mode it is in from its own file extension (`.ts` under `tsx watch`, `.js` from `dist`), overridable with `CYNTH_SERVE_CLIENT`, so no cross-platform env-var shim was needed.

## Revised decision: the health indicator was built after all

This document previously deferred a persistent health indicator, reasoning that once Express serves the client, "the server is down" means the page does not load at all, so no indicator of ours could run.

That reasoning was incomplete, and the indicator was built in Milestone 13. It covers the case the original argument missed: **a page that is already open when the backend dies.** The SPA stays in memory, keeps rendering, and every subsequent request fails — which is precisely the situation that previously read as *the AI rejected your request*. The indicator polls `/api/health` every 20 seconds and on window focus, shows **Backend Running** or **Backend Unavailable**, and when unavailable says which command starts it.

It remains a status report, not a control surface. There is still no Start/Stop button, because a browser page cannot execute `npm start` and a button that cannot start anything is worse than no button.

## The problem

Cynth runs as two local processes started by hand:

```
app/server   npm run dev    ->  Express on :4100
app/client   npm run dev    ->  Vite on :5173, proxying /api to :4100
```

Both die when the terminal (or the automated session that launched them) exits. When the backend is gone but the browser tab is still open, every API call fails. Before the error-handling fix in this task, the UI collapsed that into "Request failed.", which read as *the AI rejected your request* rather than *the server is not running* — and cost real debugging time chasing a generation bug that did not exist.

Two further defects observed in practice:

- **Orphaned Node processes.** `tsx watch` spawns a child process. Killing the parent left the child holding port 4100; it then silently re-bound the port after a file change. A later start failed with a port conflict caused by Cynth's own ghost.
- **Port collision with Local.** The original default of 4000 is occupied by Local, the WordPress environment used for EveryFiveDays. Fixed in this task by moving the default to 4100 and making it configurable through `CYNTH_SERVER_PORT`, which the Vite proxy reads from the same place.

## Step 0 — collapse two processes into one (do this first)

This is the highest-value change and it is not a service-management problem at all.

Vite is a **development** server. For normal use, `npm run build` in `app/client` emits static files to `app/client/dist`, which Express can serve directly with `express.static`. Cynth then runs as **one process on one port**:

- no proxy, so no client/server port drift
- one thing to start, monitor, and restart
- `node dist/index.js` instead of `tsx watch`, so **no child process and no orphan**
- the browser is pointed at a single origin

Everything below becomes materially simpler once this is done, and some of it stops being necessary. Development keeps using the current two-process setup; only the "just run Cynth" path changes.

## Assessment of the three options

### Option A — Windows startup / service management

Run the single built process under Windows itself, either as a scheduled task triggered *At startup* or as a genuine Windows Service (via `node-windows` or NSSM).

- **Fits Cynth well.** Single-user, local-first, always-on-this-machine (`docs/02_VERSION1_SCOPE.md`). A service that is simply always running removes the need for a Start button.
- Survives reboot after power loss, which is a stated concern.
- A true service also gives automatic restart on crash for free (Windows' own recovery settings), plus start-before-login.
- **Cost:** one dependency or one external tool; service install needs elevation once.
- **Limitation:** no in-app control. Acceptable, because a service that never stops does not need controls.

### Option B — Local helper process exposing a control API

A supervisor process manages the backend and offers start/stop/restart over a local endpoint.

- **Recommended against.** It does not solve the problem, it relocates it: something must now start and supervise *the supervisor*, and that something is Option A again. It adds a second always-on process, a second port, and a new local control surface that must be secured against any page in the browser reaching it.
- Only justified if in-app start/stop is a hard requirement *and* a desktop wrapper is rejected.

### Option C — Desktop wrapper (Tauri or Electron)

Package Cynth as a desktop application that owns its backend as a child process.

- **The best long-term fit, and a real fit** — Cynth is already a single-user local application with a React UI. A wrapper gives genuine Start / Stop / Restart controls, a tray icon, correct lifecycle (backend dies with the app, so no orphans), and a normal "install and open it" experience.
- Tauri is the better of the two here: far smaller than Electron, and the backend stays a Node sidecar. Electron would ship a second Chromium.
- **Cost is the objection, not the fit:** new build/packaging pipeline, code signing, an updater, and for Tauri a Rust toolchain. That is a milestone of its own, and `docs/04_DEVELOPMENT_RULES.md` warns against unnecessary dependencies.

## Recommendation

**Step 0 (collapse to one process), then Option A. Revisit Option C when Cynth is ready to be a product rather than a workbench.** Do not build Option B.

Rationale: the goal is *Cynth is running when I want to use it*. A service that starts with Windows and restarts on crash achieves that completely, with the least new machinery. Start/Stop/Restart buttons are a solution to a problem that only exists while the service is not reliable.

### What the UI does (revised — see the top of this document)

A browser page cannot execute `npm run dev`, and it should not be able to.

**This section's original conclusion — that a persistent health indicator should be deferred — was overturned in Milestone 13.** The argument was that after Step 0, "the server is down" means *the page does not load at all*, so no indicator of ours could run. That holds for a cold start, but not for the more common failure: a page already open when the backend dies. The SPA keeps rendering and every request fails, which is exactly the state that used to read as *the AI rejected your request*. The indicator was built, and it earns its place.

The condition is already reported where it actually matters. A 502 or unreachable backend now produces *"The Cynth server did not respond… check that the backend is running"*, and every Dashboard card reads **Unavailable** rather than falsely showing `0`. That covers the real failure — a confusing message — without adding a permanent polling loop for a state the user is already told about.

Revisit this if the two-process setup outlives its expected life.

## Requirements checklist for whoever implements this

| Concern | How it is addressed |
|---|---|
| Automatic start after Windows boot | **Done** — `scripts/install-startup-task.ps1` (logon trigger by default; `-AtStartup` for pre-login, which needs one elevated run to register) |
| Restart after crash | **Done** — the task's `RestartCount` / `RestartInterval` settings |
| Survive power loss | **Done** — follows from the trigger; SQLite is already crash-safe per transaction |
| Port conflicts | Done: `CYNTH_SERVER_PORT`, default 4100, read by both client and server |
| Graceful shutdown | Done: `index.ts` handles SIGINT/SIGTERM and closes the database |
| Orphaned Node processes | **Done** — Step 0 shipped; `node dist/index.js` has no watch child |
| Server health visible in the UI | **Done** — a persistent indicator in the app shell, polling `/api/health`. Per-request unreachability is still reported clearly too |
| No elevated privileges at runtime | **Done** — the task runs at `RunLevel Limited` as the current user. Only the optional `-AtStartup` trigger needs one elevated registration |

## Explicitly out of scope

Start / Stop / Restart controls inside the web UI remain unbuilt, and should stay that way until a desktop wrapper (Option C) exists to back them. A browser page cannot execute `npm start`, and a button that cannot actually start anything is worse than no button. The health indicator reports the state and names the command; it does not pretend to control the process.

Option C (Tauri) is still the better long-term fit and is still deferred — it is a milestone of its own, with a new build pipeline, code signing and an updater.
