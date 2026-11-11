/**
 * The direct Search Console connection.
 *
 * What must hold:
 *   1. Only a real service account key is accepted, and the key never comes
 *      back out: the status carries the robot's address and nothing else.
 *   2. A sync signs a request Google would accept, asks for settled days, and
 *      files what comes back exactly as an export would.
 *   3. A search already recorded from an export is updated in place, not
 *      listed a second time, and an editor's filing survives.
 *   4. A refusal from Google is reported in words the owner can act on.
 *
 * GOOGLE IS NEVER CONTACTED. Every request goes to a stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-console-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const content = await import('../src/features/content/content.repository.js');
const demand = await import('../src/features/search-demand/searchDemand.service.js');
const gsc = await import('../src/features/search-demand/searchConsole.service.js');

dbModule.initializeDatabase();
const db = dbModule.getDatabase();
const project = content.getDefaultProject()!;
const sleep = content.createTheme(project.id, { name: 'Sleep & Recovery', description: 'Sleep.' });

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_FILE = JSON.stringify({
  type: 'service_account',
  client_email: 'cynth-reader@example-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
});

interface Seen {
  url: string;
  init: RequestInit;
}

function stubGoogle(options: { sites?: string[]; rows?: unknown[]; queryStatus?: number; queryBody?: unknown }) {
  const seen: Seen[] = [];
  const fetcher = (async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, init });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'stub-token', expires_in: 3600 });
    if (url.endsWith('/sites')) {
      return json({ siteEntry: (options.sites ?? []).map((siteUrl) => ({ siteUrl, permissionLevel: 'siteRestrictedUser' })) });
    }
    if (url.includes('/searchAnalytics/query')) {
      return json(options.queryBody ?? { rows: options.rows ?? [] }, options.queryStatus ?? 200);
    }
    return json({ error: { message: 'unexpected url' } }, 404);
  }) as typeof fetch;
  return { fetcher, seen };
}

test('KEY: a file that is not a service account key is refused in plain words', () => {
  assert.throws(() => gsc.parseServiceAccountKey('not json'), /not a Google key file/);
  assert.throws(() => gsc.parseServiceAccountKey(JSON.stringify({ type: 'authorized_user' })), /not a service account key/);
  assert.equal(gsc.getSearchConsoleStatus().connected, false);
});

test('KEY: saving a key exposes the robot address and never the key', () => {
  const status = gsc.saveServiceAccountKey(KEY_FILE);
  assert.equal(status.connected, true);
  assert.equal(status.clientEmail, 'cynth-reader@example-project.iam.gserviceaccount.com');
  assert.ok(!JSON.stringify(status).includes('PRIVATE KEY'));

  // In the secrets file, not the database.
  const settings = JSON.stringify(db.prepare('SELECT key, value FROM settings').all());
  assert.ok(!settings.includes('PRIVATE'));
  assert.ok(fs.readFileSync(process.env.CYNTH_SECRETS_FILE!, 'utf8').includes('CYNTH_GSC_SERVICE_ACCOUNT='));
});

test('SYNC: signs a valid request, asks for settled days, and files the searches', async () => {
  // One recorded from an export, filed by the editor; one whose best page changed.
  demand.importSearchQueries([{ query: 'best pillow for side sleepers', pageUrl: '', clicks: 1, impressions: 10, position: 30 }]);
  const exported = demand.listSearchQueries().find((row) => row.query === 'best pillow for side sleepers')!;
  demand.fileSearchQuery(exported.id, sleep.id);

  const { fetcher, seen } = stubGoogle({
    sites: ['sc-domain:example.test'],
    rows: [
      { keys: ['Best Pillow for Side Sleepers', 'https://example.test/pillows/'], clicks: 2, impressions: 60, position: 12 },
      { keys: ['best pillow for side sleepers', 'https://example.test/'], clicks: 1, impressions: 20, position: 20 },
      { keys: ['why do i wake up at 3am', 'https://example.test/'], clicks: 0, impressions: 5, position: 44 },
    ],
  });

  const result = await gsc.syncSearchConsole(fetcher, new Date('2026-11-10T12:00:00Z'));
  assert.equal(result.siteUrl, 'sc-domain:example.test');
  assert.equal(result.endDate, '2026-11-07');
  assert.equal(result.startDate, '2026-10-11');
  assert.equal(result.summary.rows, 2);

  // The token request carries an assertion Google could verify with the public key.
  const tokenCall = seen.find((call) => call.url.includes('/token'))!;
  const assertion = new URLSearchParams(String(tokenCall.init.body)).get('assertion')!;
  const [header, claims, signature] = assertion.split('.');
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url'));
  const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.equal(decoded.scope, 'https://www.googleapis.com/auth/webmasters.readonly');
  assert.equal(decoded.iss, 'cynth-reader@example-project.iam.gserviceaccount.com');

  const queryCall = seen.find((call) => call.url.includes('/searchAnalytics/query'))!;
  assert.ok(queryCall.url.includes(encodeURIComponent('sc-domain:example.test')));
  assert.deepEqual(JSON.parse(String(queryCall.init.body)).dimensions, ['query', 'page']);

  // One row per search: figures summed, best page kept, the editor's filing intact.
  const pillows = demand.listSearchQueries().filter((row) => row.query === 'best pillow for side sleepers');
  assert.equal(pillows.length, 1);
  assert.equal(pillows[0].id, exported.id);
  assert.equal(pillows[0].impressions, 80);
  assert.equal(pillows[0].clicks, 3);
  assert.equal(pillows[0].pageUrl, 'https://example.test/pillows/');
  assert.equal(pillows[0].position, 14);
  assert.equal(pillows[0].themeId, sleep.id);
  assert.equal(pillows[0].themeSource, 'manual');
  assert.equal(pillows[0].source, 'gsc_api');

  const status = gsc.getSearchConsoleStatus();
  assert.equal(status.lastSyncOk, true);
  assert.equal(status.siteUrl, 'sc-domain:example.test');
});

test('SYNC: running it again does not duplicate or add up', async () => {
  const { fetcher } = stubGoogle({
    rows: [{ keys: ['best pillow for side sleepers', 'https://example.test/pillows/'], clicks: 4, impressions: 90, position: 9 }],
  });
  const before = demand.listSearchQueries().length;
  await gsc.syncSearchConsole(fetcher);
  const rows = demand.listSearchQueries();
  assert.equal(rows.length, before);
  assert.equal(rows.find((row) => row.query === 'best pillow for side sleepers')!.impressions, 90);
});

test('SYNC: a refusal from Google says what to do, and is recorded', async () => {
  const { fetcher } = stubGoogle({ queryStatus: 403, queryBody: { error: { message: 'User does not have sufficient permission for site.' } } });
  await assert.rejects(gsc.syncSearchConsole(fetcher), /Users and permissions/);
  const status = gsc.getSearchConsoleStatus();
  assert.equal(status.lastSyncOk, false);
  assert.match(status.lastSyncMessage ?? '', /Users and permissions/);
});

test('SYNC: a key no property has been shared with is explained', async () => {
  gsc.setSearchConsoleSite('');
  const { fetcher } = stubGoogle({ sites: [] });
  await assert.rejects(gsc.syncSearchConsole(fetcher), /has not been added to any Search Console property/);
});

test('DISCONNECT: deletes the key and keeps the searches', () => {
  const before = demand.listSearchQueries().length;
  const status = gsc.disconnectSearchConsole();
  assert.equal(status.connected, false);
  assert.equal(status.clientEmail, null);
  assert.ok(!fs.readFileSync(process.env.CYNTH_SECRETS_FILE!, 'utf8').includes('CYNTH_GSC_SERVICE_ACCOUNT'));
  assert.equal(demand.listSearchQueries().length, before);
});
