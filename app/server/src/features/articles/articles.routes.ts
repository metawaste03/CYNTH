import { Router } from 'express';
import type { Response } from 'express';
import * as repo from './articles.repository.js';
import { validateArticleDraftInput } from './articles.validation.js';
import type { ArticleDraftInput } from './articles.validation.js';
import { buildPrompt } from '../prompt-builder/promptBuilder.service.js';
import {
  generateArticle,
  getGenerationPreflight,
  DraftNotFoundError,
  DraftNotReadyError,
} from '../generation/generation.service.js';
import { isGenerationError } from '../generation/generation.errors.js';
import { listGenerationHistoryForArticle } from '../generation/generationHistory.repository.js';

export const articlesRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Referential-integrity checks shared by create and update. Existence only — not active status, so a draft stays valid even if its author/product is later deactivated. */
function checkReferences(value: ArticleDraftInput): string[] {
  const errors: string[] = [];
  if (!repo.articleTypeExists(value.articleTypeId)) errors.push('Invalid article type.');
  if (value.authorId !== null && !repo.authorExists(value.authorId)) errors.push('Invalid author.');
  if (value.productId !== null && !repo.productExists(value.productId)) errors.push('Invalid product.');
  return errors;
}

articlesRouter.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const article = repo.getArticleById(id);
  if (!article) return res.status(404).json({ errors: ['Draft not found.'] });

  res.json({ article });
});

articlesRouter.post('/', (req, res) => {
  const { errors, value } = validateArticleDraftInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const refErrors = checkReferences(value!);
  if (refErrors.length) return res.status(400).json({ errors: refErrors });

  const article = repo.createArticleDraft(value!);
  res.status(201).json({ article });
});

articlesRouter.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const { errors, value } = validateArticleDraftInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const refErrors = checkReferences(value!);
  if (refErrors.length) return res.status(400).json({ errors: refErrors });

  const article = repo.updateArticleDraft(id, value!);
  if (!article) return res.status(404).json({ errors: ['Draft not found.'] });

  res.json({ article });
});

/**
 * Assembles the Prompt Builder output for a draft. Returns 400 with clear
 * validation messages (and builds nothing) if required fields are missing —
 * per Milestone 7, this never calls an AI model, it only returns text.
 */
articlesRouter.get('/:id/prompt', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const result = buildPrompt(id);
  if ('errors' in result) {
    const status = result.errors[0] === 'Draft not found.' ? 404 : 400;
    return res.status(status).json({ errors: result.errors });
  }

  res.json(result);
});

/* --------------------------------------------------- AI generation (M9) --- */

/**
 * Turns anything the generation engine throws into a response the UI can act
 * on: a stable `code`, a plain-language message, and whether retrying the
 * same request is worth offering. Never carries provider internals or
 * anything secret — see generation/generation.errors.ts.
 */
function respondToGenerationError(res: Response, error: unknown): void {
  if (error instanceof DraftNotFoundError) {
    res.status(404).json({ errors: ['Draft not found.'], code: 'draft_not_found', retryable: false });
    return;
  }
  if (error instanceof DraftNotReadyError) {
    res.status(400).json({ errors: error.errors, code: 'draft_incomplete', retryable: false });
    return;
  }
  if (isGenerationError(error)) {
    res.status(error.httpStatus).json({ errors: [error.message], code: error.code, retryable: error.retryable });
    return;
  }

  // Anything unrecognised is logged for the operator but described
  // generically to the browser, so an unexpected internal message can never
  // become an accidental disclosure channel.
  console.error('Unexpected generation failure:', error);
  res.status(500).json({ errors: ['Generation failed unexpectedly. Please try again.'], code: 'provider_error', retryable: true });
}

/**
 * What the user is shown before generating: the routed provider and model,
 * the draft's article type / author / product, the prompt size, and anything
 * blocking. Reads local configuration only — sends nothing to any provider.
 */
articlesRouter.get('/:id/generation', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  try {
    const article = repo.getArticleById(id);
    if (!article) return res.status(404).json({ errors: ['Draft not found.'] });

    res.json({ preflight: getGenerationPreflight(id), generation: article.generated });
  } catch (error) {
    respondToGenerationError(res, error);
  }
});

/**
 * Runs one generation. The provider is never chosen by the caller — the
 * Model Router decides, from the configured default model for this task.
 * One attempt per request: retrying is the user's explicit decision.
 */
articlesRouter.post('/:id/generate', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  try {
    const outcome = await generateArticle(id);
    res.json({ generation: outcome.generation, usage: outcome.usage, historyId: outcome.historyId });
  } catch (error) {
    respondToGenerationError(res, error);
  }
});

/** The generation log for one draft — attempts, outcomes, and any token usage the provider reported. */
articlesRouter.get('/:id/generation-history', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const limitParam = Number(req.query.limit);
  const limit = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;

  res.json({ entries: listGenerationHistoryForArticle(id, limit) });
});
