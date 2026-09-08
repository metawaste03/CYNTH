import { getDatabase } from '../../shared/database/index.js';
import type {
  ArticleSeoRow,
  SeoAnalysisRunRow,
  SeoExternalSourceRow,
  SeoFindingRow,
  SeoImageRequirementRow,
  SeoInternalLinkRow,
  SeoRecommendationRow,
} from '../../shared/database/types.js';
import type {
  ExternalSourceOpportunity,
  ImageSeoRequirement,
  InternalLinkOpportunity,
  SeoAnalysisRun,
  SeoConfiguration,
  SeoFinding,
  SeoMetadata,
  SeoRecommendation,
  SeoRecommendationField,
  SeoScore,
  StoredSeoFinding,
} from './seo.types.js';
import type { SearchIntent, SeoCategory, SeoDimension, SeoElement, SeoOrigin, SeoSeverity } from './seo.constants.js';

/**
 * SEO persistence (Milestone 14).
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD: nothing here writes to
 * `articles.content`, `articles.title`, `articles.slug`, or any Content Brief
 * column. SEO information lives beside the article, in its own tables, so an
 * analysis can be run, discarded and re-run without the article it describes
 * ever changing. There is no UPDATE against `articles` anywhere in this file.
 */

/* --------------------------------------------------------- list helpers --- */

/** Comma-separated storage <-> string[]. Empty entries are dropped, not kept as ''. */
function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function joinList(values: string[] | undefined | null): string | null {
  if (!values || !values.length) return null;
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(', ') : null;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    // A malformed blob must never break reading the record it belongs to.
    return null;
  }
}

/* -------------------------------------------------------- article_seo --- */

export interface ArticleSeoRecord {
  articleId: number;
  configuration: SeoConfiguration;
  metadata: SeoMetadata;
  latestAnalysisId: number | null;
  latestScore: number | null;
  readiness: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** An empty record for an article that has no SEO configuration yet. Never invented values — all null. */
export function emptySeoRecord(articleId: number): ArticleSeoRecord {
  return {
    articleId,
    configuration: {
      targetQuery: null,
      searchIntent: null,
      secondaryIntents: [],
      secondaryKeywords: [],
      semanticTopics: [],
      targetAudience: null,
      geoTarget: null,
      seoObjectives: null,
      notes: null,
    },
    metadata: {
      seoTitle: null,
      metaDescription: null,
      seoSlug: null,
      canonicalUrl: null,
      structuredDataTypes: [],
      structuredData: null,
    },
    latestAnalysisId: null,
    latestScore: null,
    readiness: null,
    createdAt: null,
    updatedAt: null,
  };
}

function mapSeoRecord(row: ArticleSeoRow): ArticleSeoRecord {
  return {
    articleId: row.article_id,
    configuration: {
      targetQuery: row.target_query,
      searchIntent: (row.search_intent as SearchIntent | null) ?? null,
      secondaryIntents: splitList(row.secondary_intents),
      secondaryKeywords: splitList(row.secondary_keywords),
      semanticTopics: splitList(row.semantic_topics),
      targetAudience: row.target_audience,
      geoTarget: row.geo_target,
      seoObjectives: row.seo_objectives,
      notes: row.notes,
    },
    metadata: {
      seoTitle: row.seo_title,
      metaDescription: row.meta_description,
      seoSlug: row.seo_slug,
      canonicalUrl: row.canonical_url,
      structuredDataTypes: parseJson<string[]>(row.structured_data_types) ?? [],
      structuredData: parseJson<Record<string, unknown>>(row.structured_data),
    },
    latestAnalysisId: row.latest_analysis_id,
    latestScore: row.latest_score,
    readiness: row.readiness,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getArticleSeo(articleId: number): ArticleSeoRecord {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM article_seo WHERE article_id = ?').get(articleId) as unknown as
    | ArticleSeoRow
    | undefined;
  return row ? mapSeoRecord(row) : emptySeoRecord(articleId);
}

/** Creates the row on first use, so callers never have to. */
function ensureRow(articleId: number): void {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM article_seo WHERE article_id = ?').get(articleId);
  if (!existing) db.prepare('INSERT INTO article_seo (article_id) VALUES (?)').run(articleId);
}

export interface SeoConfigurationInput {
  targetQuery: string | null;
  searchIntent: SearchIntent | null;
  secondaryIntents: string[];
  secondaryKeywords: string[];
  semanticTopics: string[];
  targetAudience: string | null;
  geoTarget: string | null;
  seoObjectives: string | null;
  notes: string | null;
}

/**
 * Saves the SEO configuration. Full replace — the SEO form always sends its
 * complete current state, exactly as the article wizard does.
 *
 * Writes nothing outside `article_seo`, and in particular does not touch the
 * article's own search_intent or target_audience brief fields: the brief is
 * what the article was written for, the SEO configuration is what it is being
 * optimised for, and conflating them would destroy the record of either.
 */
export function saveSeoConfiguration(articleId: number, input: SeoConfigurationInput): ArticleSeoRecord {
  ensureRow(articleId);
  const db = getDatabase();
  db.prepare(`
    UPDATE article_seo SET
      target_query = ?, search_intent = ?, secondary_intents = ?, secondary_keywords = ?,
      semantic_topics = ?, target_audience = ?, geo_target = ?, seo_objectives = ?, notes = ?,
      updated_at = datetime('now')
    WHERE article_id = ?
  `).run(
    input.targetQuery,
    input.searchIntent,
    joinList(input.secondaryIntents),
    joinList(input.secondaryKeywords),
    joinList(input.semanticTopics),
    input.targetAudience,
    input.geoTarget,
    input.seoObjectives,
    input.notes,
    articleId,
  );
  return getArticleSeo(articleId);
}

export interface SeoMetadataInput {
  seoTitle: string | null;
  metaDescription: string | null;
  seoSlug: string | null;
  canonicalUrl: string | null;
  structuredDataTypes: string[];
  structuredData: Record<string, unknown> | null;
}

/**
 * Saves SEO metadata. Again a full replace of the metadata fields only —
 * configuration, findings, scores and the article itself are untouched.
 */
export function saveSeoMetadata(articleId: number, input: SeoMetadataInput): ArticleSeoRecord {
  ensureRow(articleId);
  const db = getDatabase();
  db.prepare(`
    UPDATE article_seo SET
      seo_title = ?, meta_description = ?, seo_slug = ?, canonical_url = ?,
      structured_data_types = ?, structured_data = ?, updated_at = datetime('now')
    WHERE article_id = ?
  `).run(
    input.seoTitle,
    input.metaDescription,
    input.seoSlug,
    input.canonicalUrl,
    input.structuredDataTypes.length ? JSON.stringify(input.structuredDataTypes) : null,
    input.structuredData ? JSON.stringify(input.structuredData) : null,
    articleId,
  );
  return getArticleSeo(articleId);
}

/** Updates one metadata field, used when a user approves a proposed change. */
export function setSeoMetadataField(articleId: number, field: SeoRecommendationField, value: string | null): void {
  const column: Partial<Record<SeoRecommendationField, string>> = {
    seo_title: 'seo_title',
    meta_description: 'meta_description',
    seo_slug: 'seo_slug',
    canonical_url: 'canonical_url',
  };
  const target = column[field];
  // Body fields (content, heading, image_alt, links) have no column here on
  // purpose: approving one records the decision and changes no article text.
  if (!target) return;

  ensureRow(articleId);
  const db = getDatabase();
  db.prepare(`UPDATE article_seo SET ${target} = ?, updated_at = datetime('now') WHERE article_id = ?`).run(
    value,
    articleId,
  );
}

/** Denormalised summary of the latest analysis, for lists and the gate. */
export function setLatestAnalysis(
  articleId: number,
  analysisId: number,
  score: number | null,
  readiness: string,
): void {
  ensureRow(articleId);
  const db = getDatabase();
  db.prepare(`
    UPDATE article_seo SET latest_analysis_id = ?, latest_score = ?, readiness = ?, updated_at = datetime('now')
    WHERE article_id = ?
  `).run(analysisId, score, readiness, articleId);
}

/* ------------------------------------------------------- analysis runs --- */

export interface RecordAnalysisInput {
  articleId: number;
  mode: 'deterministic' | 'ai' | 'combined';
  status: 'success' | 'partial' | 'failure';
  provider?: string | null;
  providerType?: string | null;
  model?: string | null;
  costClass?: string | null;
  generationMode?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  score?: number | null;
  scoreBreakdown?: SeoScore | null;
  contentFingerprint?: string | null;
  configFingerprint?: string | null;
}

function mapRun(row: SeoAnalysisRunRow): SeoAnalysisRun {
  return {
    id: row.id,
    articleId: row.article_id,
    mode: row.mode as SeoAnalysisRun['mode'],
    status: row.status as SeoAnalysisRun['status'],
    provider: row.provider,
    providerType: row.provider_type,
    model: row.model,
    costClass: row.cost_class,
    generationMode: row.generation_mode,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    score: row.score,
    scoreBreakdown: parseJson<SeoScore>(row.score_breakdown),
    contentFingerprint: row.content_fingerprint,
    configFingerprint: row.config_fingerprint,
    createdAt: row.created_at,
  };
}

export function recordAnalysisRun(input: RecordAnalysisInput): number {
  const db = getDatabase();
  const result = db
    .prepare(`
      INSERT INTO seo_analysis_runs (
        article_id, mode, status, provider, provider_type, model, cost_class, generation_mode,
        prompt_tokens, completion_tokens, total_tokens, duration_ms, error_code, error_message,
        score, score_breakdown, content_fingerprint, config_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.articleId,
      input.mode,
      input.status,
      input.provider ?? null,
      input.providerType ?? null,
      input.model ?? null,
      input.costClass ?? null,
      input.generationMode ?? null,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.totalTokens ?? null,
      input.durationMs ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.score ?? null,
      input.scoreBreakdown ? JSON.stringify(input.scoreBreakdown) : null,
      input.contentFingerprint ?? null,
      input.configFingerprint ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function getAnalysisRun(id: number): SeoAnalysisRun | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM seo_analysis_runs WHERE id = ?').get(id) as unknown as
    | SeoAnalysisRunRow
    | undefined;
  return row ? mapRun(row) : null;
}

/** The most recent analysis that actually produced something, i.e. not a bare failure. */
/**
 * The latest run that produced a usable result.
 *
 * Failures are excluded: a run that never produced findings or a score is not
 * an analysis, and the gate must not evaluate against one. To ask whether an
 * attempt was MADE — including a failed one — use getLatestAnalysisAttempt().
 */
export function getLatestAnalysisRun(articleId: number): SeoAnalysisRun | null {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT * FROM seo_analysis_runs
      WHERE article_id = ? AND status != 'failure'
      ORDER BY id DESC LIMIT 1
    `)
    .get(articleId) as unknown as SeoAnalysisRunRow | undefined;
  return row ? mapRun(row) : null;
}

/**
 * The latest run of any kind, INCLUDING a failed one (Milestone 15).
 *
 * This is what separates "no analysis has ever been attempted" from "the last
 * attempt failed" — two states the SEO status reports differently, and which
 * getLatestAnalysisRun() cannot distinguish because it filters failures out.
 *
 * The gate deliberately does not use this: a failed run is still not an
 * analysis, and must not be evaluated against.
 */
export function getLatestAnalysisAttempt(articleId: number): SeoAnalysisRun | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM seo_analysis_runs WHERE article_id = ? ORDER BY id DESC LIMIT 1')
    .get(articleId) as unknown as SeoAnalysisRunRow | undefined;
  return row ? mapRun(row) : null;
}

/**
 * The most recent AI-assisted run for this exact content and configuration.
 *
 * COST CONTROL: this is what lets Cynth reuse an analysis instead of paying
 * for the same question twice. It matches on fingerprints, never on time —
 * an hour-old analysis of unchanged text is still valid, and a one-minute-old
 * analysis of changed text is not.
 */
export function findReusableAiRun(
  articleId: number,
  contentFingerprint: string,
  configFingerprint: string,
): SeoAnalysisRun | null {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT * FROM seo_analysis_runs
      WHERE article_id = ? AND content_fingerprint = ? AND config_fingerprint = ?
        AND mode IN ('ai', 'combined') AND status = 'success'
      ORDER BY id DESC LIMIT 1
    `)
    .get(articleId, contentFingerprint, configFingerprint) as unknown as SeoAnalysisRunRow | undefined;
  return row ? mapRun(row) : null;
}

export function listAnalysisRuns(articleId: number, limit = 20): SeoAnalysisRun[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM seo_analysis_runs WHERE article_id = ? ORDER BY id DESC LIMIT ?')
    .all(articleId, limit) as unknown as SeoAnalysisRunRow[];
  return rows.map(mapRun);
}

/* ------------------------------------------------------------ findings --- */

function mapFinding(row: SeoFindingRow): StoredSeoFinding {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    articleId: row.article_id,
    code: row.code,
    category: row.category as SeoCategory,
    dimension: row.dimension as SeoDimension,
    severity: row.severity as SeoSeverity,
    origin: row.origin as SeoOrigin,
    summary: row.summary,
    explanation: row.explanation,
    recommendation: row.recommendation,
    element: (row.element as SeoElement | null) ?? null,
    locator: parseJson(row.locator),
    confidence: row.confidence ?? 1,
    status: row.status as StoredSeoFinding['status'],
    createdAt: row.created_at,
  };
}

export function saveFindings(analysisId: number, articleId: number, findings: SeoFinding[]): StoredSeoFinding[] {
  const db = getDatabase();
  const statement = db.prepare(`
    INSERT INTO seo_findings (
      analysis_id, article_id, code, category, dimension, severity, origin,
      summary, explanation, recommendation, element, locator, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const finding of findings) {
    statement.run(
      analysisId,
      articleId,
      finding.code,
      finding.category,
      finding.dimension,
      finding.severity,
      finding.origin,
      finding.summary,
      finding.explanation,
      finding.recommendation,
      finding.element,
      finding.locator ? JSON.stringify(finding.locator) : null,
      finding.confidence,
    );
  }

  return listFindingsForAnalysis(analysisId);
}

export function listFindingsForAnalysis(analysisId: number): StoredSeoFinding[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM seo_findings WHERE analysis_id = ? ORDER BY id ASC')
    .all(analysisId) as unknown as SeoFindingRow[];
  return rows.map(mapFinding);
}

export function getFinding(id: number): StoredSeoFinding | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM seo_findings WHERE id = ?').get(id) as unknown as SeoFindingRow | undefined;
  return row ? mapFinding(row) : null;
}

/**
 * Dismissing a finding is a review decision, not a fix. It is recorded so the
 * gate can stop counting it, and the finding itself is never deleted — the
 * analysis that produced it stays intact.
 */
export function setFindingStatus(id: number, status: 'open' | 'dismissed' | 'resolved'): StoredSeoFinding | null {
  const db = getDatabase();
  const result = db.prepare('UPDATE seo_findings SET status = ? WHERE id = ?').run(status, id);
  if (result.changes === 0) return null;
  return getFinding(id);
}

/* ----------------------------------------------------- recommendations --- */

function mapRecommendation(row: SeoRecommendationRow): SeoRecommendation {
  return {
    id: row.id,
    articleId: row.article_id,
    findingId: row.finding_id,
    analysisId: row.analysis_id,
    field: row.field as SeoRecommendationField,
    recommendation: row.recommendation,
    currentValue: row.current_value,
    proposedValue: row.proposed_value,
    rationale: row.rationale,
    confidence: row.confidence,
    origin: row.origin as SeoOrigin,
    status: row.status as SeoRecommendation['status'],
    approvedAt: row.approved_at,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
  };
}

export interface RecommendationInput {
  articleId: number;
  findingId?: number | null;
  analysisId?: number | null;
  field: SeoRecommendationField;
  recommendation: string;
  currentValue?: string | null;
  proposedValue?: string | null;
  rationale?: string | null;
  confidence?: number | null;
  origin: SeoOrigin;
}

export function saveRecommendations(inputs: RecommendationInput[]): SeoRecommendation[] {
  const db = getDatabase();
  const statement = db.prepare(`
    INSERT INTO seo_recommendations (
      article_id, finding_id, analysis_id, field, recommendation,
      current_value, proposed_value, rationale, confidence, origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const ids: number[] = [];
  for (const input of inputs) {
    const result = statement.run(
      input.articleId,
      input.findingId ?? null,
      input.analysisId ?? null,
      input.field,
      input.recommendation,
      input.currentValue ?? null,
      input.proposedValue ?? null,
      input.rationale ?? null,
      input.confidence ?? null,
      input.origin,
    );
    ids.push(Number(result.lastInsertRowid));
  }

  return ids.map((id) => getRecommendation(id)!).filter(Boolean);
}

export function getRecommendation(id: number): SeoRecommendation | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM seo_recommendations WHERE id = ?').get(id) as unknown as
    | SeoRecommendationRow
    | undefined;
  return row ? mapRecommendation(row) : null;
}

export function listRecommendationsForArticle(articleId: number): SeoRecommendation[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM seo_recommendations WHERE article_id = ? ORDER BY id DESC')
    .all(articleId) as unknown as SeoRecommendationRow[];
  return rows.map(mapRecommendation);
}

export function listRecommendationsForAnalysis(analysisId: number): SeoRecommendation[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM seo_recommendations WHERE analysis_id = ? ORDER BY id ASC')
    .all(analysisId) as unknown as SeoRecommendationRow[];
  return rows.map(mapRecommendation);
}

/**
 * Clears proposals that no human has acted on, before a re-analysis replaces
 * them.
 *
 * Only 'proposed' rows go: an approved, rejected or applied recommendation is
 * a decision the user made, and a re-run must not erase it or ask the same
 * question again. Without this, analysing an article three times would show
 * the same proposal three times.
 */
export function clearProposedRecommendationsForArticle(articleId: number): void {
  const db = getDatabase();
  db.prepare("DELETE FROM seo_recommendations WHERE article_id = ? AND status = 'proposed'").run(articleId);
}

export function setRecommendationStatus(
  id: number,
  status: SeoRecommendation['status'],
): SeoRecommendation | null {
  const db = getDatabase();
  const now = status === 'approved' || status === 'applied' ? "datetime('now')" : 'approved_at';
  const applied = status === 'applied' ? "datetime('now')" : 'applied_at';
  const result = db
    .prepare(`UPDATE seo_recommendations SET status = ?, approved_at = ${now}, applied_at = ${applied} WHERE id = ?`)
    .run(status, id);
  if (result.changes === 0) return null;
  return getRecommendation(id);
}

/* ------------------------------------------------------ internal links --- */

interface InternalLinkRowWithTarget extends SeoInternalLinkRow {
  target_title: string | null;
  target_generated_title: string | null;
  target_slug: string | null;
}

function mapInternalLink(row: InternalLinkRowWithTarget): InternalLinkOpportunity {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    sourceArticleId: row.source_article_id,
    targetArticleId: row.target_article_id,
    targetTitle: row.target_title?.trim() || row.target_generated_title?.trim() || `Article ${row.target_article_id}`,
    targetSlug: row.target_slug,
    anchorSuggestion: row.anchor_suggestion,
    anchorFoundInSource: row.anchor_found_in_source === 1,
    reason: row.reason,
    relevance: row.relevance,
    confidence: row.confidence,
    origin: row.origin as SeoOrigin,
    status: row.status as InternalLinkOpportunity['status'],
    createdAt: row.created_at,
  };
}

export interface InternalLinkInput {
  analysisId: number | null;
  sourceArticleId: number;
  targetArticleId: number;
  anchorSuggestion: string | null;
  anchorFoundInSource: boolean;
  reason: string | null;
  relevance: number | null;
  confidence: number | null;
  origin: SeoOrigin;
}

/**
 * Stores internal link opportunities.
 *
 * The target must be an article that exists — the foreign key enforces it,
 * and this function verifies it first so an invented id produces nothing
 * rather than an exception. Cynth cannot propose a link to content it does
 * not hold.
 */
export function saveInternalLinks(inputs: InternalLinkInput[]): InternalLinkOpportunity[] {
  const db = getDatabase();
  const exists = db.prepare('SELECT id FROM articles WHERE id = ?');
  const statement = db.prepare(`
    INSERT INTO seo_internal_links (
      analysis_id, source_article_id, target_article_id, anchor_suggestion,
      anchor_found_in_source, reason, relevance, confidence, origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const ids: number[] = [];
  for (const input of inputs) {
    if (input.targetArticleId === input.sourceArticleId) continue;
    if (!exists.get(input.targetArticleId)) continue;

    const result = statement.run(
      input.analysisId,
      input.sourceArticleId,
      input.targetArticleId,
      input.anchorSuggestion,
      input.anchorFoundInSource ? 1 : 0,
      input.reason,
      input.relevance,
      input.confidence,
      input.origin,
    );
    ids.push(Number(result.lastInsertRowid));
  }

  return ids.map((id) => getInternalLink(id)!).filter(Boolean);
}

const INTERNAL_LINK_SELECT = `
  SELECT l.*, a.title AS target_title, a.generated_title AS target_generated_title, a.slug AS target_slug
  FROM seo_internal_links l
  JOIN articles a ON a.id = l.target_article_id
`;

export function getInternalLink(id: number): InternalLinkOpportunity | null {
  const db = getDatabase();
  const row = db.prepare(`${INTERNAL_LINK_SELECT} WHERE l.id = ?`).get(id) as unknown as
    | InternalLinkRowWithTarget
    | undefined;
  return row ? mapInternalLink(row) : null;
}

export function listInternalLinksForArticle(articleId: number): InternalLinkOpportunity[] {
  const db = getDatabase();
  const rows = db
    .prepare(`${INTERNAL_LINK_SELECT} WHERE l.source_article_id = ? ORDER BY l.relevance DESC, l.id DESC`)
    .all(articleId) as unknown as InternalLinkRowWithTarget[];
  return rows.map(mapInternalLink);
}

export function setInternalLinkStatus(
  id: number,
  status: InternalLinkOpportunity['status'],
): InternalLinkOpportunity | null {
  const db = getDatabase();
  const result = db.prepare('UPDATE seo_internal_links SET status = ? WHERE id = ?').run(status, id);
  if (result.changes === 0) return null;
  return getInternalLink(id);
}

/** Clears prior opportunities for an article before a re-analysis replaces them. */
export function clearInternalLinksForArticle(articleId: number): void {
  const db = getDatabase();
  // Approved opportunities survive: a human decision must outlive a re-run.
  db.prepare("DELETE FROM seo_internal_links WHERE source_article_id = ? AND status = 'proposed'").run(articleId);
}

/* ---------------------------------------------------- external sources --- */

function mapExternalSource(row: SeoExternalSourceRow): ExternalSourceOpportunity {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    articleId: row.article_id,
    purpose: (row.purpose as ExternalSourceOpportunity['purpose']) ?? null,
    claimContext: row.claim_context,
    sourceType: row.source_type,
    suggestedDomain: row.suggested_domain,
    suggestedUrl: row.suggested_url,
    verificationStatus: row.verification_status as ExternalSourceOpportunity['verificationStatus'],
    verifiedAt: row.verified_at,
    verifiedRetrievalId: row.verified_retrieval_id,
    rationale: row.rationale,
    confidence: row.confidence,
    origin: row.origin as SeoOrigin,
    status: row.status as ExternalSourceOpportunity['status'],
    createdAt: row.created_at,
  };
}

export interface ExternalSourceInput {
  analysisId: number | null;
  articleId: number;
  purpose: ExternalSourceOpportunity['purpose'];
  claimContext: string | null;
  sourceType: string | null;
  suggestedDomain: string | null;
  suggestedUrl: string | null;
  rationale: string | null;
  confidence: number | null;
  origin: SeoOrigin;
}

/**
 * Stores external source opportunities.
 *
 * verification_status is NOT a parameter. Every row is created 'unverified',
 * because nothing in this milestone fetches a URL, and a caller must not be
 * able to assert that a source was checked.
 */
export function saveExternalSources(inputs: ExternalSourceInput[]): ExternalSourceOpportunity[] {
  const db = getDatabase();
  const statement = db.prepare(`
    INSERT INTO seo_external_sources (
      analysis_id, article_id, purpose, claim_context, source_type,
      suggested_domain, suggested_url, rationale, confidence, origin, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified')
  `);

  const ids: number[] = [];
  for (const input of inputs) {
    const result = statement.run(
      input.analysisId,
      input.articleId,
      input.purpose,
      input.claimContext,
      input.sourceType,
      input.suggestedDomain,
      input.suggestedUrl,
      input.rationale,
      input.confidence,
      input.origin,
    );
    ids.push(Number(result.lastInsertRowid));
  }
  return ids.map((id) => getExternalSource(id)!).filter(Boolean);
}

export function getExternalSource(id: number): ExternalSourceOpportunity | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM seo_external_sources WHERE id = ?').get(id) as unknown as
    | SeoExternalSourceRow
    | undefined;
  return row ? mapExternalSource(row) : null;
}

export function listExternalSourcesForArticle(articleId: number): ExternalSourceOpportunity[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM seo_external_sources WHERE article_id = ? ORDER BY id DESC')
    .all(articleId) as unknown as SeoExternalSourceRow[];
  return rows.map(mapExternalSource);
}

export function setExternalSourceStatus(
  id: number,
  status: ExternalSourceOpportunity['status'],
): ExternalSourceOpportunity | null {
  const db = getDatabase();
  const result = db.prepare('UPDATE seo_external_sources SET status = ? WHERE id = ?').run(status, id);
  if (result.changes === 0) return null;
  return getExternalSource(id);
}

/**
 * Records that a source was actually verified by a real retrieval.
 *
 * `retrievalId` is required, not optional: verification means something
 * fetched the URL and left a provenance record. There is no way to mark a
 * source verified without one, which is why nothing in this milestone can.
 */
export function markExternalSourceVerified(
  id: number,
  retrievalId: number,
  outcome: 'verified' | 'unreachable',
): ExternalSourceOpportunity | null {
  const db = getDatabase();
  const retrieval = db.prepare('SELECT id FROM web_retrievals WHERE id = ?').get(retrievalId);
  if (!retrieval) return null;

  const result = db
    .prepare(`
      UPDATE seo_external_sources
      SET verification_status = ?, verified_at = datetime('now'), verified_retrieval_id = ?
      WHERE id = ?
    `)
    .run(outcome, retrievalId, id);
  if (result.changes === 0) return null;
  return getExternalSource(id);
}

export function clearExternalSourcesForArticle(articleId: number): void {
  const db = getDatabase();
  db.prepare("DELETE FROM seo_external_sources WHERE article_id = ? AND status = 'proposed' AND verification_status = 'unverified'").run(
    articleId,
  );
}

/* ----------------------------------------------------- image SEO reqs --- */

function mapImageRequirement(row: SeoImageRequirementRow): ImageSeoRequirement {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    articleId: row.article_id,
    placement: row.placement,
    purpose: row.purpose,
    altText: row.alt_text,
    filenameSuggestion: row.filename_suggestion,
    caption: row.caption,
    descriptiveContext: row.descriptive_context,
    existingSource: row.existing_source,
    origin: row.origin as SeoOrigin,
    status: row.status as ImageSeoRequirement['status'],
    createdAt: row.created_at,
  };
}

export interface ImageRequirementInput {
  analysisId: number | null;
  articleId: number;
  placement: string | null;
  purpose: string | null;
  altText: string | null;
  filenameSuggestion: string | null;
  caption: string | null;
  descriptiveContext: string | null;
  existingSource: string | null;
  origin: SeoOrigin;
}

export function saveImageRequirements(inputs: ImageRequirementInput[]): ImageSeoRequirement[] {
  const db = getDatabase();
  const statement = db.prepare(`
    INSERT INTO seo_image_requirements (
      analysis_id, article_id, placement, purpose, alt_text, filename_suggestion,
      caption, descriptive_context, existing_source, origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const ids: number[] = [];
  for (const input of inputs) {
    const result = statement.run(
      input.analysisId,
      input.articleId,
      input.placement,
      input.purpose,
      input.altText,
      input.filenameSuggestion,
      input.caption,
      input.descriptiveContext,
      input.existingSource,
      input.origin,
    );
    ids.push(Number(result.lastInsertRowid));
  }
  return ids.map((id) => getImageRequirement(id)!).filter(Boolean);
}

export function getImageRequirement(id: number): ImageSeoRequirement | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM seo_image_requirements WHERE id = ?').get(id) as unknown as
    | SeoImageRequirementRow
    | undefined;
  return row ? mapImageRequirement(row) : null;
}

export function listImageRequirementsForArticle(articleId: number): ImageSeoRequirement[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM seo_image_requirements WHERE article_id = ? ORDER BY id ASC')
    .all(articleId) as unknown as SeoImageRequirementRow[];
  return rows.map(mapImageRequirement);
}

export function setImageRequirementStatus(
  id: number,
  status: ImageSeoRequirement['status'],
): ImageSeoRequirement | null {
  const db = getDatabase();
  const result = db.prepare('UPDATE seo_image_requirements SET status = ? WHERE id = ?').run(status, id);
  if (result.changes === 0) return null;
  return getImageRequirement(id);
}

export function clearImageRequirementsForArticle(articleId: number): void {
  const db = getDatabase();
  db.prepare("DELETE FROM seo_image_requirements WHERE article_id = ? AND status = 'proposed'").run(articleId);
}

/* ---------------------------------------------------- duplicate checks --- */

export interface DuplicateMetadataHit {
  articleId: number;
  title: string;
  field: 'seo_title' | 'meta_description' | 'seo_slug';
}

/**
 * Finds other articles already using the same SEO title, description or slug.
 *
 * A deterministic check by nature — it is a database lookup, and asking a
 * model whether two strings are equal would be both slower and less reliable.
 */
export function findDuplicateMetadata(articleId: number, metadata: SeoMetadata): DuplicateMetadataHit[] {
  const db = getDatabase();
  const hits: DuplicateMetadataHit[] = [];

  const check = (column: 'seo_title' | 'meta_description' | 'seo_slug', value: string | null) => {
    if (!value?.trim()) return;
    const rows = db
      .prepare(`
        SELECT s.article_id, a.title, a.generated_title
        FROM article_seo s
        JOIN articles a ON a.id = s.article_id
        WHERE s.article_id != ? AND LOWER(TRIM(s.${column})) = LOWER(TRIM(?))
      `)
      .all(articleId, value) as unknown as { article_id: number; title: string | null; generated_title: string | null }[];

    for (const row of rows) {
      hits.push({
        articleId: row.article_id,
        title: row.title?.trim() || row.generated_title?.trim() || `Article ${row.article_id}`,
        field: column,
      });
    }
  };

  check('seo_title', metadata.seoTitle);
  check('meta_description', metadata.metaDescription);
  check('seo_slug', metadata.seoSlug);
  return hits;
}

/** SEO summary for the cross-article SEO Review list. Reads only; changes nothing. */
export interface ArticleSeoSummary {
  articleId: number;
  displayTitle: string;
  status: string;
  targetQuery: string | null;
  searchIntent: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  score: number | null;
  readiness: string | null;
  analysedAt: string | null;
  isGenerated: boolean;
  isPushedToCms: boolean;
  blockingCount: number;
  warningCount: number;
}

export function listArticleSeoSummaries(limit = 200): ArticleSeoSummary[] {
  const db = getDatabase();
  const rows = db
    .prepare(`
      SELECT a.id, a.title, a.generated_title, a.status, a.generated_at,
             s.target_query, s.search_intent, s.seo_title, s.meta_description,
             s.latest_score, s.readiness, s.latest_analysis_id,
             r.created_at AS analysed_at,
             (SELECT COUNT(*) FROM seo_findings f
               WHERE f.analysis_id = s.latest_analysis_id AND f.severity = 'blocking' AND f.status = 'open') AS blocking_count,
             (SELECT COUNT(*) FROM seo_findings f
               WHERE f.analysis_id = s.latest_analysis_id AND f.severity = 'warning' AND f.status = 'open') AS warning_count,
             (SELECT COUNT(*) FROM article_cms_links l WHERE l.article_id = a.id) AS cms_count
      FROM articles a
      LEFT JOIN article_seo s ON s.article_id = a.id
      LEFT JOIN seo_analysis_runs r ON r.id = s.latest_analysis_id
      ORDER BY datetime(a.updated_at) DESC, a.id DESC
      LIMIT ?
    `)
    .all(limit) as unknown as Record<string, string | number | null>[];

  return rows.map((row) => ({
    articleId: Number(row.id),
    displayTitle:
      String(row.title ?? '').trim() || String(row.generated_title ?? '').trim() || `Article ${row.id}`,
    status: String(row.status ?? 'draft'),
    targetQuery: (row.target_query as string | null) ?? null,
    searchIntent: (row.search_intent as string | null) ?? null,
    seoTitle: (row.seo_title as string | null) ?? null,
    metaDescription: (row.meta_description as string | null) ?? null,
    score: row.latest_score === null || row.latest_score === undefined ? null : Number(row.latest_score),
    readiness: (row.readiness as string | null) ?? null,
    analysedAt: (row.analysed_at as string | null) ?? null,
    isGenerated: row.generated_at !== null && row.generated_at !== undefined,
    isPushedToCms: Number(row.cms_count ?? 0) > 0,
    blockingCount: Number(row.blocking_count ?? 0),
    warningCount: Number(row.warning_count ?? 0),
  }));
}
