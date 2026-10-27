import { Router } from 'express';
import * as repo from './media.repository.js';
import { MEDIA_KINDS } from './media.repository.js';
import type { MediaKind, MediaRole } from './media.repository.js';
import { mediaImageUpload, relativeMediaPath, removeMediaFile } from './media.upload.js';
import { suggestMedia } from './mediaSuggest.service.js';

/**
 * The media library HTTP surface.
 *
 * Upload, describe, file under a thematic area, and attach to an article.
 * `/suggest` ranks candidates for a draft — it proposes and explains, and
 * attaching remains a separate, deliberate call.
 */
export const mediaRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readKind(raw: unknown): MediaKind | undefined {
  return typeof raw === 'string' && (MEDIA_KINDS as readonly string[]).includes(raw) ? (raw as MediaKind) : undefined;
}

function readThemeId(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

mediaRouter.get('/', (req, res) => {
  const { themeId, kind, search, status } = req.query;

  res.json({
    media: repo.listMedia({
      themeId: themeId === 'none' ? 'none' : typeof themeId === 'string' && themeId ? Number(themeId) : undefined,
      kind: readKind(kind),
      search: typeof search === 'string' && search ? search : undefined,
      activeOnly: status === 'active',
    }),
    kinds: MEDIA_KINDS,
  });
});

mediaRouter.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid image id.'] });

  const asset = repo.getMedia(id);
  if (!asset) return res.status(404).json({ errors: ['Image not found.'] });
  res.json({ media: asset });
});

/** Upload. The file arrives as multipart; the descriptive fields arrive alongside it. */
mediaRouter.post('/', (req, res) => {
  mediaImageUpload(req, res, (error) => {
    if (error) return res.status(400).json({ errors: [error.message] });
    if (!req.file) return res.status(400).json({ errors: ['No image file was supplied.'] });

    const body = req.body as Record<string, unknown>;
    const title =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim()
        : req.file.originalname.replace(/\.[^.]+$/, '');

    const themeId = readThemeId(body.themeId);

    const asset = repo.createMedia({
      filePath: relativeMediaPath(req.file.filename),
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      byteSize: req.file.size,
      title,
      description: typeof body.description === 'string' ? body.description : null,
      altText: typeof body.altText === 'string' ? body.altText : null,
      themeId: themeId === undefined ? null : themeId,
      kind: readKind(body.kind) ?? 'featured',
      tags: typeof body.tags === 'string' ? body.tags : null,
      credit: typeof body.credit === 'string' ? body.credit : null,
    });

    res.status(201).json({ media: asset });
  });
});

mediaRouter.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid image id.'] });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return res.status(400).json({ errors: ['Title is required.'] });

  const themeId = readThemeId(body.themeId);
  if (themeId === undefined && body.themeId !== undefined) {
    return res.status(400).json({ errors: ['themeId must be a thematic area id, or empty for none.'] });
  }

  const updated = repo.updateMedia(id, {
    title,
    description: typeof body.description === 'string' ? body.description : null,
    altText: typeof body.altText === 'string' ? body.altText : null,
    themeId: themeId ?? null,
    kind: readKind(body.kind) ?? 'featured',
    tags: typeof body.tags === 'string' ? body.tags : null,
    credit: typeof body.credit === 'string' ? body.credit : null,
    isActive: body.isActive === undefined ? true : body.isActive === true,
  });

  if (!updated) return res.status(404).json({ errors: ['Image not found.'] });
  res.json({ media: updated });
});

mediaRouter.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid image id.'] });

  const deleted = repo.deleteMedia(id);
  if (!deleted) return res.status(404).json({ errors: ['Image not found.'] });

  // The record is gone; remove the file it pointed at.
  removeMediaFile(deleted.url.replace(/^\//, ''));
  res.status(204).end();
});

/* ------------------------------------------------------- article linkage --- */

mediaRouter.get('/articles/:articleId/media', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });
  res.json({ media: repo.listArticleMedia(articleId) });
});

/**
 * Ranked candidates for a draft, with the reason each one scored.
 *
 * Read-only. Nothing is attached — the editor picks from these.
 */
mediaRouter.get('/articles/:articleId/suggest', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const role = req.query.role === 'inline' ? 'inline' : 'featured';
  const result = suggestMedia(articleId, { role });
  if (!result) return res.status(404).json({ errors: ['Draft not found.'] });

  res.json({ suggestion: result });
});

mediaRouter.post('/articles/:articleId/media', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const mediaId = parseId(String(req.body?.mediaId));
  if (mediaId === null) return res.status(400).json({ errors: ['mediaId is required.'] });

  const role: MediaRole = req.body?.role === 'inline' ? 'inline' : 'featured';
  const result = repo.attachMedia({
    articleId,
    mediaId,
    role,
    sectionKey: typeof req.body?.sectionKey === 'string' ? req.body.sectionKey : null,
    // 'suggested' when the editor accepted a Cynth proposal, so an accepted
    // suggestion stays distinguishable from an independent choice.
    origin: req.body?.origin === 'suggested' ? 'suggested' : 'manual',
  });

  if ('error' in result) return res.status(400).json({ errors: [result.error] });
  res.status(201).json({ attached: result });
});

mediaRouter.delete('/articles/:articleId/media/:mediaId', (req, res) => {
  const articleId = parseId(req.params.articleId);
  const mediaId = parseId(req.params.mediaId);
  if (articleId === null || mediaId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  if (!repo.detachMedia(articleId, mediaId)) {
    return res.status(404).json({ errors: ['That image is not attached to this draft.'] });
  }
  res.status(204).end();
});
