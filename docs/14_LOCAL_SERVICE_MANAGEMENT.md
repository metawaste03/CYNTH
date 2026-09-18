# 14 — Local Service Management

**Status: Implemented (Milestone 13).** The recommendation below was carried out as written — Step 0 (collapse to one Express-served process), then Option A (a Windows scheduled task with crash recovery). Option B was not built. Option C (Tauri) remains deliberately deferred.

**Decision (2026-08-27):** The Product Owner agreed with the direction below. Implementation followed in Milestone 13.

## What was built

| Concern | Implementation |
|---|---|
| One process, not two | `shared/static/clientStatic.ts` serves `app/client/dist` from the same Express process as the API |
| Production build | `npm run build` at the project root builds the client then the server; `npm start` runs the single process |
| Automatic start after boot | `scripts/install-startup-task.ps1` registers a Windows scheduled task (logon trigger by default, `-AtStartup` for a pre-login trigger) |
| Restart after crash | The same task, with a second trigger that retries every minute and `MultipleInstances = IgnoreNew` |
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
| Restart after crash | **Done** — a second, repeating trigger on the same task. See the correction below. |
| Survive power loss | **Done** — follows from the trigger; SQLite is already crash-safe per transaction |
| Port conflicts | Done: `CYNTH_SERVER_PORT`, default 4100, read by both client and server |
| Graceful shutdown | Done: `index.ts` handles SIGINT/SIGTERM and closes the database |
| Orphaned Node processes | **Done** — Step 0 shipped; `node dist/index.js` has no watch child |
| Server health visible in the UI | **Done** — a persistent indicator in the app shell, polling `/api/health`. Per-request unreachability is still reported clearly too |
| No elevated privileges at runtime | **Done** — the task runs at `RunLevel Limited` as the current user. Only the optional `-AtStartup` trigger needs one elevated registration |

## Explicitly out of scope

Start / Stop / Restart controls inside the web UI remain unbuilt, and should stay that way until a desktop wrapper (Option C) exists to back them. A browser page cannot execute `npm start`, and a button that cannot actually start anything is worse than no button. The health indicator reports the state and names the command; it does not pretend to control the process.

Option C (Tauri) is still the better long-term fit and is still deferred — it is a milestone of its own, with a new build pipeline, code signing and an updater.


## Correction (2026-08-30): how crash recovery actually works

Milestone 13 recorded crash recovery as delivered by the task's `RestartCount`
and `RestartInterval` settings. **That was wrong, and it was wrong in the worst
way — the settings register successfully and read as though they work.**

Task Scheduler applies `RestartCount` when the task *engine* reports a failure,
not when a long-running process the task launched is terminated. Tested on
2026-08-30 by killing the Node process: the task returned `LastTaskResult
0xFFFFFFFF`, went to `Ready`, and Cynth stayed down indefinitely. Anyone
relying on the Milestone 13 record would have believed they had recovery they
did not have, and would only have discovered it during a real crash.

What actually provides recovery is a **second trigger**: a one-off trigger
starting at registration time, repeating every minute with an indefinite
duration, combined with `MultipleInstances = IgnoreNew`. Every minute Windows
attempts to start the task; the attempt is discarded while an instance is
already running, and the first attempt after the process dies brings it back.

Two things that look correct but are not, both found by testing:

- **The repetition cannot hang off the logon trigger.** A trigger's repetition
  window opens only when that trigger fires, so a repetition attached to the
  logon trigger stays dormant until the *next* logon — doing nothing on the day
  it is installed, and nothing after a mid-session crash. It has to be its own
  trigger.
- **`RepetitionDuration` cannot be `[TimeSpan]::MaxValue`.** It serialises to
  `P99999999DT23H59M59S`, which Task Scheduler rejects. An empty duration is
  how the XML expresses "indefinitely". This mattered more than it sounds:
  `Register-ScheduledTask` reported the rejection as a *non-terminating* error,
  so the script printed "Registered" in green **after** it had already
  unregistered the previous task — leaving nothing scheduled while claiming
  success. The script now verifies the task exists before reporting success.

Verified end to end: with Cynth stopped, the watchdog started it unaided in
51 seconds; a subsequent kill was recovered in 40 seconds; both recovered
instances served the UI in production mode.

`RestartCount` / `RestartInterval` are retained, because they do cover the
separate case of the task failing to start at all — but they are no longer
described as the recovery mechanism.

## Correction (2026-09-02): the flashing-terminal failure mode

**Symptom.** A terminal window pops open and closes again, roughly once a
minute, indefinitely.

**Cause.** The per-minute recovery trigger described above fires, the task
tries to start Cynth, the port is already held by *something that is not the
task*, node exits with `EADDRINUSE`, and the cycle repeats sixty seconds later.
Each attempt flashed a console window because the task was registered without
`-Hidden`.

The usual "something that is not the task" is a **manually started server** —
`node app/server/dist/index.js` run by hand, or from an editor, while the
scheduled task is also installed. `MultipleInstances: IgnoreNew` does not help:
it prevents a second *task* instance, and knows nothing about a process started
outside Task Scheduler.

**Fixes applied.**

1. `install-startup-task.ps1` now registers the task with `-Hidden`, so a
   recovery attempt is never visible. The window was pure noise — this task has
   nothing to show anyone.
2. The existing task was updated in place, so it did not need reinstalling.

**The operational rule this implies.** When the scheduled task is installed, it
owns the port. To pick up a new build, restart *the task* — do not start a
second server by hand:

```powershell
Stop-ScheduledTask  -TaskName 'CYNTH Server'
Start-ScheduledTask -TaskName 'CYNTH Server'
```

Starting one manually is what produces the flashing, and the flashing is the
only outward sign that two things are competing for the port.

**How to tell it is healthy.** `Get-ScheduledTaskInfo -TaskName 'CYNTH Server'`
reporting `LastTaskResult` `2147946720` (`0x800710E0`) is **correct**, not an
error: it is Task Scheduler refusing a duplicate start because Cynth is already
running. `1` is the failure that produces the loop.
