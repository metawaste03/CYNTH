import { Router } from 'express';
import { getArticleById, listArticles } from '../articles/articles.repository.js';
import { evaluateQualityGate, evaluateArticleById } from './qualityGate.service.js';
import { evaluateAndStore, getStoredDecision, summariesFor } from './qualityGate.repository.js';
import { QUALITY_STATUS_META } from './qualityGate.types.js';
import { getSeoStatus, SEO_STATUS_META } from '../seo/seoStatus.service.js';

/**
 * QUALITY GATE — HTTP surface.
 *
 *   Quality Gate -> SEO Status -> WordPress Draft
 *
 * The readiness endpoint returns BOTH statuses side by side, because the
 * distinction between them is the point:
 *
 *     Quality: Passed     SEO: Needs Attention
 *
 * is a valid, common state, and the user must be able to see it and still
 * open, read and edit the article. Nothing here blocks anything — the gate
 * reports, and the CMS push path is the only place a gate refuses.
 *
 * Everything here is free: deterministic checks and stored SEO results. No
 * endpoint in this router can call a model.
 */
export const qualityGateRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The status vocabularies, so the client renders labels the server owns. */
qualityGateRouter.get('/meta', (_req, res) => {
  res.json({
    qualityStatuses: Object.entries(QUALITY_STATUS_META).map(([value, meta]) => ({ value, ...meta })),
    seoStatuses: Object.entries(SEO_STATUS_META).map(([value, meta]) => ({ value, ...meta })),
  });
});

/**
 * Every article with its stored Quality Gate status and its SEO status.
 *
 * The Quality Gate page reads this. An article that has never been evaluated
 * is reported as 'not_evaluated' rather than being quietly evaluated on read:
 * a list view must not have side effects, and "we have not looked at this
 * yet" is a real answer the user needs to see.
 */
qualityGateRouter.get('/', (_req, res) => {
  const articles = listArticles({});
  const quality = summariesFor(articles.map((article) => article.id));

  const rows = articles.map((summary) => {
    const article = getArticleById(summary.id)!;
    const seo = getSeoStatus(article);
    const stored = quality.get(summary.id);

    return {
      articleId: summary.id,
      title: article.title ?? article.generated?.title ?? null,
      status: article.status,
      hasGeneratedContent: Boolean(article.generated?.content?.trim()),
      quality: stored ?? {
        articleId: summary.id,
        status: 'not_evaluated' as const,
        failedCount: 0,
        warningCount: 0,
        evaluatedAt: null,
        isCurrent: false,
      },
      seo: {
        status: seo.status,
        label: seo.label,
        score: seo.score,
        openBlocking: seo.openBlocking,
        openWarnings: seo.openWarnings,
        analysedAt: seo.analysedAt,
        isCurrent: seo.isCurrent,
      },
    };
  });

  res.json({ articles: rows, total: rows.length });
});

/**
 * One article's readiness: the stored Quality Gate result, a fresh preview of
 * what it would be right now, and the SEO status beside it.
 *
 * `stored` and `preview` are both returned on purpose. They differ exactly
 * when the article has changed since it was last evaluated, and showing both
 * is how the user sees that rather than being handed a silently-refreshed
 * number that hides it.
 */
qualityGateRouter.get('/:articleId', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const article = getArticleById(articleId);
  if (!article) return res.status(404).json({ errors: ['Article not found.'] });

  res.json({
    articleId,
    quality: { stored: getStoredDecision(articleId), preview: evaluateQualityGate(article) },
    seo: getSeoStatus(article),
  });
});

/** Runs the gate and stores the result. Deterministic, free, and contacts nothing. */
qualityGateRouter.post('/:articleId/evaluate', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const decision = evaluateAndStore(articleId);
  if (!decision) return res.status(404).json({ errors: ['Article not found.'] });

  const article = getArticleById(articleId)!;
  res.json({ quality: decision, seo: getSeoStatus(article) });
});

/** A dry run: what the gate would say, without storing anything. */
qualityGateRouter.get('/:articleId/preview', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid article id.'] });

  const decision = evaluateArticleById(articleId);
  if (!decision) return res.status(404).json({ errors: ['Article not found.'] });

  res.json({ quality: decision });
});
