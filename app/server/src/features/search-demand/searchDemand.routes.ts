import { Router } from 'express';
import { getDatabase } from '../../shared/database/index.js';
import {
  deleteSearchQuery,
  fileSearchQuery,
  importSearchQueries,
  listSearchQueries,
  parseSearchConsoleCsv,
} from './searchDemand.service.js';
import {
  SearchConsoleError,
  disconnectSearchConsole,
  getSearchConsoleStatus,
  listSearchConsoleSites,
  saveServiceAccountKey,
  setSearchConsoleSite,
  syncSearchConsole,
} from './searchConsole.service.js';

/**
 * SEARCH DEMAND — HTTP surface.
 *
 * Nothing here costs money or calls a model. An import reads text the editor
 * supplied and files each search under an area; the rest is reading and
 * re-filing.
 */
export const searchDemandRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Every recorded search, grouped by area, with the unfiled ones last. */
searchDemandRouter.get('/', (_req, res) => {
  const themes = getDatabase().prepare('SELECT id, name FROM themes ORDER BY position, id').all() as unknown as {
    id: number;
    name: string;
  }[];
  const queries = listSearchQueries();

  res.json({
    total: queries.length,
    lastImportedAt: queries.reduce<string | null>(
      (latest, row) => (latest === null || row.importedAt > latest ? row.importedAt : latest),
      null,
    ),
    themes: themes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      queries: queries.filter((row) => row.themeId === theme.id),
    })),
    unfiled: queries.filter((row) => row.themeId === null),
  });
});

/** Reads a Search Console export supplied as text. */
searchDemandRouter.post('/import', (req, res) => {
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv.trim()) {
    res.status(400).json({ errors: ['No file contents were supplied.'] });
    return;
  }

  const parsed = parseSearchConsoleCsv(csv);
  if ('error' in parsed) {
    res.status(400).json({ errors: [parsed.error] });
    return;
  }

  const summary = importSearchQueries(parsed.rows, {
    period: typeof req.body?.period === 'string' ? req.body.period : null,
    skipped: parsed.skipped,
  });
  res.json({ summary });
});

/* ------------------------------------------------- direct Search Console */

function sendConsoleError(res: import('express').Response, error: unknown): void {
  const message = error instanceof SearchConsoleError ? error.message : 'Search Console could not be read.';
  res.status(error instanceof SearchConsoleError ? 400 : 500).json({ errors: [message] });
}

/** Whether a key is stored, and the robot's address. Never the key. */
searchDemandRouter.get('/console', (_req, res) => {
  res.json({ status: getSearchConsoleStatus() });
});

/** Stores the Google key file the owner chose, then says which properties it can read. */
searchDemandRouter.put('/console/key', async (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key : '';
  if (!key.trim()) {
    res.status(400).json({ errors: ['No key file was supplied.'] });
    return;
  }
  try {
    saveServiceAccountKey(key);
    let sites: string[] = [];
    let warning: string | null = null;
    try {
      sites = await listSearchConsoleSites();
      if (sites.length === 1) setSearchConsoleSite(sites[0]);
    } catch (error) {
      warning = error instanceof SearchConsoleError ? error.message : null;
    }
    res.json({ status: getSearchConsoleStatus(), sites, warning });
  } catch (error) {
    sendConsoleError(res, error);
  }
});

searchDemandRouter.get('/console/sites', async (_req, res) => {
  try {
    res.json({ sites: await listSearchConsoleSites() });
  } catch (error) {
    sendConsoleError(res, error);
  }
});

searchDemandRouter.put('/console/site', (req, res) => {
  const siteUrl = typeof req.body?.siteUrl === 'string' ? req.body.siteUrl.trim() : '';
  if (!siteUrl || siteUrl.length > 300) {
    res.status(400).json({ errors: ['Choose a property.'] });
    return;
  }
  res.json({ status: setSearchConsoleSite(siteUrl) });
});

searchDemandRouter.delete('/console', (_req, res) => {
  res.json({ status: disconnectSearchConsole() });
});

/** Reads the last 28 days from Google now. */
searchDemandRouter.post('/console/sync', async (_req, res) => {
  try {
    const result = await syncSearchConsole();
    res.json({ ...result, status: getSearchConsoleStatus() });
  } catch (error) {
    sendConsoleError(res, error);
  }
});

/** Files a search under an area. `themeId: null` takes it out of every area. */
searchDemandRouter.patch('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ errors: ['Invalid id.'] });
    return;
  }

  const raw = req.body?.themeId;
  const themeId = raw === null ? null : parseId(String(raw));
  if (raw !== null && !themeId) {
    res.status(400).json({ errors: ['Choose an area, or none.'] });
    return;
  }
  if (themeId && !getDatabase().prepare('SELECT id FROM themes WHERE id = ?').get(themeId)) {
    res.status(404).json({ errors: ['That area does not exist.'] });
    return;
  }

  const updated = fileSearchQuery(id, themeId);
  if (!updated) {
    res.status(404).json({ errors: ['Search not found.'] });
    return;
  }
  res.json({ query: updated });
});

searchDemandRouter.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id || !deleteSearchQuery(id)) {
    res.status(404).json({ errors: ['Search not found.'] });
    return;
  }
  res.status(204).end();
});
