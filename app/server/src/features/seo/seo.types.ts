/**
 * The SEO Engine's contracts (Milestone 14).
 *
 *   Editorial Configuration -> Article Generation -> SEO Engine ->
 *   SEO Review / Optimization -> Cynth Draft -> WordPress Draft
 *
 * Three separations this file exists to make structural rather than
 * procedural:
 *
 *   1. A RECOMMENDATION (what should change), a PROPOSED CHANGE (concrete
 *      replacement text), and an APPROVED CHANGE (what a human accepted) are
 *      three different objects. Nothing can become the third by accident.
 *   2. A DETERMINISTIC finding and an AI finding are different kinds of
 *      claim, and every finding says which it is.
 *   3. A RECOMMENDED external source and a VERIFIED one are different states,
 *      and nothing in this milestone can produce the second.
 */

import type {
  SearchIntent,
  SeoCategory,
  SeoDimension,
  SeoElement,
  SeoOrigin,
  SeoSeverity,
} from './seo.constants.js';

/* ---------------------------------------------------- SEO configuration --- */

/**
 * What the article is trying to achieve in search. Entirely user-owned:
 * Cynth reads it, reasons about it, and never fills it in on the user's
 * behalf.
 *
 * Every field is optional, including the target query. An article with a
 * topic and an intent but no exact-match keyword is a completely normal
 * article, and the engine analyses it semantically rather than refusing.
 */
export interface SeoConfiguration {
  targetQuery: string | null;
  searchIntent: SearchIntent | null;
  /** Only meaningful when searchIntent is 'hybrid'. */
  secondaryIntents: string[];
  secondaryKeywords: string[];
  /** Concepts the article should cover regardless of exact wording. */
  semanticTopics: string[];
  targetAudience: string | null;
  /** Null is a real answer: many articles have no geographic target. */
  geoTarget: string | null;
  seoObjectives: string | null;
  notes: string | null;
}

/**
 * The SEO metadata Cynth holds for an article, separate from its content.
 *
 * `seoTitle` is deliberately distinct from the article's H1/editorial title,
 * and `seoSlug` from the article's own slug: a SERP headline and a page
 * headline are different jobs, and a published URL must stay stable while an
 * editorial title is still being revised.
 */
export interface SeoMetadata {
  seoTitle: string | null;
  metaDescription: string | null;
  seoSlug: string | null;
  canonicalUrl: string | null;
  /** Schema types a human accepted for this article. */
  structuredDataTypes: string[];
  /** The structured-data document itself, when one has been accepted. */
  structuredData: Record<string, unknown> | null;
}

/* ------------------------------------------------------------- findings --- */

/**
 * PASSAGE-LEVEL ANCHOR.
 *
 * The difference between "improve your article" and "this paragraph, under
 * this heading, and here is the sentence". Every field is optional because
 * not every finding is about a passage — a missing meta description has no
 * paragraph — but a finding that CAN point somewhere must.
 */
export interface SeoLocator {
  /** The heading the passage sits under, verbatim. */
  heading?: string | null;
  /** Full heading path, outermost first, e.g. ['Choosing a pack', 'Fit']. */
  headingPath?: string[];
  headingLevel?: number | null;
  /** Zero-based index of the paragraph within the article body. */
  paragraphIndex?: number | null;
  /** Zero-based index of the section (a heading and everything under it). */
  sectionIndex?: number | null;
  /** Character offsets into the analysed body, when known. */
  startOffset?: number | null;
  endOffset?: number | null;
  /** A short verbatim quote, so the user can find the passage by eye. */
  excerpt?: string | null;
  /** The metadata field a finding is about, when it is not about the body. */
  field?: string | null;
}

/**
 * One structured SEO finding.
 *
 * Structured rather than prose so that the same object can drive the UI, the
 * score, and the gate without any of them re-parsing English.
 */
export interface SeoFinding {
  /** Stable machine code, e.g. 'meta_description_missing'. */
  code: string;
  category: SeoCategory;
  dimension: SeoDimension;
  severity: SeoSeverity;
  origin: SeoOrigin;
  /** One line, stated as a fact about the article. */
  summary: string;
  /** Why it matters, in the article's own context. */
  explanation: string | null;
  /** What to do about it. Advice — never applied automatically. */
  recommendation: string | null;
  element: SeoElement | null;
  locator: SeoLocator | null;
  /**
   * 0..1. Deterministic findings are 1 by definition — a missing meta
   * description is not a matter of degree. AI findings carry the model's own
   * stated confidence, and the score weights their penalty by it.
   */
  confidence: number;
}

/** A finding as stored, with its identity and review state. */
export interface StoredSeoFinding extends SeoFinding {
  id: number;
  analysisId: number;
  articleId: number;
  status: 'open' | 'dismissed' | 'resolved';
  createdAt: string;
}

/* ------------------------------------------------------ recommendations --- */

/**
 * Which SEO field a proposal targets.
 *
 * `content` and `heading` exist so the model can propose body changes — but
 * see SeoRecommendation.status: nothing in this milestone applies one. The
 * field is here so that when autonomous editing arrives, the approval record
 * it needs already exists.
 */
export type SeoRecommendationField =
  | 'seo_title'
  | 'meta_description'
  | 'seo_slug'
  | 'canonical_url'
  | 'structured_data'
  | 'heading'
  | 'content'
  | 'image_alt'
  | 'internal_link'
  | 'external_link';

/**
 * Recommendation -> Proposed Change -> Approved Change, in one row.
 *
 * `recommendation` is what Cynth thinks should change. `proposedValue` is the
 * concrete text it suggests, and may be null — advice without a replacement
 * is still legitimate advice. `status` records what the human decided, and is
 * the ONLY thing that turns a suggestion into something Cynth may act on.
 */
export interface SeoRecommendation {
  id: number;
  articleId: number;
  findingId: number | null;
  analysisId: number | null;
  field: SeoRecommendationField;
  recommendation: string;
  /** What the field held when the proposal was made. */
  currentValue: string | null;
  proposedValue: string | null;
  rationale: string | null;
  confidence: number | null;
  origin: SeoOrigin;
  /**
   * 'proposed'  — Cynth suggested it.
   * 'approved'  — the user accepted it. For metadata fields this writes the
   *               value into SEO metadata; for body fields it records the
   *               decision and changes nothing, because Cynth has no editor.
   * 'rejected'  — the user declined it.
   * 'applied'   — the approved value is now live in the field it targets.
   */
  status: 'proposed' | 'approved' | 'rejected' | 'applied';
  approvedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
}

/* ----------------------------------------------------------------- links --- */

/**
 * One internal link opportunity between two Cynth articles.
 *
 * `targetArticleId` is a real article id, always. There is no shape in this
 * type for a link to a page Cynth does not hold, so the engine cannot propose
 * one — which is the whole point.
 */
export interface InternalLinkOpportunity {
  id: number;
  analysisId: number | null;
  sourceArticleId: number;
  targetArticleId: number;
  targetTitle: string;
  targetSlug: string | null;
  anchorSuggestion: string | null;
  /** Whether that anchor text genuinely appears in the source article. */
  anchorFoundInSource: boolean;
  reason: string | null;
  relevance: number | null;
  confidence: number | null;
  origin: SeoOrigin;
  status: 'proposed' | 'approved' | 'rejected';
  createdAt: string;
}

/**
 * An external source that would strengthen the article.
 *
 * The verification state is the point of this type. `verificationStatus`
 * starts 'unverified' and nothing in this milestone can change it, because
 * nothing in this milestone fetches a URL. A suggestion is never presented as
 * a checked source.
 */
export interface ExternalSourceOpportunity {
  id: number;
  analysisId: number | null;
  articleId: number;
  purpose: 'authority' | 'evidence' | 'factual_support' | 'reader_usefulness' | null;
  /** The passage that would benefit, so the suggestion is anchored to the text. */
  claimContext: string | null;
  /** What kind of source would serve, e.g. "a national meteorological service". */
  sourceType: string | null;
  suggestedDomain: string | null;
  /** Stored verbatim if one was named. Never dereferenced, never presented as checked. */
  suggestedUrl: string | null;
  verificationStatus: 'unverified' | 'verified' | 'unreachable' | 'rejected';
  verifiedAt: string | null;
  verifiedRetrievalId: number | null;
  rationale: string | null;
  confidence: number | null;
  origin: SeoOrigin;
  status: 'proposed' | 'approved' | 'rejected';
  createdAt: string;
}

/* ---------------------------------------------------------------- images --- */

/**
 * SEO requirements for one image. Requirements only — this milestone creates
 * no images and invents no image URLs. `existingSource` is set when the
 * requirement describes an image already present in the article body.
 */
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

/* --------------------------------------------------------------- scoring --- */

/**
 * One dimension's contribution to the score.
 *
 * `evaluated` is what keeps the score honest: a dimension only a model can
 * judge, in an analysis where no model ran, is reported as not evaluated and
 * excluded from the weighted average entirely. It is neither credited nor
 * penalised.
 */
export interface SeoDimensionScore {
  dimension: SeoDimension;
  label: string;
  evaluated: boolean;
  /** 0-100, or null when not evaluated. */
  score: number | null;
  weight: number;
  /** How much this dimension contributed to the overall score, in points. */
  contribution: number | null;
  findingCount: number;
  blockingCount: number;
  warningCount: number;
  /** Plain-language account of how this dimension reached its score. */
  explanation: string;
}

/**
 * The overall SEO readiness score and everything needed to justify it.
 *
 * `coverage` states what fraction of the weighting was actually evaluated, so
 * a 78 from a deterministic-only run can never be mistaken for a 78 from a
 * full analysis.
 */
export interface SeoScore {
  /** 0-100. Null only when nothing at all could be evaluated. */
  overall: number | null;
  dimensions: SeoDimensionScore[];
  /** Share of total weight that was actually evaluated, 0..1. */
  coverage: number;
  /** Which dimensions were skipped, and why. */
  notEvaluated: { dimension: SeoDimension; label: string; reason: string }[];
  /** One paragraph explaining the number, assembled from the dimensions. */
  explanation: string;
}

/* ------------------------------------------------------------------ gate --- */

/**
 * The configurable criteria that decide whether an article may be handed to
 * the CMS. Stored in application settings, editable by the user.
 */
export interface SeoGateCriteria {
  /** Whether the gate is consulted at all before a CMS push. */
  enforceBeforePush: boolean;
  /** Whether an article must have been analysed at all. */
  requireAnalysis: boolean;
  /** Whether an AI-assisted pass is required, not just the deterministic one. */
  requireAiAnalysis: boolean;
  /** Whether any open blocking finding stops the push. */
  blockOnBlocking: boolean;
  /** Maximum open warnings allowed. Null = unlimited. */
  maxWarnings: number | null;
  /** Minimum overall score. Null = no minimum — a perfect score is never required. */
  minScore: number | null;
  requireSeoTitle: boolean;
  requireMetaDescription: boolean;
  requireTargetQuery: boolean;
  /** Whether the analysis must describe the article as it stands now. */
  requireCurrentAnalysis: boolean;
}

/** One criterion's verdict, so the user can see exactly which rule decided. */
export interface SeoGateCheck {
  key: string;
  label: string;
  /** True when the criterion is satisfied; false when it blocks. */
  passed: boolean;
  /** True when the criterion is switched off, in which case it neither passes nor blocks. */
  enforced: boolean;
  detail: string;
}

/**
 * Whether an article is SEO-ready, and why.
 *
 * `ready` is never a bare boolean in the UI: `checks` carries the reason for
 * every criterion, satisfied or not, so "not ready" is always actionable.
 */
export interface SeoGateDecision {
  articleId: number;
  ready: boolean;
  /** Set when the gate is switched off entirely — ready, but say so. */
  enforced: boolean;
  checks: SeoGateCheck[];
  blockingReasons: string[];
  warnings: string[];
  score: number | null;
  analysisId: number | null;
  analysedAt: string | null;
  /** True when the stored analysis describes the article's current content. */
  analysisIsCurrent: boolean;
  criteria: SeoGateCriteria;
}

/* ------------------------------------------------------------- analysis --- */

/** One recorded analysis attempt. */
export interface SeoAnalysisRun {
  id: number;
  articleId: number;
  mode: 'deterministic' | 'ai' | 'combined';
  /** 'partial' means deterministic succeeded and the AI pass did not. */
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

/**
 * Structured-data eligibility for one schema type.
 *
 * `eligible` is only true when the requirements are actually met by data
 * Cynth holds. `unmetRequirements` names what is missing, so an ineligible
 * type is a to-do rather than a dead end — and so Cynth never claims
 * eligibility it cannot support.
 */
export interface StructuredDataOpportunity {
  type: string;
  label: string;
  eligible: boolean;
  rationale: string;
  metRequirements: string[];
  unmetRequirements: string[];
  /** True when the article type or content suggests this schema is worth having. */
  recommended: boolean;
}

/** Everything an SEO analysis produces, in one object. */
export interface SeoAnalysisResult {
  articleId: number;
  run: SeoAnalysisRun;
  findings: StoredSeoFinding[];
  recommendations: SeoRecommendation[];
  internalLinks: InternalLinkOpportunity[];
  externalSources: ExternalSourceOpportunity[];
  imageRequirements: ImageSeoRequirement[];
  structuredData: StructuredDataOpportunity[];
  score: SeoScore;
  /** Diagnostics — reported, never scored. Keyword density lives here. */
  diagnostics: SeoDiagnostics;
  gate: SeoGateDecision;
}

/**
 * Measurements, not judgements.
 *
 * Keyword density in particular is here rather than among the findings: it is
 * a number about the text, it is never a target, and nothing in the scoring
 * model reads it except the single overuse rule.
 */
export interface SeoDiagnostics {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  headingCount: number;
  /** Average words per sentence. A description of the prose, not a grade. */
  averageSentenceWords: number | null;
  longSentenceCount: number;
  longParagraphCount: number;
  internalLinkCount: number;
  externalLinkCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  /**
   * Occurrences and density for the target query and each secondary term.
   * DIAGNOSTIC ONLY — Cynth has no target density and rewards no figure here.
   */
  keywordUsage: KeywordUsage[];
  /** Reading time at a stated words-per-minute, so the assumption is visible. */
  estimatedReadingMinutes: number | null;
  readingSpeedWpm: number;
}

export interface KeywordUsage {
  term: string;
  role: 'primary' | 'secondary' | 'semantic';
  /** Exact-phrase occurrences in the body. */
  occurrences: number;
  /** Occurrences in headings, which is where placement actually matters. */
  headingOccurrences: number;
  inTitle: boolean;
  inSeoTitle: boolean;
  inMetaDescription: boolean;
  inSlug: boolean;
  inIntroduction: boolean;
  /** occurrences / wordCount. Reported to be read, never to be hit. */
  density: number | null;
}
