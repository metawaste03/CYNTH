import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Express } from 'express';

/**
 * PRODUCTION SERVER ARCHITECTURE (Milestone 13).
 *
 * Cynth's operational shape is one process:
 *
 *   Windows
 *      -> CYNTH Node process
 *           |- API          (/api/*)
 *           '- Built client (everything else)
 *
 * Vite is a development server. In production the client is built once to
 * static files and served by the same Express process that serves the API,
 * which removes the whole class of problems the two-process setup created:
 * no proxy, so no client/server port drift; one thing to start, monitor and
 * restart; and `node dist/index.js` has no watch child, so no orphaned Node
 * process can hold the port after a kill (docs/14_LOCAL_SERVICE_MANAGEMENT.md).
 *
 * Development is untouched: `npm run dev` still runs Vite against the API,
 * and this module deliberately does nothing in that mode.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Whether this process is running from TypeScript source.
 *
 * Development runs `tsx watch src/index.ts`; production runs
 * `node dist/index.js`. The file extension of this very module is therefore a
 * reliable, dependency-free signal for which mode we are in — no cross-platform
 * env-var-setting shim required just to answer one boolean.
 */
const RUNNING_FROM_SOURCE = fileURLToPath(import.meta.url).endsWith('.ts');

/**
 * Where `npm run build` in app/client puts its output.
 *
 * From source:  app/server/src/shared/static -> app/client/dist
 * From build:   app/server/dist/shared/static -> app/client/dist
 *
 * Both are four levels up, because dist mirrors src's layout.
 */
export const CLIENT_DIST_DIR = process.env.CYNTH_CLIENT_DIST
  ? path.resolve(process.env.CYNTH_CLIENT_DIST)
  : path.resolve(__dirname, '..', '..', '..', '..', 'client', 'dist');

const INDEX_HTML = path.join(CLIENT_DIST_DIR, 'index.html');

/**
 * Whether the server should serve the built client.
 *
 * Defaults to "yes in production, no in development", overridable either way
 * with CYNTH_SERVE_CLIENT so a built client can be exercised from source, or
 * suppressed in production while debugging.
 */
export function shouldServeClient(): boolean {
  const configured = process.env.CYNTH_SERVE_CLIENT;
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return !RUNNING_FROM_SOURCE;
}

export interface ClientStaticResult {
  /** True when the built client is actually being served by this process. */
  serving: boolean;
  dir: string;
  /** Why it is not being served, when it is not. Null when it is. */
  reason: string | null;
}

/**
 * Mounts the built client, if there is one and this mode wants it.
 *
 * Must be called AFTER every /api route is registered, so an unknown /api path
 * still reaches the 404 handler as JSON rather than being answered with the
 * SPA's index.html.
 */
export function serveBuiltClient(app: Express): ClientStaticResult {
  if (!shouldServeClient()) {
    return {
      serving: false,
      dir: CLIENT_DIST_DIR,
      reason: RUNNING_FROM_SOURCE
        ? 'Development mode — the Vite dev server serves the client.'
        : 'Disabled by CYNTH_SERVE_CLIENT=false.',
    };
  }

  if (!fs.existsSync(INDEX_HTML)) {
    // Deliberately not fatal: the API is still fully usable, and saying
    // exactly what is missing beats crashing with a stack trace.
    return {
      serving: false,
      dir: CLIENT_DIST_DIR,
      reason: `No built client found at ${CLIENT_DIST_DIR}. Run "npm run build" in app/client (or "npm run build" at the project root) first.`,
    };
  }

  // Hashed asset filenames can be cached hard; index.html must not be, or a
  // rebuilt client would keep serving the previous app shell.
  app.use(
    express.static(CLIENT_DIST_DIR, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('cache-control', 'no-cache');
        else if (/\/assets\//.test(filePath.replace(/\\/g, '/'))) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  /**
   * SPA fallback: any GET that is not an API call and not a real file is a
   * client-side route, so it gets the app shell and React Router takes over.
   *
   * /api and /uploads are excluded explicitly — a mistyped API path must
   * return a JSON 404, not an HTML page that a fetch() would then fail to
   * parse with a baffling error.
   */
  app.get(/^(?!\/api\/|\/uploads\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    // Set here as well as in express.static: this path uses sendFile, which
    // applies its own default (max-age=0) and would otherwise not carry the
    // no-cache the app shell needs to be re-fetched after a rebuild.
    res.setHeader('cache-control', 'no-cache');
    res.sendFile(INDEX_HTML);
  });

  return { serving: true, dir: CLIENT_DIST_DIR, reason: null };
}
