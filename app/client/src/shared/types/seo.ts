/**
 * Mirrors the server's SEO Engine (Milestone 14).
 *
 * Two distinctions the UI has to keep visible, because the whole engine rests
 * on them:
 *
 *   - `origin` says whether Cynth computed a finding or a model judged it.
 *   - `status` on a recommendation says whether it is a suggestion, a human
 *     decision, or something actually applied.
 */

export type SearchIntent =
  | 'informational'
  | 'commercial_investigation'
  | 'transactional'
  | 'navigational'
  | 'hybrid';

export type SeoSeverity = 'blocking' | 'warning' | 'recommendation' | 'info';
export type SeoOrigin = 'deterministic' | 'ai';

export interface SeoConfiguration {
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

export interface SeoMetadata {
  seoTitle: string | null;
  metaDescription: string | null;
  seoSlug: string | null;
  canonicalUrl: string | null;
  structuredDataTypes: string[];
  structuredData: Record<string, unknown> | null;
}

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

/** Where in the article a finding applies. Every field optional — not every finding is about a passage. */
export interface SeoLocator {
  heading?: string | null;
  headingPath?: string[];
  headingLevel?: number | null;
  paragraphIndex?: number | null;
  sectionIndex?: number | null;
  startOffset?: number | null;
  endOffset?: number | null;
  excerpt?: string | null;
  field?: string | null;
}

export interface SeoFinding {
  id: number;
  analysisId: number;
  articleId: number;
  code: string;
  category: string;
  dimension: string;
  severity: SeoSeverity;
  origin: SeoOrigin;
  summary: string;
  explanation: string | null;
  recommendation: string | null;
  element: string | null;
  locator: SeoLocator | null;
  confidence: number;
  status: 'open' | 'dismissed' | 'resolved';
  createdAt: string;
}

export interface SeoRecommendation {
  id: number;
  articleId: number;
  findingId: number | null;
  analysisId: number | null;
  field: string;
  recommendation: string;
  currentValue: string | null;
  proposedValue: string | null;
  rationale: string | null;
  confidence: number | null;
  origin: SeoOrigin;
  status: 'proposed' | 'approved' | 'rejected' | 'applied';
  approvedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export interface InternalLinkOpportunity {
  id: number;
  analysisId: number | null;
  sourceArticleId: number;
  targetArticleId: number;
  targetTitle: string;
  targetSlug: string | null;
  anchorSuggestion: string | null;
  anchorFoundInSource: boolean;
  reason: string | null;
  relevance: number | null;
  confidence: number | null;
  origin: SeoOrigin;
  status: 'proposed' | 'approved' | 'rejected';
  createdAt: string;
}

export interface ExternalSourceOpportunity {
  id: number;
  analysisId: number | null;
  articleId: number;
  purpose: string | null;
  claimContext: string | null;
  sourceType: string | null;
  suggestedDomain: string | null;
  suggestedUrl: string | null;
  /** Starts, and in this milestone stays, 'unverified'. Nothing fetches URLs. */
  verificationStatus: 'unverified' | 'verified' | 'unreachable' | 'rejected';
  verifiedAt: string | null;
  verifiedRetrievalId: number | null;
  rationale: string | null;
  confidence: number | null;
  origin: SeoOrigin;
  status: 'proposed' | 'approved' | 'rejected';
  createdAt: string;
}

export interface ImageSeoRequirement {
  id: number;
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
  status: 'proposed' | 'approved' | 'rejected';
  createdAt: string;
}

export interface SeoDimensionScore {
  dimension: string;
  label: string;
  evaluated: boolean;
  score: number | null;
  weight: number;
  contribution: number | null;
  findingCount: number;
  blockingCount: number;
  warningCount: number;
  explanation: string;
}

export interface SeoScore {
  overall: number | null;
  dimensions: SeoDimensionScore[];
  coverage: number;
  notEvaluated: { dimension: string; label: string; reason: string }[];
  explanation: string;
}

export interface KeywordUsage {
  term: string;
  role: 'primary' | 'secondary' | 'semantic';
  occurrences: number;
  headingOccurrences: number;
  inTitle: boolean;
  inSeoTitle: boolean;
  inMetaDescription: boolean;
  inSlug: boolean;
  inIntroduction: boolean;
  density: number | null;
}

/** Measurements, not judgements. Density in particular is never a target. */
export interface SeoDiagnostics {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  headingCount: number;
  averageSentenceWords: number | null;
  longSentenceCount: number;
  longParagraphCount: number;
  internalLinkCount: number;
  externalLinkCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  keywordUsage: KeywordUsage[];
  estimatedReadingMinutes: number | null;
  readingSpeedWpm: number;
}

export interface StructuredDataOpportunity {
  type: string;
  label: string;
  eligible: boolean;
  rationale: string;
  metRequirements: string[];
  unmetRequirements: string[];
  recommended: boolean;
}

export interface SeoGateCriteria {
  enforceBeforePush: boolean;
  requireAnalysis: boolean;
  requireAiAnalysis: boolean;
  blockOnBlocking: boolean;
  maxWarnings: number | null;
  minScore: number | null;
  requireSeoTitle: boolean;
  requireMetaDescription: boolean;
  requireTargetQuery: boolean;
  requireCurrentAnalysis: boolean;
}

export interface SeoGateCheck {
  key: string;
  label: string;
  passed: boolean;
  enforced: boolean;
  detail: string;
}

export interface SeoGateDecision {
  articleId: number;
  ready: boolean;
  enforced: boolean;
  checks: SeoGateCheck[];
  blockingReasons: string[];
  warnings: string[];
  score: number | null;
  analysisId: number | null;
  analysedAt: string | null;
  analysisIsCurrent: boolean;
  criteria: SeoGateCriteria;
}

export interface SeoAnalysisRun {
  id: number;
  articleId: number;
  mode: 'deterministic' | 'ai' | 'combined';
  status: 'success' | 'partial' | 'failure';
  provider: string | null;
  providerType: string | null;
  model: string | null;
  costClass: string | null;
  generationMode: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  score: number | null;
  scoreBreakdown: SeoScore | null;
  contentFingerprint: string | null;
  configFingerprint: string | null;
  createdAt: string;
}

/** What an AI pass would cost and whether it is currently permitted. Contacts nothing. */
export interface SeoAiPreflight {
  taskType: string;
  provider: { name: string; providerType: string; hasApiKey: boolean } | null;
  model: {
    id: number;
    modelName: string;
    displayName: string | null;
    vendor: string | null;
    promptPrice: number | null;
    completionPrice: number | null;
    requestPrice: number | null;
    contextLength: number | null;
    pricingSyncedAt: string | null;
  } | null;
  isExplicitSelection: boolean;
  promptCharacterCount: number | null;
  promptWordCount: number | null;
  mode: 'test' | 'production';
  costClass: 'free' | 'paid' | 'unknown';
  cost: {
    costClass: string;
    currency: string | null;
    promptTokens: number | null;
    estimatedCompletionTokens: number | null;
    totalCost: number | null;
    note: string;
  } | null;
  spend: {
    allowed: boolean;
    requiresConfirmation: boolean;
    costClass: string;
    mode: string;
    reason: string | null;
  } | null;
  ready: boolean;
  issues: string[];
  configurationErrorCode: string | null;
}

export interface SeoOverview {
  articleId: number;
  hasContent: boolean;
  seo: ArticleSeoRecord;
  latestRun: SeoAnalysisRun | null;
  findings: SeoFinding[];
  recommendations: SeoRecommendation[];
  internalLinks: InternalLinkOpportunity[];
  externalSources: ExternalSourceOpportunity[];
  imageRequirements: ImageSeoRequirement[];
  structuredData: StructuredDataOpportunity[];
  diagnostics: SeoDiagnostics | null;
  score: SeoScore | null;
  gate: SeoGateDecision;
  aiPreflight: SeoAiPreflight;
  aiAnalysisIsCurrent: boolean;
  editorial: {
    projectName: string | null;
    themeName: string | null;
    topicTitle: string | null;
    authorName: string | null;
    articleTypeName: string | null;
    articleTitle: string | null;
    slug: string | null;
  };
}

export interface SeoAnalysisResult {
  articleId: number;
  run: SeoAnalysisRun;
  findings: SeoFinding[];
  recommendations: SeoRecommendation[];
  internalLinks: InternalLinkOpportunity[];
  externalSources: ExternalSourceOpportunity[];
  imageRequirements: ImageSeoRequirement[];
  structuredData: StructuredDataOpportunity[];
  score: SeoScore;
  diagnostics: SeoDiagnostics;
  gate: SeoGateDecision;
}

export interface SeoAnalysisOutcome {
  result: SeoAnalysisResult;
  /** Why the AI pass was skipped, reused, or failed. */
  aiNote: string | null;
  reusedPreviousAi: boolean;
  /** Anything the model returned that Cynth could not validate and dropped. */
  discarded: string[];
}

export interface ArticleSeoSummary {
  articleId: number;
  displayTitle: string;
  status: string;
  targetQuery: string | null;
  searchIntent: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  score: number | null;
  /** @deprecated Milestone 15 — read `seoStatus`, which every screen now shares. */
  readiness: string | null;
  /**
   * The derived SEO status (Milestone 15), from the same five-state
   * vocabulary the article panel and the Quality Gate page use. Derived
   * server-side from the SEO engine's own stored results — never a second
   * SEO system, and never a label a screen worked out for itself.
   */
  seoStatus: SeoStatusValue;
  seoStatusLabel: string;
  seoStatusDetail: string;
  /** False when the stored analysis predates an edit to the article. */
  analysisIsCurrent: boolean;
  analysedAt: string | null;
  isGenerated: boolean;
  isPushedToCms: boolean;
  blockingCount: number;
  warningCount: number;
}

/** The five states an article's SEO can be in. Mirrors the server's SEO_STATUS_META. */
export type SeoStatusValue = 'not_evaluated' | 'in_progress' | 'passed' | 'needs_attention' | 'failed';

/* ------------------------------------------------- web intelligence --- */

export interface WebSource {
  id: number;
  projectId: number | null;
  name: string;
  domain: string;
  description: string | null;
  purpose: string | null;
  isActive: boolean;
  /** Both default to false: being on the list is not consent to read the site. */
  crawlPermitted: boolean;
  searchPermitted: boolean;
  respectRobots: boolean;
  rateLimitPerMinute: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebSourceInput {
  name: string;
  domain: string;
  description?: string | null;
  purpose?: string | null;
  isActive?: boolean;
  crawlPermitted?: boolean;
  searchPermitted?: boolean;
  respectRobots?: boolean;
  rateLimitPerMinute?: number | null;
  notes?: string | null;
}

export interface WebCapabilities {
  /** False for the whole of Milestone 14: Cynth has no crawler. */
  canRetrieve: boolean;
  retrievers: { retrieverType: string; label: string }[];
  purposes: string[];
  note: string;
}

export interface BacklinkOpportunity {
  id: number;
  targetArticleId: number;
  targetArticleTitle: string;
  webSourceId: number | null;
  sourceDomain: string;
  sourceUrl: string | null;
  anchorSuggestion: string | null;
  relevance: string | null;
  authoritySignal: string | null;
  authoritySource: string | null;
  evidenceRetrievalId: number | null;
  status: 'discovered' | 'recommended' | 'approved' | 'rejected' | 'placed';
  decidedAt: string | null;
  notes: string | null;
  origin: string;
  createdAt: string;
  updatedAt: string;
}
