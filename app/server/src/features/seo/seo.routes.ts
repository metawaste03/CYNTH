import { Router } from 'express';
import type { Response } from 'express';
import * as repo from './seo.repository.js';
import {
  ArticleNotFoundError,
  getSeoOverview,
  runSeoAnalysis,
} from './seoAnalysis.service.js';
import { getGateCriteria, saveGateCriteria } from './seoGate.service.js';
import { getSeoStatusForArticle, SEO_STATUS_META } from './seoStatus.service.js';
import { validateGateCriteria, validateSeoConfiguration, validateSeoMetadata } from './seo.validation.js';
import { isGenerationError } from '../generation/generation.errors.js';
import { getArticleById } from '../articles/articles.repository.js';
import { coverageByTheme, listCoverage } from '../articles/coverage.service.js';
import { findInboundLinkOpportunities, toInboundLinkInputs } from './seoLinks.service.js';
import { SEARCH_INTENTS, SEO_DIMENSIONS, SEO_DIMENSION_LABELS, SEO_DIMENSION_WEIGHTS, SEO_SEVERITIES } from './seo.constants.js';

/**
 * The SEO Engine's HTTP surface (Milestone 14).
 *
 * Two things no route here can do, by construction:
 *
 *   - CHANGE THE ARTICLE. Nothing in this router writes to `articles`.
 *     Approving a recommendation writes SEO metadata; approving one that
 *     targets body text records the decision and changes no prose.
 *   - SPEND MONEY WITHOUT BEING TOLD TO. The deterministic analysis is the
 *     default; the AI pass requires `includeAi`, and a paid model on top of
 *     that requires `confirmedCost`. Neither is ever defaulted to true.
 */

export const seoRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Translates an SEO failure into a response the UI can act on.
 *
 * SEO analysis reuses the generation error vocabulary, because a missing API
 * key or a refused spend is the same problem whichever task hit it — and the
 * UI already knows how to report those.
 */
function respondToSeoError(res: Response, error: unknown): void {
  if (error instanceof ArticleNotFoundError) {
    res.status(404).json({ errors: ['Article not found.'], code: 'not_found', retryable: false });
    return;
  }
  if (isGenerationError(error)) {
    res.status(error.httpStatus).json({ errors: [error.message], code: error.code, retryable: error.retryable });
    return;
  }

  console.error('Unexpected SEO failure:', error);
  res
    .status(500)
    .json({ errors: ['SEO analysis failed unexpectedly. Please try again.'], code: 'seo_error', retryable: true });
}

/* --------------------------------------------------------- vocabulary --- */

/** The engine's vocabulary, so the UI never hardcodes a list the server owns. */
seoRouter.get('/meta', (_req, res) => {
  res.json({
    searchIntents: SEARCH_INTENTS,
    severities: SEO_SEVERITIES,
    dimensions: SEO_DIMENSIONS.map((dimension) => ({
      dimension,
      label: SEO_DIMENSION_LABELS[dimension],
      weight: SEO_DIMENSION_WEIGHTS[dimension],
    })),
  });
});

/* --------------------------------------------------------------- gate --- */

seoRouter.get('/gate/criteria', (_req, res) => {
  res.json({ criteria: getGateCriteria() });
});

seoRouter.put('/gate/criteria', (req, res) => {
  const { errors, value } = validateGateCriteria(req.body);
  if (errors.length) return res.status(400).json({ errors });
  res.json({ criteria: saveGateCriteria(value!) });
});

/* ----------------------------------------------------------- overview --- */

/**
 * The cross-article SEO list. Reads stored state only; runs nothing.
 *
 * Each row carries the derived SEO STATUS (Milestone 15) alongside the raw
 * readiness field, so every screen shows the same five-state vocabulary
 * instead of each one re-deriving a label from score, findings and gate.
 */
seoRouter.get('/articles', (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
  const summaries = repo.listArticleSeoSummaries(limit);

  const withStatus = summaries.map((summary) => {
    const status = getSeoStatusForArticle(summary.articleId);
    return {
      ...summary,
      seoStatus: status?.status ?? 'not_evaluated',
      seoStatusLabel: status?.label ?? 'Not Evaluated',
      seoStatusDetail: status?.detail ?? 'No SEO analysis has been run for this article.',
      analysisIsCurrent: status?.isCurrent ?? false,
    };
  });

  res.json({ articles: withStatus, total: withStatus.length, statuses: Object.entries(SEO_STATUS_META).map(([value, meta]) => ({ value, ...meta })) });
});

/**
 * Everything the SEO screen needs for one article.
 *
 * Recomputes only what is free: the document model, the structured-data
 * assessment and the gate. Contacts no provider and writes nothing.
 */
seoRouter.get('/articles/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  try {
    res.json({ seo: getSeoOverview(id) });
  } catch (error) {
    respondToSeoError(res, error);
  }
});

/* ------------------------------------------------------ configuration --- */

seoRouter.put('/articles/:id/configuration', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const { errors, value } = validateSeoConfiguration(req.body);
  if (errors.length) return res.status(400).json({ errors });

  try {
    res.json({ record: repo.saveSeoConfiguration(id, value!) });
  } catch (error) {
    respondToSeoError(res, error);
  }
});

seoRouter.put('/articles/:id/metadata', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const { errors, value } = validateSeoMetadata(req.body);
  if (errors.length) return res.status(400).json({ errors });

  try {
    res.json({ record: repo.saveSeoMetadata(id, value!) });
  } catch (error) {
    respondToSeoError(res, error);
  }
});

/* ------------------------------------------------------------ analyse --- */

/**
 * Runs an SEO analysis.
 *
 * COST CONTROL, in the shape of the request body:
 *
 *   {}                                    deterministic only. Free. Always.
 *   { includeAi: true }                   adds the AI pass — refused for a
 *                                         paid model without confirmation.
 *   { includeAi: true, confirmedCost:true } the user has accepted the cost.
 *   { force: true }                       re-run the AI pass even when an
 *                                         identical analysis already exists.
 *
 * Nothing here defaults `includeAi` or `confirmedCost` to true, and there is
 * no path that upgrades a free analysis into a paid one.
 */
seoRouter.post('/articles/:id/analyze', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const body = (req.body ?? {}) as Record<string, unknown>;

  const rawModelId = Number(body.modelId);
  const modelId = Number.isInteger(rawModelId) && rawModelId > 0 ? rawModelId : null;
  if (body.modelId !== undefined && body.modelId !== null && modelId === null) {
    return res.status(400).json({ errors: ['modelId must be a positive whole number.'] });
  }

  try {
    const outcome = await runSeoAnalysis(id, {
      includeAi: body.includeAi === true,
      confirmedCost: body.confirmedCost === true,
      force: body.force === true,
      modelId,
    });
    res.json(outcome);
  } catch (error) {
    respondToSeoError(res, error);
  }
});

seoRouter.get('/articles/:id/runs', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 100 ? rawLimit : 20;
  res.json({ runs: repo.listAnalysisRuns(id, limit) });
});

/* ----------------------------------------------------------- findings --- */

/**
 * Reviewing a finding.
 *
 * Dismissing is a decision, not a fix: the finding stays on the analysis that
 * produced it, stops counting toward the gate, and stops costing points.
 */
seoRouter.patch('/findings/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid finding id.'] });

  const status = (req.body ?? {}).status;
  if (status !== 'open' && status !== 'dismissed' && status !== 'resolved') {
    return res.status(400).json({ errors: ['status must be one of: open, dismissed, resolved.'] });
  }

  const finding = repo.setFindingStatus(id, status);
  if (!finding) return res.status(404).json({ errors: ['Finding not found.'] });
  res.json({ finding });
});

/* ---------------------------------------------------- recommendations --- */

/**
 * RECOMMENDATION -> PROPOSED CHANGE -> APPROVED CHANGE.
 *
 * Approving a recommendation that targets an SEO metadata field writes the
 * proposed value into that field and nothing else. Approving one that targets
 * body text, a heading, or image alt text records the approval and changes no
 * article content: Cynth has no article editor, and this milestone does not
 * give it one. The distinction is enforced in the repository, where only
 * metadata fields have a column to write to.
 */
seoRouter.patch('/recommendations/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid recommendation id.'] });

  const status = (req.body ?? {}).status;
  if (status !== 'approved' && status !== 'rejected' && status !== 'proposed') {
    return res.status(400).json({ errors: ['status must be one of: proposed, approved, rejected.'] });
  }

  const existing = repo.getRecommendation(id);
  if (!existing) return res.status(404).json({ errors: ['Recommendation not found.'] });

  if (status !== 'approved') {
    return res.json({ recommendation: repo.setRecommendationStatus(id, status), applied: false });
  }

  const metadataFields = ['seo_title', 'meta_description', 'seo_slug', 'canonical_url'];
  const isMetadataField = metadataFields.includes(existing.field);

  if (isMetadataField && existing.proposedValue) {
    repo.setSeoMetadataField(existing.articleId, existing.field, existing.proposedValue);
    return res.json({
      recommendation: repo.setRecommendationStatus(id, 'applied'),
      applied: true,
      record: repo.getArticleSeo(existing.articleId),
    });
  }

  // Approved, but nothing is applied: either there is no proposed value, or
  // the field is article content, which Cynth does not edit.
  const recommendation = repo.setRecommendationStatus(id, 'approved');
  res.json({
    recommendation,
    applied: false,
    note: isMetadataField
      ? 'Approved. There is no proposed value to apply — write the field yourself under SEO metadata.'
      : 'Approved and recorded. Cynth does not edit article content, so nothing was changed in the article.',
  });
});

/* --------------------------------------------------------------- links --- */

/**
 * WHICH EXISTING ARTICLES SHOULD LINK TO THIS ONE.
 *
 * The inverse of the opportunity list stored by an analysis run, and the
 * question a newly written article actually raises: not "what do I link to"
 * but "what links to me". A new piece arrives orphaned, and the articles that
 * should point at it were finished weeks ago.
 *
 * A READ. It proposes and stores nothing on its own — the editor decides, and
 * `?save=1` is what writes the proposals into the same table the analysis run
 * uses, so both directions are reviewed in one place with one vocabulary.
 */
seoRouter.get('/articles/:id/inbound-links', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const article = getArticleById(id);
  if (!article) return res.status(404).json({ errors: ['Article not found.'] });

  const candidates = findInboundLinkOpportunities(article);

  if (String(req.query.save) === '1' && candidates.length) {
    repo.saveInternalLinks(toInboundLinkInputs(null, id, candidates));
  }

  res.json({
    articleId: id,
    title: article.title ?? article.generated?.title ?? null,
    candidates,
    // Said explicitly because it is the number an editor acts on: a source
    // that already contains the anchor is a small edit, one that does not is
    // a rewrite of a finished article.
    readyToLink: candidates.filter((c) => c.anchorFoundInSource).length,
    saved: String(req.query.save) === '1',
  });
});

/** What this publication has already written. The data behind coverage awareness. */
seoRouter.get('/coverage', (req, res) => {
  const themeId = req.query.themeId !== undefined ? parseId(String(req.query.themeId)) : null;
  res.json({
    byTheme: coverageByTheme(),
    articles: listCoverage().filter((entry) => themeId === null || entry.themeId === themeId),
  });
});

seoRouter.patch('/internal-links/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid link id.'] });

  const status = (req.body ?? {}).status;
  if (status !== 'approved' && status !== 'rejected' && status !== 'proposed') {
    return res.status(400).json({ errors: ['status must be one of: proposed, approved, rejected.'] });
  }

  const link = repo.setInternalLinkStatus(id, status);
  if (!link) return res.status(404).json({ errors: ['Link opportunity not found.'] });

  // Approval records a decision. Nothing is inserted into the article: the
  // link travels as SEO metadata, and the article body is untouched.
  res.json({ link, insertedIntoArticle: false });
});

seoRouter.patch('/external-sources/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid source id.'] });

  const status = (req.body ?? {}).status;
  if (status !== 'approved' && status !== 'rejected' && status !== 'proposed') {
    return res.status(400).json({ errors: ['status must be one of: proposed, approved, rejected.'] });
  }

  const source = repo.setExternalSourceStatus(id, status);
  if (!source) return res.status(404).json({ errors: ['External source not found.'] });

  // verificationStatus is untouched by approval, and stays 'unverified':
  // approving a suggestion is not the same as checking it, and Cynth has no
  // retriever to check it with.
  res.json({ source, verified: source.verificationStatus === 'verified' });
});

/* -------------------------------------------------------------- images --- */

seoRouter.patch('/image-requirements/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid image requirement id.'] });

  const status = (req.body ?? {}).status;
  if (status !== 'approved' && status !== 'rejected' && status !== 'proposed') {
    return res.status(400).json({ errors: ['status must be one of: proposed, approved, rejected.'] });
  }

  const requirement = repo.setImageRequirementStatus(id, status);
  if (!requirement) return res.status(404).json({ errors: ['Image requirement not found.'] });
  res.json({ requirement });
});
