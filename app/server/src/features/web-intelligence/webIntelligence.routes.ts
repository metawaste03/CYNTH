import { Router } from 'express';
import * as repo from './webSources.repository.js';
import { hasAnyRetriever, listRetrievers } from './retrievers/index.js';
import { WEB_SOURCE_PURPOSES } from './webIntelligence.types.js';
import type { WebSourceInput, } from './webSources.repository.js';
import type { WebSourcePurpose } from './webIntelligence.types.js';

/**
 * WEB INTELLIGENCE — HTTP surface (Milestone 14).
 *
 * What exists: managing the list of websites the user authorises Cynth to
 * investigate, and recording/approving backlink opportunities.
 *
 * What deliberately does not exist: any endpoint that fetches a URL. There is
 * no crawl route, no search route, and no "retrieve this page" route, because
 * there is no retriever behind them — see retrievers/index.ts, whose registry
 * is empty. `/capabilities` reports that plainly rather than leaving a caller
 * to discover it.
 */

export const webIntelligenceRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * What Cynth can currently do on the web. The honest answer is: nothing.
 *
 * Reported as an endpoint rather than left implicit so the UI can state it,
 * and so a future milestone flipping this to true is a visible change.
 */
webIntelligenceRouter.get('/capabilities', (_req, res) => {
  res.json({
    canRetrieve: hasAnyRetriever(),
    retrievers: listRetrievers(),
    purposes: WEB_SOURCE_PURPOSES,
    // Phrased as a continuation, since the UI states the headline fact
    // ("Cynth has no web retriever") itself and then appends this.
    note: hasAnyRetriever()
      ? 'It may only read sources the user has explicitly authorised, and only for the permission that source grants.'
      : 'It cannot fetch, crawl, or search any website. Sources configured here are a permission list for a future capability, and nothing reads them yet.',
  });
});

/* ------------------------------------------------------------ sources --- */

function validateSource(body: unknown): { errors: string[]; value: WebSourceInput | null } {
  const errors: string[] = [];
  const input = (body ?? {}) as Record<string, unknown>;

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.push('name is required.');
  if (name.length > 200) errors.push('name must be 200 characters or fewer.');

  const rawDomain = typeof input.domain === 'string' ? input.domain.trim() : '';
  if (!rawDomain) errors.push('domain is required.');

  const domain = rawDomain ? repo.normaliseDomain(rawDomain) : '';
  // A source is a site. Anything that is not a plausible hostname is refused
  // rather than stored as an unusable permission.
  if (rawDomain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    errors.push('domain must be a hostname such as example.org — not a URL, an IP address, or a path.');
  }

  const purposeRaw = input.purpose;
  let purpose: WebSourcePurpose | null = null;
  if (purposeRaw !== undefined && purposeRaw !== null && purposeRaw !== '') {
    if (!WEB_SOURCE_PURPOSES.includes(purposeRaw as WebSourcePurpose)) {
      errors.push(`purpose must be one of: ${WEB_SOURCE_PURPOSES.join(', ')}.`);
    } else {
      purpose = purposeRaw as WebSourcePurpose;
    }
  }

  let rateLimit: number | null = null;
  if (input.rateLimitPerMinute !== undefined && input.rateLimitPerMinute !== null) {
    const numeric = Number(input.rateLimitPerMinute);
    if (!Number.isInteger(numeric) || numeric <= 0) errors.push('rateLimitPerMinute must be a positive whole number.');
    else rateLimit = numeric;
  }

  const text = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  };

  const value: WebSourceInput = {
    projectId: Number.isInteger(Number(input.projectId)) && Number(input.projectId) > 0 ? Number(input.projectId) : null,
    name,
    domain,
    description: text(input.description),
    purpose,
    isActive: input.isActive !== false,
    // BOTH PERMISSIONS DEFAULT TO OFF. Adding a site to the list is not
    // consent to read it — the user has to say so explicitly.
    crawlPermitted: input.crawlPermitted === true,
    searchPermitted: input.searchPermitted === true,
    // Defaults to true, and only an explicit false turns it off.
    respectRobots: input.respectRobots !== false,
    rateLimitPerMinute: rateLimit,
    notes: text(input.notes),
  };

  return { errors, value: errors.length ? null : value };
}

webIntelligenceRouter.get('/sources', (req, res) => {
  const activeOnly = req.query.activeOnly === 'true';
  const sources = repo.listWebSources({ activeOnly });
  res.json({ sources, total: sources.length });
});

webIntelligenceRouter.get('/sources/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid source id.'] });

  const source = repo.getWebSource(id);
  if (!source) return res.status(404).json({ errors: ['Web source not found.'] });
  res.json({ source, retrievals: repo.listRetrievalsForSource(id) });
});

webIntelligenceRouter.post('/sources', (req, res) => {
  const { errors, value } = validateSource(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const existing = repo.getWebSourceByDomain(value!.domain);
  if (existing) {
    return res.status(409).json({ errors: [`${value!.domain} is already in the source list.`] });
  }

  res.status(201).json({ source: repo.createWebSource(value!) });
});

webIntelligenceRouter.put('/sources/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid source id.'] });

  const { errors, value } = validateSource(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const clash = repo.getWebSourceByDomain(value!.domain);
  if (clash && clash.id !== id) {
    return res.status(409).json({ errors: [`${value!.domain} is already in the source list.`] });
  }

  const source = repo.updateWebSource(id, value!);
  if (!source) return res.status(404).json({ errors: ['Web source not found.'] });
  res.json({ source });
});

webIntelligenceRouter.delete('/sources/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid source id.'] });

  if (!repo.deleteWebSource(id)) return res.status(404).json({ errors: ['Web source not found.'] });
  res.status(204).end();
});

/* ----------------------------------------------------------- findings --- */

/**
 * Web-derived findings, with their provenance chain attached.
 *
 * Returns an empty list for the whole of Milestone 14, because nothing has
 * ever retrieved anything. That is the correct answer, and Cynth does not
 * manufacture example findings to make a screen look populated.
 */
webIntelligenceRouter.get('/findings', (req, res) => {
  const topic = typeof req.query.topic === 'string' && req.query.topic ? req.query.topic : undefined;
  const findings = repo.listAttributedFindings({ topic });
  res.json({
    findings,
    total: findings.length,
    canRetrieve: hasAnyRetriever(),
  });
});

/* ---------------------------------------------------------- backlinks --- */

webIntelligenceRouter.get('/backlinks', (req, res) => {
  const rawArticleId = Number(req.query.articleId);
  const articleId = Number.isInteger(rawArticleId) && rawArticleId > 0 ? rawArticleId : undefined;
  const opportunities = repo.listBacklinkOpportunities({ articleId });
  res.json({ opportunities, total: opportunities.length });
});

/**
 * Records a backlink opportunity.
 *
 * Manual entry only: there is no discovery engine, so every row created here
 * came from a person. It is created as 'discovered' and must pass through an
 * explicit approval before it is anything more.
 */
webIntelligenceRouter.post('/backlinks', (req, res) => {
  const input = (req.body ?? {}) as Record<string, unknown>;
  const errors: string[] = [];

  const targetArticleId = Number(input.targetArticleId);
  if (!Number.isInteger(targetArticleId) || targetArticleId <= 0) {
    errors.push('targetArticleId is required.');
  }

  const sourceDomain = typeof input.sourceDomain === 'string' ? input.sourceDomain.trim() : '';
  if (!sourceDomain) errors.push('sourceDomain is required.');

  const authoritySignal = typeof input.authoritySignal === 'string' ? input.authoritySignal.trim() : null;
  const authoritySource = typeof input.authoritySource === 'string' ? input.authoritySource.trim() : null;
  if (authoritySignal && !authoritySource) {
    errors.push('authoritySource is required whenever an authoritySignal is given: an unattributed authority figure is not usable.');
  }

  if (errors.length) return res.status(400).json({ errors });

  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

  try {
    const opportunity = repo.createBacklinkOpportunity({
      targetArticleId,
      webSourceId:
        Number.isInteger(Number(input.webSourceId)) && Number(input.webSourceId) > 0 ? Number(input.webSourceId) : null,
      sourceDomain,
      sourceUrl: text(input.sourceUrl),
      anchorSuggestion: text(input.anchorSuggestion),
      relevance: text(input.relevance),
      authoritySignal,
      authoritySource,
      evidenceRetrievalId: null,
      notes: text(input.notes),
      origin: 'manual',
    });
    res.status(201).json({ opportunity });
  } catch (error) {
    res.status(400).json({ errors: [error instanceof Error ? error.message : 'Could not record the opportunity.'] });
  }
});

/**
 * The approval workflow.
 *
 *   discovered -> recommended -> approved / rejected -> placed
 *
 * 'placed' records that a human put the link somewhere. Cynth never inserts a
 * link into an article, so this endpoint changes a status and nothing else.
 */
webIntelligenceRouter.patch('/backlinks/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid opportunity id.'] });

  const status = (req.body ?? {}).status;
  const allowed = ['discovered', 'recommended', 'approved', 'rejected', 'placed'];
  if (typeof status !== 'string' || !allowed.includes(status)) {
    return res.status(400).json({ errors: [`status must be one of: ${allowed.join(', ')}.`] });
  }

  const opportunity = repo.setBacklinkStatus(id, status as never);
  if (!opportunity) return res.status(404).json({ errors: ['Backlink opportunity not found.'] });
  res.json({ opportunity, insertedIntoArticle: false });
});

webIntelligenceRouter.delete('/backlinks/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid opportunity id.'] });

  if (!repo.deleteBacklinkOpportunity(id)) {
    return res.status(404).json({ errors: ['Backlink opportunity not found.'] });
  }
  res.status(204).end();
});
