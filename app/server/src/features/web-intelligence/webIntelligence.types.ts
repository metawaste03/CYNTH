/**
 * WEB INTELLIGENCE — ARCHITECTURE ONLY (Milestone 14).
 *
 *   Web Source -> Retrieved Content -> Extracted Finding -> Knowledge / SEO
 *   Intelligence -> Generation Context
 *
 * Cynth will eventually be able to investigate websites the user has given
 * it. This milestone builds the shape that capability has to fit into, and
 * deliberately builds no crawler at all: `getRetriever()` returns null for
 * every connector type, so there is no code path from "a source is
 * configured" to "a request was made".
 *
 * Four rules the types below make structural rather than procedural:
 *
 *   1. NO UNAUTHORISED CRAWLING. A retrieval requires a WebSource, a
 *      WebSource is only ever created by the user, and both of its
 *      permissions default to off. There is no shape here for "the open
 *      internet".
 *   2. PROVENANCE IS MANDATORY. A WebFinding cannot exist without the
 *      retrieval it came from, and a retrieval cannot exist without its
 *      source and URL. "Where did this come from" is a required field, not a
 *      nice-to-have.
 *   3. NOTHING IS PRETENDED. No finding exists until something actually
 *      fetched a page. There is no seeding, no example data, and no
 *      placeholder row anywhere in this feature.
 *   4. RETRIEVAL IS NOT INGESTION. The generation contract below returns
 *      selected, cited findings — never raw page text. A future article is
 *      informed by what was learned, not by pasting a website into a prompt.
 */

/* ------------------------------------------------------------ sources --- */

/** Why a site is on the authorised list. Shapes what a future retriever would do with it. */
export type WebSourcePurpose =
  | 'research'
  | 'authority'
  | 'competitor'
  | 'backlink_target'
  | 'own_site'
  | 'other';

export const WEB_SOURCE_PURPOSES: readonly WebSourcePurpose[] = [
  'research',
  'authority',
  'competitor',
  'backlink_target',
  'own_site',
  'other',
];

/**
 * One website the user has authorised Cynth to investigate.
 *
 * `crawlPermitted` and `searchPermitted` are separate because they are
 * different permissions: reading a site's pages and querying a site's own
 * search are different intrusions, and a user may reasonably allow one and
 * not the other. Both default to false — appearing in a list is not consent.
 */
export interface WebSource {
  id: number;
  projectId: number | null;
  name: string;
  /** Host only, normalised: no scheme, no path, lowercase. */
  domain: string;
  description: string | null;
  purpose: WebSourcePurpose | null;
  isActive: boolean;
  crawlPermitted: boolean;
  searchPermitted: boolean;
  /** Whether a retriever must obey robots.txt for this source. Defaults to true. */
  respectRobots: boolean;
  /** A ceiling a future retriever must not exceed. Null means the user has set none. */
  rateLimitPerMinute: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------------------------------------- retrieval --- */

/**
 * The provenance record for one fetch.
 *
 * `robotsAllowed` is nullable on purpose: null means "not checked", which a
 * reviewer needs to be able to see. Recording it as true when nothing checked
 * would be the exact kind of comfortable fiction this architecture exists to
 * prevent.
 */
export interface WebRetrieval {
  id: number;
  webSourceId: number;
  url: string;
  httpStatus: number | null;
  retrievedAt: string;
  contentType: string | null;
  /** Hash of what was retrieved, so a finding can prove which version it came from. */
  contentHash: string | null;
  title: string | null;
  retrievalMethod: string | null;
  robotsAllowed: boolean | null;
  notes: string | null;
}

export type WebFindingType =
  | 'fact'
  | 'statistic'
  | 'definition'
  | 'entity'
  | 'question'
  | 'competitor_coverage'
  | 'other';

/**
 * One insight extracted from one retrieval.
 *
 * `retrievalId` is required. A finding without a retrieval is a claim without
 * a source, and neither the schema nor this type allows one to exist.
 */
export interface WebFinding {
  id: number;
  retrievalId: number;
  webSourceId: number;
  /** Denormalised so a citation survives even if the retrieval record is pruned. */
  url: string;
  topic: string | null;
  findingType: WebFindingType | null;
  insight: string;
  /** Why it matters for SEO, when it does. Null when the value is purely editorial. */
  seoRelevance: string | null;
  confidence: number | null;
  citation: string | null;
  extractionMethod: string | null;
  extractionModel: string | null;
  extractedAt: string;
  status: 'unreviewed' | 'accepted' | 'rejected';
}

/** A finding with its full provenance chain resolved, ready to cite. */
export interface AttributedWebFinding extends WebFinding {
  source: { id: number; name: string; domain: string };
  retrieval: { url: string; retrievedAt: string; httpStatus: number | null; contentHash: string | null };
}

/* ---------------------------------------------------------- retriever --- */

/**
 * What a future crawler/search connector must implement.
 *
 * Declared here and implemented nowhere. The registry in `retrievers/index.ts`
 * is empty, so `getRetriever()` returns null for every type and no code in
 * Cynth can currently fetch a web page. Adding the capability means adding
 * one retriever and registering it — the sources, the permissions, the
 * provenance chain, and the approval workflows are already in place.
 *
 * Note the shape of `fetch`: it takes a WebSource, not a URL. There is no
 * signature here that can retrieve something the user has not authorised.
 */
export interface WebRetriever {
  readonly retrieverType: string;
  readonly label: string;

  /**
   * Whether this source's rules permit fetching this URL, checked BEFORE any
   * request is made. An implementation must consult robots.txt when the
   * source says to, and must honour the source's rate limit.
   */
  isPermitted(source: WebSource, url: string): Promise<{ permitted: boolean; reason: string }>;

  /** Retrieves one URL from one authorised source, returning the provenance record and the content. */
  fetch(source: WebSource, url: string): Promise<{ retrieval: Omit<WebRetrieval, 'id'>; content: string }>;

  /** Enumerates candidate URLs within an authorised source. Optional — not every retriever can. */
  discover?(source: WebSource, query: string): Promise<string[]>;
}

/* -------------------------------------------------------- backlinks --- */

/**
 * One potential backlink into a Cynth article.
 *
 *   Potential Backlink -> Cynth Analysis -> Recommendation -> User Approval
 *   -> Article Link
 *
 * `status` encodes that workflow, and `approved` is not a boolean anywhere in
 * this system: a link becomes real only by passing through a human decision,
 * and 'placed' is a state a human records, not one Cynth reaches on its own.
 * Nothing in this milestone writes a link into an article.
 */
export interface BacklinkOpportunity {
  id: number;
  targetArticleId: number;
  targetArticleTitle: string;
  webSourceId: number | null;
  sourceDomain: string;
  sourceUrl: string | null;
  anchorSuggestion: string | null;
  relevance: string | null;
  /**
   * An authority indicator ONLY where a real signal exists, together with
   * where it came from. Cynth does not publish a domain-authority number it
   * cannot attribute.
   */
  authoritySignal: string | null;
  authoritySource: string | null;
  /** The retrieval that evidences this opportunity, when one exists. */
  evidenceRetrievalId: number | null;
  status: 'discovered' | 'recommended' | 'approved' | 'rejected' | 'placed';
  decidedAt: string | null;
  notes: string | null;
  /** 'manual' while there is no discovery engine; 'discovered' once there is one. */
  origin: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------- generation context --- */

/**
 * How web intelligence will eventually reach article generation.
 *
 *   Approved Web Sources -> Web Research -> Relevant Findings ->
 *   SEO / Content Intelligence -> Generation Context -> Future Article
 *
 * The important word is RETRIEVE. This contract returns selected findings
 * with their citations, not page text: the future generation prompt gains a
 * short, attributed research section, not a dump of scraped websites. That is
 * why the return type is a list of findings rather than a string.
 */
export interface WebResearchRequest {
  /** What the article is about, so retrieval can be relevant rather than exhaustive. */
  topic: string;
  targetQuery: string | null;
  /** Concepts the article needs to cover, from the SEO configuration. */
  concepts: string[];
  /** Only these authorised sources may be consulted. */
  sourceIds: number[];
  maxFindings: number;
}

export interface WebResearchResult {
  findings: AttributedWebFinding[];
  /** Sources that were consulted, and sources that were skipped and why. */
  consulted: { sourceId: number; domain: string; findingCount: number }[];
  skipped: { sourceId: number; domain: string; reason: string }[];
}

/**
 * The interface a future research service implements.
 *
 * Nothing implements it in this milestone. It is declared so the generation
 * engine can eventually depend on the contract rather than on a crawler, and
 * so the boundary — findings in, never raw pages — is fixed before any
 * implementation exists to blur it.
 */
export interface WebResearchService {
  research(request: WebResearchRequest): Promise<WebResearchResult>;
}
