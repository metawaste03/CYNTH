import { Router } from 'express';
import { isGenerationError } from '../generation/generation.errors.js';
import {
  discardCandidates,
  generateFeaturedImages,
  getFeaturedImageState,
  selectCandidate,
} from './featuredImage.service.js';
import { buildFeaturedImagePrompt } from './imagePrompt.service.js';

/**
 * The featured-image surface.
 *
 * GET  /:articleId              what exists: the attached image, what Cynth
 *                               already owns that fits, and any candidates
 *                               waiting to be chosen. Free, calls nothing.
 * GET  /:articleId/prompt       the prompt that WOULD be sent. Free, and worth
 *                               having: an editor can read what Cynth is about
 *                               to ask for before paying for the answer.
 * POST /:articleId/generate     draws candidates. Paid.
 * POST /:articleId/select       keeps one and discards the rest.
 * DELETE /:articleId/candidates discards them all.
 */
export const imagesRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

imagesRouter.get('/:articleId', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const state = getFeaturedImageState(articleId);
  if (!state) return res.status(404).json({ errors: ['Article not found.'] });
  res.json({ featuredImage: state });
});

imagesRouter.get('/:articleId/prompt', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const steer = typeof req.query.steer === 'string' ? req.query.steer : null;
  const brief = buildFeaturedImagePrompt(articleId, steer);
  if ('error' in brief) return res.status(400).json({ errors: [brief.error] });
  res.json({ brief });
});

imagesRouter.post('/:articleId/generate', async (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  try {
    const result = await generateFeaturedImages(articleId, {
      count: Number(req.body?.count) || undefined,
      steer: typeof req.body?.steer === 'string' ? req.body.steer : null,
      modelId: parseId(String(req.body?.modelId ?? '')) ?? null,
      // Never defaulted to true, exactly as every other paid path.
      confirmedCost: req.body?.confirmedCost === true,
    });
    res.json({ result, featuredImage: getFeaturedImageState(articleId) });
  } catch (error) {
    if (isGenerationError(error)) {
      return res
        .status(error.httpStatus ?? 400)
        .json({ errors: [error.message], code: error.code, retryable: error.retryable });
    }
    res.status(500).json({ errors: [error instanceof Error ? error.message : 'Image generation failed.'] });
  }
});

imagesRouter.post('/:articleId/select', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const candidateId = typeof req.body?.candidateId === 'string' ? req.body.candidateId : '';
  if (!candidateId) return res.status(400).json({ errors: ['candidateId is required.'] });

  const result = selectCandidate(articleId, candidateId, {
    title: typeof req.body?.title === 'string' ? req.body.title : undefined,
    altText: typeof req.body?.altText === 'string' ? req.body.altText : null,
  });

  if ('error' in result) return res.status(400).json({ errors: [result.error] });
  res.status(201).json({ ...result, featuredImage: getFeaturedImageState(articleId) });
});

imagesRouter.delete('/:articleId/candidates', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const removed = discardCandidates(articleId);
  res.json({ removed, featuredImage: getFeaturedImageState(articleId) });
});
