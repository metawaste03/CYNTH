import { Router } from 'express';
import type { Response } from 'express';
import * as repo from './cmsConnections.repository.js';
import { listRecentPushHistory } from './cmsLinks.repository.js';
import { supportedConnectors } from './connectors/index.js';
import { validateCmsConnectionInput } from './cmsConnections.validation.js';
import { isCmsError } from './cms.errors.js';
import { listRemoteAuthors, testConnection } from './cmsPublish.service.js';

/**
 * CMS connection settings.
 *
 * Nothing here ever returns a credential — the repository DTO carries only
 * `hasCredential`, and no route reads the secret store. Article publishing
 * lives on the article routes (`/api/articles/:id/cms/...`), because a push
 * is an action on an article, not on a connection.
 */
export const cmsRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function respondToCmsError(res: Response, error: unknown, fallback: string): void {
  if (isCmsError(error)) {
    res.status(error.httpStatus).json({ errors: [error.message], code: error.code, retryable: error.retryable });
    return;
  }
  console.error(`${fallback}:`, error);
  res.status(502).json({ errors: [fallback] });
}

/** The CMS types Cynth can talk to, for the settings form. */
cmsRouter.get('/meta', (_req, res) => {
  res.json({ connectors: supportedConnectors() });
});

cmsRouter.get('/connections', (_req, res) => {
  res.json({ connections: repo.listConnections() });
});

cmsRouter.get('/connections/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid connection id.'] });

  const connection = repo.getConnectionById(id);
  if (!connection) return res.status(404).json({ errors: ['Connection not found.'] });

  res.json({ connection });
});

cmsRouter.post('/connections', (req, res) => {
  const { errors, value } = validateCmsConnectionInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  res.status(201).json({ connection: repo.createConnection(value!) });
});

cmsRouter.put('/connections/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid connection id.'] });

  const { errors, value } = validateCmsConnectionInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const connection = repo.updateConnection(id, value!);
  if (!connection) return res.status(404).json({ errors: ['Connection not found.'] });

  res.json({ connection });
});

cmsRouter.patch('/connections/:id/status', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid connection id.'] });
  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({ errors: ['isActive must be true or false.'] });
  }

  const connection = repo.setConnectionActiveStatus(id, req.body.isActive);
  if (!connection) return res.status(404).json({ errors: ['Connection not found.'] });

  res.json({ connection });
});

cmsRouter.patch('/connections/:id/default', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid connection id.'] });

  const connection = repo.setDefaultConnection(id);
  if (!connection) return res.status(404).json({ errors: ['Connection not found.'] });

  res.json({ connection });
});

/** The remote author posts are attributed to. Chosen from the site's real users — never guessed. */
cmsRouter.patch('/connections/:id/author-mapping', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid connection id.'] });

  const body = req.body ?? {};
  const remoteAuthorId =
    body.remoteAuthorId === null || body.remoteAuthorId === '' ? null : String(body.remoteAuthorId);
  const remoteAuthorName =
    body.remoteAuthorName === null || body.remoteAuthorName === undefined || body.remoteAuthorName === ''
      ? null
      : String(body.remoteAuthorName);

  const connection = repo.setConnectionAuthorMapping(id, remoteAuthorId, remoteAuthorName);
  if (!connection) return res.status(404).json({ errors: ['Connection not found.'] });

  res.json({ connection });
});

cmsRouter.delete('/connections/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid connection id.'] });

  const deleted = repo.deleteConnection(id);
  if (!deleted) return res.status(404).json({ errors: ['Connection not found.'] });

  res.status(204).send();
});

/**
 * TEST CONNECTION.
 *
 * Distinguishes a site that cannot be reached, a REST API that will not
 * answer, credentials that do not authenticate, and an account that cannot
 * post — because those are four different problems.
 *
 * Publishes nothing and creates nothing.
 */
cmsRouter.post('/connections/:id/test', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid connection id.'] });

  if (!repo.getConnectionById(id)) return res.status(404).json({ errors: ['Connection not found.'] });

  try {
    const result = await testConnection(id);
    // A failed test is a successful diagnosis, so it is a 200 carrying
    // ok: false rather than an HTTP error — the UI needs the stage and the
    // message either way.
    res.json(result);
  } catch (error) {
    respondToCmsError(res, error, 'Could not test the CMS connection.');
  }
});

/** The site's users, for the author mapping dropdown. A read; changes nothing. */
cmsRouter.get('/connections/:id/authors', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid connection id.'] });

  try {
    res.json({ authors: await listRemoteAuthors(id) });
  } catch (error) {
    respondToCmsError(res, error, 'Could not read the site’s user list.');
  }
});

/** Recent synchronisation activity across every article. Never contains a credential. */
cmsRouter.get('/history', (req, res) => {
  const limitParam = Number(req.query.limit);
  const limit = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;
  res.json({ entries: listRecentPushHistory(limit) });
});
