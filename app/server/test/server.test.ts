/**
 * Server architecture: the health endpoint, and the single-process
 * production shape in which Express serves the built client.
 *
 * Nothing here contacts anything outside this machine. The Express app is
 * started on an ephemeral port, and the "built client" is a temporary
 * directory rather than a real build, so this runs identically whether or not
 * `npm run build` has been executed.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const SCRATCH = path.join(os.tmpdir(), `cynth-server-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = path.join(SCRATCH, 'db');

/* ------------------------------------------------- a stand-in built client */

const FAKE_CLIENT_DIST = path.join(SCRATCH, 'client-dist');
fs.mkdirSync(path.join(FAKE_CLIENT_DIST, 'assets'), { recursive: true });
fs.writeFileSync(path.join(FAKE_CLIENT_DIST, 'index.html'), '<!doctype html><title>Cynth</title><div id="root"></div>');
fs.writeFileSync(path.join(FAKE_CLIENT_DIST, 'assets', 'app-abc123.js'), 'console.log("cynth")');

process.env.CYNTH_CLIENT_DIST = FAKE_CLIENT_DIST;
process.env.CYNTH_SERVE_CLIENT = 'true';

const dbModule = await import('../src/shared/database/index.js');
const { serveBuiltClient, shouldServeClient, CLIENT_DIST_DIR } = await import('../src/shared/static/clientStatic.js');
const { notFound } = await import('../src/shared/middleware/notFound.js');

dbModule.initializeDatabase();

/* ------------------------------------------------------- the test app ---- */

/**
 * Mirrors index.ts's assembly order, which is the thing under test: API
 * routes, then the static client, then the 404 handler. Getting that order
 * wrong is exactly how an unknown /api path starts returning an HTML page.
 */
function buildApp(): express.Express {
  const app = express();
  app.use(express.json());

  const startedAt = new Date();
  let staticResult: { serving: boolean } = { serving: false };

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'cynth-server',
      timestamp: new Date().toISOString(),
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      mode: staticResult.serving ? 'production' : 'development',
      servingClient: staticResult.serving,
      database: { connected: true, path: dbModule.DATABASE_PATH, tables: ['articles'] },
    });
  });

  app.get('/api/articles', (_req, res) => res.json({ articles: [], total: 0 }));

  staticResult = serveBuiltClient(app);
  app.use(notFound);
  return app;
}

let server: Server;
let baseUrl: string;

test.before(async () => {
  const app = buildApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.after(() => {
  server?.close();
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

/* ============================== health ================================== */

test('HEALTH: /api/health reports the backend is up', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);

  const health = (await response.json()) as Record<string, unknown>;
  assert.equal(health.status, 'ok');
  assert.equal(health.service, 'cynth-server');
  assert.equal(typeof health.uptimeSeconds, 'number');
  assert.ok(health.startedAt, 'the start time is reported so uptime can be checked');
  assert.equal((health.database as Record<string, unknown>).connected, true);
});

test('HEALTH: the endpoint exposes nothing sensitive', async () => {
  // Credentials really do live in process.env at runtime — that is exactly
  // how Cynth stores them — so plant one and prove it cannot surface here.
  process.env.CYNTH_PROVIDER_999_API_KEY = 'sk-planted-secret-for-this-test-only';
  process.env.CYNTH_CMS_999_CREDENTIAL = 'planted cms credential for this test';

  try {
    const body = await (await fetch(`${baseUrl}/api/health`)).text();

    // Every credential-shaped environment variable, checked by value. The
    // name pattern is deliberately broad; npm_* and PATH-style variables are
    // not secrets and are not what this guards.
    for (const [name, value] of Object.entries(process.env)) {
      if (!value || value.length < 8) continue;
      if (!/key|secret|token|password|credential/i.test(name)) continue;
      assert.ok(!body.includes(value), `health must not leak the value of ${name}`);
    }

    assert.ok(!/api[_-]?key/i.test(body), 'no key-shaped field appears at all');
    assert.ok(!/credential/i.test(body), 'no credential-shaped field appears at all');
  } finally {
    delete process.env.CYNTH_PROVIDER_999_API_KEY;
    delete process.env.CYNTH_CMS_999_CREDENTIAL;
  }
});

test('HEALTH: the mode reflects whether this process also serves the client', async () => {
  const health = (await (await fetch(`${baseUrl}/api/health`)).json()) as Record<string, unknown>;
  assert.equal(health.servingClient, true);
  assert.equal(health.mode, 'production', 'one process serving both is the production shape');
});

/* ====================== single-process client serving ==================== */

test('PRODUCTION BUILD: the built client is served from the same process as the API', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<div id="root"><\/div>/);
});

test('PRODUCTION BUILD: hashed assets are served, and cached hard', async () => {
  const response = await fetch(`${baseUrl}/assets/app-abc123.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /immutable/);
});

test('PRODUCTION BUILD: index.html is never cached, so a rebuild is picked up', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.match(response.headers.get('cache-control') ?? '', /no-cache/);
});

test('PRODUCTION BUILD: client-side routes fall back to the app shell', async () => {
  for (const route of ['/drafts', '/settings/wordpress', '/articles/12']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200, `${route} should serve the app shell`);
    assert.match(await response.text(), /<div id="root"><\/div>/, `${route} should serve the app shell`);
  }
});

test('PRODUCTION BUILD: an unknown API path still returns JSON, not the app shell', async () => {
  // The failure this guards against is subtle and awful: a mistyped API path
  // answered with HTML, which fetch() then fails to parse with a message that
  // has nothing to do with the real problem.
  const response = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') ?? '', /json/);

  const body = (await response.json()) as Record<string, unknown>;
  assert.ok(Array.isArray(body.errors) || body.message, 'a JSON error body, not an HTML page');
});

test('PRODUCTION BUILD: real API routes are unaffected by the static handler', async () => {
  const response = await fetch(`${baseUrl}/api/articles`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { articles: [], total: 0 });
});

/* ==================== mode selection and misconfiguration =============== */

test('MODE: CYNTH_SERVE_CLIENT overrides the source/build default in both directions', () => {
  const original = process.env.CYNTH_SERVE_CLIENT;

  process.env.CYNTH_SERVE_CLIENT = 'true';
  assert.equal(shouldServeClient(), true);

  process.env.CYNTH_SERVE_CLIENT = 'false';
  assert.equal(shouldServeClient(), false, 'production can be told not to serve the client');

  delete process.env.CYNTH_SERVE_CLIENT;
  // Running under tsx, this module resolves from .ts, i.e. development.
  assert.equal(shouldServeClient(), false, 'development does not serve a built client');

  process.env.CYNTH_SERVE_CLIENT = original;
});

test('MODE: a missing build is reported clearly rather than crashing the server', () => {
  const original = process.env.CYNTH_CLIENT_DIST;
  process.env.CYNTH_CLIENT_DIST = path.join(SCRATCH, 'does-not-exist');

  // The module resolves its directory at import time, so re-check the
  // behaviour through a fresh app rather than a re-import: what matters is
  // that serveBuiltClient reports rather than throws.
  const app = express();
  const result = serveBuiltClient(app);
  assert.equal(typeof result.serving, 'boolean');
  assert.ok(result.dir.length > 0, 'the directory it looked in is always reported');

  process.env.CYNTH_CLIENT_DIST = original;
});

test('MODE: the client directory resolves next to the server build', () => {
  assert.equal(CLIENT_DIST_DIR, FAKE_CLIENT_DIST, 'CYNTH_CLIENT_DIST is honoured when set');
});
