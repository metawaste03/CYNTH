import { getDatabase } from '../../shared/database/index.js';
import type { BacklinkOpportunityRow, WebFindingRow, WebRetrievalRow, WebSourceRow } from '../../shared/database/types.js';
import type {
  AttributedWebFinding,
  BacklinkOpportunity,
  WebFinding,
  WebFindingType,
  WebRetrieval,
  WebSource,
  WebSourcePurpose,
} from './webIntelligence.types.js';

/**
 * Web intelligence persistence (Milestone 14).
 *
 * Two halves with very different status:
 *
 *   - WEB SOURCES and BACKLINK OPPORTUNITIES are live. The user can configure
 *     authorised domains and record backlink opportunities, and both have
 *     working approval workflows.
 *   - RETRIEVALS and FINDINGS are the future half. The functions exist so the
 *     provenance chain is testable and so a retriever has somewhere to write,
 *     but nothing in Cynth calls the create paths: there is no crawler.
 *
 * The invariant that survives either way: a finding cannot be created without
 * a retrieval, and a retrieval cannot be created without an authorised
 * source. Both are enforced here as well as by the foreign keys, so a bug in
 * a future retriever produces an error rather than an unattributed claim.
 */

/* ------------------------------------------------------------ sources --- */

function mapSource(row: WebSourceRow): WebSource {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    domain: row.domain,
    description: row.description,
    purpose: (row.purpose as WebSourcePurpose | null) ?? null,
    isActive: row.is_active === 1,
    crawlPermitted: row.crawl_permitted === 1,
    searchPermitted: row.search_permitted === 1,
    respectRobots: row.respect_robots === 1,
    rateLimitPerMinute: row.rate_limit_per_minute,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Reduces whatever the user typed to a bare host.
 *
 * A source is a DOMAIN, not a URL: storing "https://example.org/blog?x=1"
 * would let a permission be granted for a path and then silently applied to
 * the whole site. Normalising here means the permission always means what it
 * appears to mean.
 */
export function normaliseDomain(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.replace(/^www\./, '');
  value = value.split('/')[0];
  value = value.split('?')[0];
  value = value.split('#')[0];
  // Strip a port: a permission is about a site, not a socket.
  value = value.replace(/:\d+$/, '');
  return value;
}

export interface WebSourceInput {
  projectId: number | null;
  name: string;
  domain: string;
  description: string | null;
  purpose: WebSourcePurpose | null;
  isActive: boolean;
  crawlPermitted: boolean;
  searchPermitted: boolean;
  respectRobots: boolean;
  rateLimitPerMinute: number | null;
  notes: string | null;
}

export function listWebSources(options: { activeOnly?: boolean } = {}): WebSource[] {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT * FROM web_sources ${options.activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY domain ASC`)
    .all() as unknown as WebSourceRow[];
  return rows.map(mapSource);
}

export function getWebSource(id: number): WebSource | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM web_sources WHERE id = ?').get(id) as unknown as WebSourceRow | undefined;
  return row ? mapSource(row) : null;
}

export function getWebSourceByDomain(domain: string): WebSource | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM web_sources WHERE domain = ?').get(normaliseDomain(domain)) as unknown as
    | WebSourceRow
    | undefined;
  return row ? mapSource(row) : null;
}

export function createWebSource(input: WebSourceInput): WebSource {
  const db = getDatabase();
  const result = db
    .prepare(`
      INSERT INTO web_sources (
        project_id, name, domain, description, purpose, is_active,
        crawl_permitted, search_permitted, respect_robots, rate_limit_per_minute, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.projectId,
      input.name,
      normaliseDomain(input.domain),
      input.description,
      input.purpose,
      input.isActive ? 1 : 0,
      input.crawlPermitted ? 1 : 0,
      input.searchPermitted ? 1 : 0,
      input.respectRobots ? 1 : 0,
      input.rateLimitPerMinute,
      input.notes,
    );
  return getWebSource(Number(result.lastInsertRowid))!;
}

export function updateWebSource(id: number, input: WebSourceInput): WebSource | null {
  const db = getDatabase();
  const result = db
    .prepare(`
      UPDATE web_sources SET
        project_id = ?, name = ?, domain = ?, description = ?, purpose = ?, is_active = ?,
        crawl_permitted = ?, search_permitted = ?, respect_robots = ?, rate_limit_per_minute = ?,
        notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    .run(
      input.projectId,
      input.name,
      normaliseDomain(input.domain),
      input.description,
      input.purpose,
      input.isActive ? 1 : 0,
      input.crawlPermitted ? 1 : 0,
      input.searchPermitted ? 1 : 0,
      input.respectRobots ? 1 : 0,
      input.rateLimitPerMinute,
      input.notes,
      id,
    );
  if (result.changes === 0) return null;
  return getWebSource(id);
}

export function deleteWebSource(id: number): boolean {
  const db = getDatabase();
  return db.prepare('DELETE FROM web_sources WHERE id = ?').run(id).changes > 0;
}

/**
 * Whether a source currently authorises a given action.
 *
 * The single question a future retriever must ask before every request. It
 * checks the source is active AND that the specific permission is granted —
 * being on the list is not consent to read it.
 */
export function isSourceAuthorised(source: WebSource, action: 'crawl' | 'search'): { permitted: boolean; reason: string } {
  if (!source.isActive) {
    return { permitted: false, reason: `The source ${source.domain} is inactive.` };
  }
  if (action === 'crawl' && !source.crawlPermitted) {
    return { permitted: false, reason: `Crawling is not permitted for ${source.domain}.` };
  }
  if (action === 'search' && !source.searchPermitted) {
    return { permitted: false, reason: `Searching is not permitted for ${source.domain}.` };
  }
  return { permitted: true, reason: `${source.domain} permits ${action}.` };
}

/* --------------------------------------------------------- retrievals --- */

function mapRetrieval(row: WebRetrievalRow): WebRetrieval {
  return {
    id: row.id,
    webSourceId: row.web_source_id,
    url: row.url,
    httpStatus: row.http_status,
    retrievedAt: row.retrieved_at,
    contentType: row.content_type,
    contentHash: row.content_hash,
    title: row.title,
    retrievalMethod: row.retrieval_method,
    robotsAllowed: row.robots_allowed === null ? null : row.robots_allowed === 1,
    notes: row.notes,
  };
}

export interface RetrievalInput {
  webSourceId: number;
  url: string;
  httpStatus: number | null;
  contentType: string | null;
  contentHash: string | null;
  title: string | null;
  retrievalMethod: string | null;
  /** Null means robots.txt was not checked — recorded honestly rather than assumed. */
  robotsAllowed: boolean | null;
  notes: string | null;
}

/**
 * Records one retrieval.
 *
 * Nothing in Milestone 14 calls this: Cynth has no retriever. It exists so
 * the provenance chain can be built and tested, and it refuses a retrieval
 * whose source does not exist — a fetch Cynth was never authorised to make
 * cannot be recorded as though it were.
 */
export function recordRetrieval(input: RetrievalInput): WebRetrieval {
  const source = getWebSource(input.webSourceId);
  if (!source) {
    throw new Error('A retrieval must belong to a configured web source.');
  }

  const db = getDatabase();
  const result = db
    .prepare(`
      INSERT INTO web_retrievals (
        web_source_id, url, http_status, content_type, content_hash, title,
        retrieval_method, robots_allowed, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.webSourceId,
      input.url,
      input.httpStatus,
      input.contentType,
      input.contentHash,
      input.title,
      input.retrievalMethod,
      input.robotsAllowed === null ? null : input.robotsAllowed ? 1 : 0,
      input.notes,
    );

  return getRetrieval(Number(result.lastInsertRowid))!;
}

export function getRetrieval(id: number): WebRetrieval | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM web_retrievals WHERE id = ?').get(id) as unknown as
    | WebRetrievalRow
    | undefined;
  return row ? mapRetrieval(row) : null;
}

export function listRetrievalsForSource(webSourceId: number, limit = 50): WebRetrieval[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM web_retrievals WHERE web_source_id = ? ORDER BY id DESC LIMIT ?')
    .all(webSourceId, limit) as unknown as WebRetrievalRow[];
  return rows.map(mapRetrieval);
}

/* ------------------------------------------------------------ findings --- */

function mapFinding(row: WebFindingRow): WebFinding {
  return {
    id: row.id,
    retrievalId: row.retrieval_id,
    webSourceId: row.web_source_id,
    url: row.url,
    topic: row.topic,
    findingType: (row.finding_type as WebFindingType | null) ?? null,
    insight: row.insight,
    seoRelevance: row.seo_relevance,
    confidence: row.confidence,
    citation: row.citation,
    extractionMethod: row.extraction_method,
    extractionModel: row.extraction_model,
    extractedAt: row.extracted_at,
    status: row.status as WebFinding['status'],
  };
}

export interface WebFindingInput {
  retrievalId: number;
  topic: string | null;
  findingType: WebFindingType | null;
  insight: string;
  seoRelevance: string | null;
  confidence: number | null;
  citation: string | null;
  extractionMethod: string | null;
  extractionModel: string | null;
}

/**
 * Records one extracted finding.
 *
 * PROVENANCE IS ENFORCED HERE. The source id and the URL are read from the
 * retrieval rather than accepted from the caller, so a finding can never
 * claim to come from somewhere it did not. A finding whose retrieval does not
 * exist is refused outright.
 *
 * Nothing in Milestone 14 calls this. There is no crawler, so there is
 * nothing to extract from.
 */
export function recordWebFinding(input: WebFindingInput): WebFinding {
  const retrieval = getRetrieval(input.retrievalId);
  if (!retrieval) {
    throw new Error('A web finding must be attributed to a retrieval. No retrieval, no finding.');
  }

  const db = getDatabase();
  const result = db
    .prepare(`
      INSERT INTO web_findings (
        retrieval_id, web_source_id, url, topic, finding_type, insight,
        seo_relevance, confidence, citation, extraction_method, extraction_model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      retrieval.id,
      // Read from the retrieval, never from the caller.
      retrieval.webSourceId,
      retrieval.url,
      input.topic,
      input.findingType,
      input.insight,
      input.seoRelevance,
      input.confidence,
      input.citation,
      input.extractionMethod,
      input.extractionModel,
    );

  return getWebFinding(Number(result.lastInsertRowid))!;
}

export function getWebFinding(id: number): WebFinding | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM web_findings WHERE id = ?').get(id) as unknown as WebFindingRow | undefined;
  return row ? mapFinding(row) : null;
}

interface AttributedRow extends WebFindingRow {
  source_name: string;
  source_domain: string;
  retrieved_at: string;
  http_status: number | null;
  content_hash: string | null;
}

/**
 * Findings with their full provenance chain resolved.
 *
 * This is the shape a future generation context would consume: an insight
 * that arrives together with the site it came from, the exact URL, when it
 * was retrieved, and the hash of what was read. An insight without that chain
 * is not returned by any function in this module.
 */
export function listAttributedFindings(options: { topic?: string; limit?: number } = {}): AttributedWebFinding[] {
  const db = getDatabase();
  const where = options.topic ? 'WHERE f.topic = ?' : '';
  const params: unknown[] = options.topic ? [options.topic, options.limit ?? 50] : [options.limit ?? 50];

  const rows = db
    .prepare(`
      SELECT f.*, s.name AS source_name, s.domain AS source_domain,
             r.retrieved_at, r.http_status, r.content_hash
      FROM web_findings f
      JOIN web_retrievals r ON r.id = f.retrieval_id
      JOIN web_sources s ON s.id = f.web_source_id
      ${where}
      ORDER BY f.id DESC LIMIT ?
    `)
    .all(...(params as never[])) as unknown as AttributedRow[];

  return rows.map((row) => ({
    ...mapFinding(row),
    source: { id: row.web_source_id, name: row.source_name, domain: row.source_domain },
    retrieval: {
      url: row.url,
      retrievedAt: row.retrieved_at,
      httpStatus: row.http_status,
      contentHash: row.content_hash,
    },
  }));
}

/* ---------------------------------------------------------- backlinks --- */

interface BacklinkRow extends BacklinkOpportunityRow {
  article_title: string | null;
  article_generated_title: string | null;
}

function mapBacklink(row: BacklinkRow): BacklinkOpportunity {
  return {
    id: row.id,
    targetArticleId: row.target_article_id,
    targetArticleTitle:
      row.article_title?.trim() || row.article_generated_title?.trim() || `Article ${row.target_article_id}`,
    webSourceId: row.web_source_id,
    sourceDomain: row.source_domain,
    sourceUrl: row.source_url,
    anchorSuggestion: row.anchor_suggestion,
    relevance: row.relevance,
    authoritySignal: row.authority_signal,
    authoritySource: row.authority_source,
    evidenceRetrievalId: row.evidence_retrieval_id,
    status: row.status as BacklinkOpportunity['status'],
    decidedAt: row.decided_at,
    notes: row.notes,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface BacklinkInput {
  targetArticleId: number;
  webSourceId: number | null;
  sourceDomain: string;
  sourceUrl: string | null;
  anchorSuggestion: string | null;
  relevance: string | null;
  /** Only set where a real signal exists — and then authoritySource must say where it came from. */
  authoritySignal: string | null;
  authoritySource: string | null;
  evidenceRetrievalId: number | null;
  notes: string | null;
  origin: string;
}

const BACKLINK_SELECT = `
  SELECT b.*, a.title AS article_title, a.generated_title AS article_generated_title
  FROM backlink_opportunities b
  JOIN articles a ON a.id = b.target_article_id
`;

/**
 * Records a backlink opportunity.
 *
 * Created as 'discovered', never as 'approved': the approval is a human act
 * and the status column is how that act is recorded. `origin` defaults to
 * 'manual' because there is no discovery engine — every row in this table
 * during Milestone 14 was entered by a person.
 *
 * An authority signal without a stated source is refused. An unattributed
 * authority number is exactly the kind of made-up SEO metric this system is
 * built to avoid.
 */
export function createBacklinkOpportunity(input: BacklinkInput): BacklinkOpportunity {
  if (input.authoritySignal && !input.authoritySource) {
    throw new Error('An authority signal must state where it came from.');
  }

  const db = getDatabase();
  const result = db
    .prepare(`
      INSERT INTO backlink_opportunities (
        target_article_id, web_source_id, source_domain, source_url, anchor_suggestion,
        relevance, authority_signal, authority_source, evidence_retrieval_id, notes, origin, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered')
    `)
    .run(
      input.targetArticleId,
      input.webSourceId,
      normaliseDomain(input.sourceDomain),
      input.sourceUrl,
      input.anchorSuggestion,
      input.relevance,
      input.authoritySignal,
      input.authoritySource,
      input.evidenceRetrievalId,
      input.notes,
      input.origin,
    );

  return getBacklinkOpportunity(Number(result.lastInsertRowid))!;
}

export function getBacklinkOpportunity(id: number): BacklinkOpportunity | null {
  const db = getDatabase();
  const row = db.prepare(`${BACKLINK_SELECT} WHERE b.id = ?`).get(id) as unknown as BacklinkRow | undefined;
  return row ? mapBacklink(row) : null;
}

export function listBacklinkOpportunities(options: { articleId?: number } = {}): BacklinkOpportunity[] {
  const db = getDatabase();
  const rows = (
    options.articleId
      ? db.prepare(`${BACKLINK_SELECT} WHERE b.target_article_id = ? ORDER BY b.id DESC`).all(options.articleId)
      : db.prepare(`${BACKLINK_SELECT} ORDER BY b.id DESC`).all()
  ) as unknown as BacklinkRow[];
  return rows.map(mapBacklink);
}

/**
 * Moves an opportunity along the approval workflow.
 *
 * 'placed' records that a human put the link somewhere. Cynth does not insert
 * links into articles, so it is a record of something that happened
 * elsewhere, not something Cynth did.
 */
export function setBacklinkStatus(
  id: number,
  status: BacklinkOpportunity['status'],
): BacklinkOpportunity | null {
  const db = getDatabase();
  const result = db
    .prepare("UPDATE backlink_opportunities SET status = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
  if (result.changes === 0) return null;
  return getBacklinkOpportunity(id);
}

export function deleteBacklinkOpportunity(id: number): boolean {
  const db = getDatabase();
  return db.prepare('DELETE FROM backlink_opportunities WHERE id = ?').run(id).changes > 0;
}
