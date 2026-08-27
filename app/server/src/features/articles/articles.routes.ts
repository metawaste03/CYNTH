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
import { isValidArticleStatus, ARTICLE_STATUSES } from './articles.constants.js';
import { getProjectById, getThemeById, getTopicById, listThemesForAuthor } from '../content/content.repository.js';
import { getPushPreflight, isValidPushMode, pushArticle, refreshLink } from '../cms/cmsPublish.service.js';
import { listPushHistoryForArticle } from '../cms/cmsLinks.repository.js';
import { isCmsError } from '../cms/cms.errors.js';

export const articlesRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Referential-integrity checks shared by create and update.
 *
 * Existence checks are deliberately not active-status checks, so a draft stays
 * valid even if its author or product is later deactivated.
 *
 * The content-configuration checks below are the authoritative ones: the
 * wizard filters its dropdowns, but the frontend is never the only
 * enforcement — a hand-made request cannot attach a topic to the wrong
 * thematic area.
 */
function checkReferences(value: ArticleDraftInput): string[] {
  const errors: string[] = [];
  if (!repo.articleTypeExists(value.articleTypeId)) errors.push('Invalid article type.');
  if (value.authorId !== null && !repo.authorExists(value.authorId)) errors.push('Invalid author.');
  if (value.productId !== null && !repo.productExists(value.productId)) errors.push('Invalid product.');

  const project = value.projectId !== null ? getProjectById(value.projectId) : null;
  if (value.projectId !== null && !project) errors.push('Invalid project.');

  const theme = value.themeId !== null ? getThemeById(value.themeId) : null;
  if (value.themeId !== null && !theme) errors.push('Invalid thematic area.');

  // A thematic area belongs to exactly one project.
  if (theme && project && theme.projectId !== project.id) {
    errors.push('That thematic area belongs to a different project.');
  }

  const topic = value.topicId !== null ? getTopicById(value.topicId) : null;
  if (value.topicId !== null && !topic) errors.push('Invalid topic.');

  // A topic belongs to exactly one thematic area — this is the check the
  // dependent dropdowns are a convenience for, not a substitute for.
  if (topic) {
    if (!theme) errors.push('A topic cannot be set without its thematic area.');
    else if (topic.themeId !== theme.id) errors.push('That topic belongs to a different thematic area.');
  }

  // Author/theme is enforced only once an author has been assigned to
  // thematic areas at all. An author with no assignments is treated as
  // available everywhere, so configuring theme coverage stays optional
  // rather than becoming a precondition for writing anything.
  if (value.authorId !== null && theme) {
    const authorThemes = listThemesForAuthor(value.authorId);
    if (authorThemes.length > 0 && !authorThemes.some((t) => t.id === theme.id)) {
      errors.push('That author is not assigned to the selected thematic area.');
    }
  }

  return errors;
}


/* ------------------------------------------------ Article listing (M9.1) --- */

/**
 * Real Article records for the Dashboard and the Drafts list.
 *
 * Reads the `articles` table — the content entity. Deliberately NOT
 * generation_history, which records generation attempts and would both
 * duplicate and misrepresent articles (many attempts, one article; and an
 * article that was never generated would be invisible).
 *
 * GET /api/articles?status=draft&limit=5
 */
articlesRouter.get('/', (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
  if (status !== undefined && !isValidArticleStatus(status)) {
    return res.status(400).json({ errors: [`status must be one of: ${ARTICLE_STATUSES.join(', ')}.`] });
  }

  const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const limit = Number.isInteger(rawLimit) && rawLimit! > 0 ? rawLimit : undefined;

  const articles = repo.listArticles({ status, limit });
  res.json({ articles, total: articles.length });
});

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
 * The only way an article changes lifecycle state. Generation never calls
 * this: publication is a deliberate human act (docs/00_PROJECT_VISION.md).
 */
articlesRouter.patch('/:id/status', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const status = (req.body ?? {}).status;
  if (!isValidArticleStatus(status)) {
    return res.status(400).json({ errors: [`status must be one of: ${ARTICLE_STATUSES.join(', ')}.`] });
  }

  const article = repo.setArticleStatus(id, status);
  if (!article) return res.status(404).json({ errors: ['Article not found.'] });

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

  // An optional model the user is considering. Preflight then previews that
  // model's provider, pricing and spend decision instead of the configured
  // default — the same answer the generate call would reach.
  const rawModelId = Number(req.query.modelId);
  const modelId = Number.isInteger(rawModelId) && rawModelId > 0 ? rawModelId : null;

  try {
    const article = repo.getArticleById(id);
    if (!article) return res.status(404).json({ errors: ['Draft not found.'] });

    res.json({ preflight: getGenerationPreflight(id, undefined, modelId), generation: article.generated });
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
    // Cost confirmation is only ever taken from an explicit request field.
    // It is never defaulted, inferred, or remembered between requests.
    const body = req.body ?? {};
    const confirmedCost = body.confirmedCost === true;

    // The model the user chose, if they chose one. It names a registry entry,
    // never a provider or an endpoint — the Model Router still resolves it,
    // and a model that cannot run produces an error rather than a substitute.
    const rawModelId = Number(body.modelId);
    const modelId = Number.isInteger(rawModelId) && rawModelId > 0 ? rawModelId : null;
    if (body.modelId !== undefined && body.modelId !== null && modelId === null) {
      return res.status(400).json({ errors: ['modelId must be a positive whole number.'] });
    }

    const outcome = await generateArticle(id, undefined, { confirmedCost, modelId });
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

/* ------------------------------------------- WordPress / CMS push (M13) --- */

/**
 * Turns anything the CMS layer throws into a response the UI can act on: a
 * stable `code`, a plain-language message, and whether retrying is worth
 * offering. Never carries a credential — see cms/cms.errors.ts.
 */
function respondToCmsError(res: Response, error: unknown): void {
  if (isCmsError(error)) {
    res.status(error.httpStatus).json({ errors: [error.message], code: error.code, retryable: error.retryable });
    return;
  }

  console.error('Unexpected CMS failure:', error);
  res.status(500).json({ errors: ['The CMS operation failed unexpectedly. Please try again.'], code: 'cms_error', retryable: true });
}

/**
 * What pressing Push will do, before it does it: which site, which post,
 * whether this creates a new draft or updates the existing one, and exactly
 * what will be sent.
 *
 * Reads local state only — opening an article never touches the CMS.
 */
articlesRouter.get('/:id/cms/preflight', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const rawConnectionId = Number(req.query.connectionId);
  const connectionId = Number.isInteger(rawConnectionId) && rawConnectionId > 0 ? rawConnectionId : null;

  try {
    res.json({ preflight: getPushPreflight(id, connectionId) });
  } catch (error) {
    respondToCmsError(res, error);
  }
});

/**
 * Sends the article to the CMS as a DRAFT.
 *
 * `mode` is required and is never inferred: the UI has already told the user
 * whether this creates a new post or updates an existing one, and the server
 * refuses the request if that no longer matches reality. Nothing here can
 * publish — the connector contract has no publish operation.
 */
articlesRouter.post('/:id/cms/push', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const body = req.body ?? {};
  if (!isValidPushMode(body.mode)) {
    return res.status(400).json({
      errors: ['mode must be either "create" (a new CMS draft) or "update" (an existing one).'],
    });
  }

  const rawConnectionId = Number(body.connectionId);
  const connectionId = Number.isInteger(rawConnectionId) && rawConnectionId > 0 ? rawConnectionId : null;

  try {
    const result = await pushArticle(id, connectionId, body.mode);
    res.json(result);
  } catch (error) {
    respondToCmsError(res, error);
  }
});

/** Re-reads the remote post so Cynth reflects a status a human changed in the CMS. A read; writes nothing there. */
articlesRouter.post('/:id/cms/refresh', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const rawConnectionId = Number((req.body ?? {}).connectionId);
  if (!Number.isInteger(rawConnectionId) || rawConnectionId <= 0) {
    return res.status(400).json({ errors: ['connectionId is required.'] });
  }

  try {
    const link = await refreshLink(id, rawConnectionId);
    if (!link) return res.status(404).json({ errors: ['This article has not been pushed to that connection.'] });
    res.json({ link });
  } catch (error) {
    respondToCmsError(res, error);
  }
});

/** The synchronisation log for one article — pushes, updates, refreshes, and any failures. */
articlesRouter.get('/:id/cms/history', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const limitParam = Number(req.query.limit);
  const limit = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;

  res.json({ entries: listPushHistoryForArticle(id, limit) });
});
