import crypto from 'node:crypto';
import { getDatabase } from '../../shared/database/index.js';
import { deleteSecret, getSecret, hasSecret, setSecret } from '../../shared/secrets/secretStore.js';
import { getSetting, setSetting } from '../../shared/settings/settings.repository.js';
import { importSearchQueries } from './searchDemand.service.js';
import type { ImportSummary, ParsedSearchRow } from './searchDemand.service.js';

/**
 * A DIRECT LINE TO GOOGLE SEARCH CONSOLE.
 *
 * The export upload works, and it depends on somebody remembering to do it.
 * This reads the same figures from Google itself, once a day, so topic
 * research is never working from a month-old file.
 *
 * HOW CYNTH SIGNS IN. With a Google "service account": a robot identity the
 * site owner creates in Google Cloud and then adds as a read-only user of the
 * Search Console property. Its key is a JSON file. That is the one sign-in
 * Google offers that needs no browser window, no consent screen that expires,
 * and no access to the owner's own Google account. Cynth can read search
 * figures with it and nothing else.
 *
 * WHERE THE KEY LIVES. In the secrets file, beside every other credential
 * (see secretStore.ts), never in the database. The only thing a route may say
 * about it is the robot's email address, which is not secret and which the
 * owner needs in order to grant it access.
 *
 * READ-ONLY, AND FREE. The scope requested is `webmasters.readonly`. Nothing
 * here calls a model or costs money.
 */

const KEY_ENV_VAR = 'CYNTH_GSC_SERVICE_ACCOUNT';
const SETTING_SITE = 'searchConsole.siteUrl';
const SETTING_EMAIL = 'searchConsole.clientEmail';
const SETTING_LAST_SYNC = 'searchConsole.lastSyncAt';
const SETTING_LAST_MESSAGE = 'searchConsole.lastSyncMessage';
const SETTING_LAST_OK = 'searchConsole.lastSyncOk';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_ROOT = 'https://www.googleapis.com/webmasters/v3';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const REQUEST_TIMEOUT_MS = 30_000;

/** Search Console's figures settle two to three days behind today. */
const DATA_LAG_DAYS = 3;
const WINDOW_DAYS = 28;
const ROW_LIMIT = 5000;
export const SYNC_PERIOD_LABEL = 'Last 28 days';
export const SYNC_SOURCE = 'gsc_api';

export class SearchConsoleError extends Error {}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface SearchConsoleStatus {
  connected: boolean;
  /** The robot's address. The owner adds this as a user in Search Console. */
  clientEmail: string | null;
  /** The property figures are read from, e.g. `sc-domain:everyfivedays.com`. */
  siteUrl: string | null;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncMessage: string | null;
}

/** Injectable so tests never reach Google. */
type Fetch = typeof fetch;

/* ------------------------------------------------------------------- key */

/** Reads a pasted or uploaded key file. Says what is wrong in the owner's terms. */
export function parseServiceAccountKey(text: string): ServiceAccountKey {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SearchConsoleError('That file is not a Google key file. Choose the .json file Google downloaded.');
  }
  if (parsed?.type !== 'service_account') {
    throw new SearchConsoleError(
      'That is a Google file, but not a service account key. In Google Cloud, create a key of type JSON for a service account.',
    );
  }
  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string' || !parsed.private_key.includes('PRIVATE KEY')) {
    throw new SearchConsoleError('The key file is missing its email address or private key. Download a fresh one.');
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

function storedKey(): ServiceAccountKey | null {
  const raw = getSecret(KEY_ENV_VAR);
  if (!raw) return null;
  try {
    return parseServiceAccountKey(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function getSearchConsoleStatus(): SearchConsoleStatus {
  const connected = hasSecret(KEY_ENV_VAR);
  const lastOk = getSetting(SETTING_LAST_OK);
  return {
    connected,
    clientEmail: connected ? getSetting(SETTING_EMAIL) : null,
    siteUrl: getSetting(SETTING_SITE) || null,
    lastSyncAt: getSetting(SETTING_LAST_SYNC) || null,
    lastSyncOk: lastOk === null || lastOk === '' ? null : lastOk === '1',
    lastSyncMessage: getSetting(SETTING_LAST_MESSAGE) || null,
  };
}

/** Stores the key. Base64, because the secrets file holds one line per value. */
export function saveServiceAccountKey(text: string): SearchConsoleStatus {
  const key = parseServiceAccountKey(text);
  setSecret(KEY_ENV_VAR, Buffer.from(JSON.stringify({ type: 'service_account', ...key }), 'utf8').toString('base64'));
  setSetting(SETTING_EMAIL, key.client_email);
  setSetting(SETTING_LAST_OK, '');
  setSetting(SETTING_LAST_MESSAGE, '');
  return getSearchConsoleStatus();
}

export function disconnectSearchConsole(): SearchConsoleStatus {
  deleteSecret(KEY_ENV_VAR);
  for (const key of [SETTING_EMAIL, SETTING_SITE, SETTING_LAST_OK, SETTING_LAST_MESSAGE]) setSetting(key, '');
  return getSearchConsoleStatus();
}

export function setSearchConsoleSite(siteUrl: string): SearchConsoleStatus {
  setSetting(SETTING_SITE, siteUrl.trim());
  return getSearchConsoleStatus();
}

/* ---------------------------------------------------------------- Google */

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

async function call(fetcher: Fetch, url: string, init: RequestInit): Promise<any> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new SearchConsoleError('Google could not be reached. Check the internet connection and try again.');
  }
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = String(body?.error_description ?? body?.error?.message ?? body?.error ?? '').slice(0, 300);
    if (response.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(detail)) {
      throw new SearchConsoleError(
        'The Search Console API is switched off for the Google Cloud project this key belongs to. ' +
          'In Google Cloud, open APIs and Services, find "Google Search Console API" and choose Enable.',
      );
    }
    if (response.status === 403) {
      throw new SearchConsoleError(
        'Google refused access to that property. In Search Console, open Settings, then Users and permissions, ' +
          "and add the robot's email address as a user.",
      );
    }
    if (response.status === 400 && /invalid_grant/i.test(JSON.stringify(body ?? ''))) {
      throw new SearchConsoleError('Google rejected the key. It may have been deleted in Google Cloud. Upload a fresh one.');
    }
    throw new SearchConsoleError(`Google answered with an error (${response.status})${detail ? `: ${detail}` : '.'}`);
  }
  return body;
}

async function accessToken(key: ServiceAccountKey, fetcher: Fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) +
    '.' +
    base64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 600 }));

  let signature: string;
  try {
    signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  } catch {
    throw new SearchConsoleError('The private key in the key file could not be used. Download a fresh key file.');
  }

  const body = await call(fetcher, TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }).toString(),
  });
  if (typeof body?.access_token !== 'string') throw new SearchConsoleError('Google did not issue an access token.');
  return body.access_token;
}

/** The properties the robot has been given access to. */
export async function listSearchConsoleSites(fetcher: Fetch = fetch): Promise<string[]> {
  const key = storedKey();
  if (!key) throw new SearchConsoleError('No Google key file has been added yet.');
  const token = await accessToken(key, fetcher);
  const body = await call(fetcher, `${API_ROOT}/sites`, { headers: { authorization: `Bearer ${token}` } });
  const entries = Array.isArray(body?.siteEntry) ? body.siteEntry : [];
  return entries
    .filter((entry: any) => entry?.permissionLevel !== 'siteUnverifiedUser')
    .map((entry: any) => String(entry.siteUrl));
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * One row per search, however many pages Google showed for it.
 *
 * Google answers with a row per search AND page. Topic research wants the
 * search once, with the page that earned most of its impressions, because
 * that page is how the search is matched to an article.
 */
export function collapseByQuery(rows: { keys?: string[]; clicks?: number; impressions?: number; position?: number }[]): ParsedSearchRow[] {
  const byQuery = new Map<string, { clicks: number; impressions: number; weighted: number; topPage: string; topImpressions: number }>();
  for (const row of rows) {
    const query = String(row.keys?.[0] ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!query) continue;
    const page = String(row.keys?.[1] ?? '');
    const impressions = Number(row.impressions) || 0;
    const entry = byQuery.get(query) ?? { clicks: 0, impressions: 0, weighted: 0, topPage: '', topImpressions: -1 };
    entry.clicks += Number(row.clicks) || 0;
    entry.impressions += impressions;
    entry.weighted += (Number(row.position) || 0) * impressions;
    if (impressions > entry.topImpressions) {
      entry.topImpressions = impressions;
      entry.topPage = page;
    }
    byQuery.set(query, entry);
  }
  return [...byQuery.entries()].map(([query, entry]) => ({
    query,
    pageUrl: entry.topPage,
    clicks: entry.clicks,
    impressions: entry.impressions,
    position: entry.impressions > 0 ? Math.round((entry.weighted / entry.impressions) * 10) / 10 : null,
  }));
}

/**
 * Moves each search onto the row the import will write to.
 *
 * A search is stored once per page. One that arrived from an export has no
 * page; one whose best page changed has last month's. Without this, the same
 * search would be listed twice with two sets of figures. An editor's filing
 * travels with the row.
 */
function alignExistingRows(rows: ParsedSearchRow[]): void {
  const db = getDatabase();
  const others = db.prepare('SELECT id, theme_source FROM search_queries WHERE query = ? AND page_url <> ? ORDER BY (theme_source = \'manual\') DESC, id');
  const exact = db.prepare('SELECT id FROM search_queries WHERE query = ? AND page_url = ?');
  const move = db.prepare('UPDATE search_queries SET page_url = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM search_queries WHERE id = ?');

  for (const row of rows) {
    const stale = others.all(row.query, row.pageUrl) as unknown as { id: number; theme_source: string | null }[];
    if (!stale.length) continue;
    let hasExact = Boolean(exact.get(row.query, row.pageUrl));
    for (const old of stale) {
      if (!hasExact) {
        move.run(row.pageUrl, old.id);
        hasExact = true;
      } else if (old.theme_source !== 'manual') {
        remove.run(old.id);
      }
    }
  }
}

export interface SearchConsoleSyncResult {
  summary: ImportSummary;
  siteUrl: string;
  startDate: string;
  endDate: string;
}

/** Reads the last 28 settled days from Google and files every search. */
export async function syncSearchConsole(fetcher: Fetch = fetch, today: Date = new Date()): Promise<SearchConsoleSyncResult> {
  const key = storedKey();
  if (!key) throw new SearchConsoleError('No Google key file has been added yet.');

  try {
    const token = await accessToken(key, fetcher);

    let siteUrl = getSetting(SETTING_SITE) || '';
    if (!siteUrl) {
      const sites = await listSearchConsoleSites(fetcher);
      if (sites.length === 1) {
        siteUrl = sites[0];
        setSetting(SETTING_SITE, siteUrl);
      } else if (!sites.length) {
        throw new SearchConsoleError(
          `Google accepted the key, but the robot has not been added to any Search Console property. ` +
            `In Search Console, open Settings, then Users and permissions, and add ${key.client_email} as a user.`,
        );
      } else {
        throw new SearchConsoleError('The robot can see more than one property. Choose which one to read.');
      }
    }

    const end = new Date(today.getTime() - DATA_LAG_DAYS * 86_400_000);
    const start = new Date(end.getTime() - (WINDOW_DAYS - 1) * 86_400_000);
    const body = await call(fetcher, `${API_ROOT}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        startDate: isoDay(start),
        endDate: isoDay(end),
        dimensions: ['query', 'page'],
        rowLimit: ROW_LIMIT,
      }),
    });

    const rows = collapseByQuery(Array.isArray(body?.rows) ? body.rows : []);
    alignExistingRows(rows);
    const summary = importSearchQueries(rows, { period: SYNC_PERIOD_LABEL, source: SYNC_SOURCE });

    setSetting(SETTING_LAST_SYNC, new Date().toISOString());
    setSetting(SETTING_LAST_OK, '1');
    setSetting(
      SETTING_LAST_MESSAGE,
      rows.length
        ? `Read ${rows.length} searches for ${isoDay(start)} to ${isoDay(end)}.`
        : `Google reported no searches for ${isoDay(start)} to ${isoDay(end)}.`,
    );
    return { summary, siteUrl, startDate: isoDay(start), endDate: isoDay(end) };
  } catch (error) {
    const message = error instanceof SearchConsoleError ? error.message : 'The sync failed unexpectedly.';
    setSetting(SETTING_LAST_SYNC, new Date().toISOString());
    setSetting(SETTING_LAST_OK, '0');
    setSetting(SETTING_LAST_MESSAGE, message);
    if (error instanceof SearchConsoleError) throw error;
    throw new SearchConsoleError(message);
  }
}

/**
 * Keeps the figures current without anyone pressing anything: shortly after
 * start when the last sync is more than a day old, then daily. Does nothing
 * until a key has been added. The timers are unref'd so they never hold the
 * process open.
 */
export function startSearchConsoleSync(intervalMs = 24 * 60 * 60 * 1000, firstRunMs = 60_000): () => void {
  const tick = () => {
    if (!hasSecret(KEY_ENV_VAR)) return;
    const last = Date.parse(getSetting(SETTING_LAST_SYNC) || '');
    if (Number.isFinite(last) && Date.now() - last < intervalMs - 60_000) return;
    syncSearchConsole()
      .then((result) => console.log(`Search Console sync: ${result.summary.rows} searches read.`))
      .catch((error) => console.error('Search Console sync failed:', error instanceof Error ? error.message : error));
  };
  const first = setTimeout(tick, firstRunMs);
  const every = setInterval(tick, 60 * 60 * 1000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
