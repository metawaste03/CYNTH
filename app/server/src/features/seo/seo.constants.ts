/**
 * The SEO Engine's vocabulary (Milestone 14).
 *
 * Everything the engine can say about an article is drawn from the lists in
 * this file, so a finding is always classifiable, scoreable and gateable. New
 * checks add codes; they do not add ad-hoc categories.
 */

/* ------------------------------------------------------------- intent --- */

/**
 * Search intent. `hybrid` is a first-class value rather than a fudge: real
 * queries routinely sit between informational and commercial, and forcing one
 * label would make the intent-alignment check dishonest.
 */
export const SEARCH_INTENTS = [
  'informational',
  'commercial_investigation',
  'transactional',
  'navigational',
  'hybrid',
] as const;

export type SearchIntent = (typeof SEARCH_INTENTS)[number];

export function isValidSearchIntent(value: unknown): value is SearchIntent {
  return typeof value === 'string' && (SEARCH_INTENTS as readonly string[]).includes(value);
}

/** Human labels for the UI and for prompts. */
export const SEARCH_INTENT_LABELS: Record<SearchIntent, string> = {
  informational: 'Informational',
  commercial_investigation: 'Commercial investigation',
  transactional: 'Transactional',
  navigational: 'Navigational',
  hybrid: 'Hybrid',
};

/* --------------------------------------------------------- dimensions --- */

/**
 * The scoring dimensions. Each is scored independently and reported
 * separately — the overall score is a summary of these, never a substitute
 * for them.
 *
 * The weights are Cynth's, not a standard: they are stated here so the score
 * can explain itself, and so changing the emphasis is one edit.
 */
export const SEO_DIMENSIONS = [
  'search_intent',
  'content_relevance',
  'topical_coverage',
  'on_page',
  'structure',
  'readability',
  'internal_linking',
  'external_authority',
  'technical_metadata',
  /**
   * Whether an AI search engine can lift an answer out of this article and
   * attribute it (Milestone 34).
   *
   * A separate dimension rather than more readability checks, because it
   * rewards something classic SEO does not: a passage that survives being
   * extracted from its own page. A well-structured article can score well
   * everywhere else and still be unquotable.
   */
  'ai_search',
] as const;

export type SeoDimension = (typeof SEO_DIMENSIONS)[number];

export const SEO_DIMENSION_LABELS: Record<SeoDimension, string> = {
  search_intent: 'Search intent',
  content_relevance: 'Content relevance',
  topical_coverage: 'Topical coverage',
  on_page: 'On-page SEO',
  structure: 'Structure',
  readability: 'Readability',
  internal_linking: 'Internal linking',
  external_authority: 'External authority',
  technical_metadata: 'Technical metadata',
  ai_search: 'AI search readiness',
};

/**
 * The weights sum to 100, and adding a dimension means taking the weight from
 * somewhere rather than diluting everything by arithmetic.
 *
 * `ai_search` is funded by the four dimensions whose concerns it partly
 * overlaps — on-page, topical coverage, structure and readability — so an
 * article's score does not lurch simply because a new dimension exists.
 */
export const SEO_DIMENSION_WEIGHTS: Record<SeoDimension, number> = {
  search_intent: 15,
  content_relevance: 12,
  topical_coverage: 13,
  on_page: 13,
  structure: 11,
  readability: 9,
  internal_linking: 8,
  external_authority: 5,
  technical_metadata: 8,
  ai_search: 6,
};

/**
 * Which dimensions only a model can judge.
 *
 * Recorded explicitly so a deterministic-only analysis reports them as
 * NOT EVALUATED rather than scoring them out of thin air. An unexamined
 * dimension scored 100 would be a lie, and scored 0 would be a different one.
 */
export const AI_ONLY_DIMENSIONS: readonly SeoDimension[] = [
  'search_intent',
  'content_relevance',
  'topical_coverage',
];

export function isValidDimension(value: unknown): value is SeoDimension {
  return typeof value === 'string' && (SEO_DIMENSIONS as readonly string[]).includes(value);
}

/* --------------------------------------------------------- severities --- */

/**
 * Severity, ordered by how much attention it demands.
 *
 * These map directly onto the SEO gate: `blocking` is what stops a push,
 * `warning` is what the gate can be configured to count, `recommendation` is
 * advice, and `info` is diagnostic output that must never affect the score.
 */
export const SEO_SEVERITIES = ['blocking', 'warning', 'recommendation', 'info'] as const;

export type SeoSeverity = (typeof SEO_SEVERITIES)[number];

export function isValidSeverity(value: unknown): value is SeoSeverity {
  return typeof value === 'string' && (SEO_SEVERITIES as readonly string[]).includes(value);
}

/**
 * How much each severity costs its dimension, out of 100.
 *
 * `info` costs nothing by definition — a diagnostic is an observation, not a
 * fault, and keyword density in particular must never move a score.
 */
export const SEVERITY_PENALTY: Record<SeoSeverity, number> = {
  blocking: 35,
  warning: 15,
  recommendation: 6,
  info: 0,
};

/* --------------------------------------------------------- categories --- */

/** What a finding is about. Broader than `element`, which says where it applies. */
export const SEO_CATEGORIES = [
  'search_intent',
  'title',
  'meta_description',
  'slug',
  'headings',
  'content_depth',
  'topical_coverage',
  'keywords',
  'introduction',
  'conclusion',
  'internal_links',
  'external_links',
  'images',
  'readability',
  'structured_data',
  /**
   * Whether a product landed somewhere the surrounding content actually leads
   * into (Milestone 18). Reviewed, never enforced — the author's placement
   * stands unless a human moves it.
   */
  'product_placement',
  /**
   * Whether a passage can be quoted on its own (Milestone 34). Deterministic:
   * length, opening, and whether it depends on text above it.
   */
  'citability',
  /**
   * First-hand experience, named expertise and attributed claims — the
   * signals an AI answer engine uses to decide whether to trust a page.
   * Semantic, so this one is the model's judgement.
   */
  'experience_signals',
  'configuration',
] as const;

export type SeoCategory = (typeof SEO_CATEGORIES)[number];

export function isValidCategory(value: unknown): value is SeoCategory {
  return typeof value === 'string' && (SEO_CATEGORIES as readonly string[]).includes(value);
}

/** Which part of the article a finding points at. Drives the passage-level UI. */
export const SEO_ELEMENTS = [
  'title',
  'seo_title',
  'meta_description',
  'slug',
  'heading',
  'introduction',
  'section',
  'paragraph',
  'body',
  'images',
  'links',
  'structured_data',
  'config',
] as const;

export type SeoElement = (typeof SEO_ELEMENTS)[number];

/** Where a claim came from. Deterministic and AI judgements are never blended. */
export type SeoOrigin = 'deterministic' | 'ai';

/* ------------------------------------------------------ SERP heuristics --- */

/**
 * Approximate SERP limits.
 *
 * Deliberately called "approximate" everywhere they surface: search engines
 * truncate by pixel width, not character count, and the width depends on the
 * characters used. These are a guide to obvious over- and under-shooting, not
 * a target to optimise against.
 */
export const SEO_TITLE_MIN_CHARS = 25;
export const SEO_TITLE_MAX_CHARS = 60;
export const META_DESCRIPTION_MIN_CHARS = 70;
export const META_DESCRIPTION_MAX_CHARS = 160;

/** Slug shape. Long, multi-word slugs are harder to read and to keep stable. */
export const SLUG_MAX_CHARS = 75;
export const SLUG_MAX_WORDS = 8;

/**
 * Readability thresholds.
 *
 * These are diagnostics tuned to catch structural extremes — a 90-word
 * sentence, a 1,200-character paragraph — not to push prose toward a reading
 * grade. The author persona decides what register is correct; Cynth does not.
 */
/* ------------------------------------------------- AI search heuristics --- */

/**
 * The passage band an AI answer engine can lift whole.
 *
 * Published guidance clusters around 134-167 words for a citable passage: long
 * enough to answer, short enough to quote. Like the SERP limits above these
 * are a guide to obvious over- and under-shooting, not a target to write to —
 * so only sections WELL outside the band are reported, and the band itself is
 * never presented as a rule.
 */
export const CITABLE_PASSAGE_MIN_WORDS = 134;
export const CITABLE_PASSAGE_MAX_WORDS = 167;

/** Below this a section cannot answer anything on its own. */
export const THIN_SECTION_WORDS = 60;

/** Above this the answer is buried too deep in the section to be extracted. */
export const BURIED_SECTION_WORDS = 350;

/**
 * How far into a section the direct answer should appear.
 *
 * An answer engine reads the opening of a section and stops. A section that
 * spends its first sentences setting up context has already lost.
 */
export const DIRECT_ANSWER_WORDS = 60;

export const LONG_SENTENCE_WORDS = 40;
export const VERY_LONG_SENTENCE_WORDS = 60;
export const LONG_PARAGRAPH_CHARS = 900;
export const LONG_PARAGRAPH_SENTENCES = 7;
/** How far a reader can travel with no heading, list or break before scanning gets hard. */
export const UNBROKEN_SECTION_CHARS = 2200;

/**
 * Keyword density above which repetition looks mechanical.
 *
 * Density is reported as a DIAGNOSTIC everywhere. There is no target density
 * in Cynth and no finding rewards hitting one; this threshold exists solely
 * to catch overuse, which is a real editorial problem.
 */
export const KEYWORD_OVERUSE_DENSITY = 0.03;

/** The Model Router purpose SEO analysis routes through. Already in MODEL_PURPOSES. */
export const SEO_ANALYSIS_TASK = 'seo_review';

/**
 * Words that carry no meaning in a slug or a heading. Used only to explain
 * why a slug is longer than it needs to be — never to rewrite one silently.
 */
export const SLUG_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'how',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'then', 'there',
  'these', 'they', 'this', 'to', 'was', 'were', 'what', 'when', 'which', 'who', 'why', 'will',
  'with', 'you', 'your',
]);

/**
 * Headings that describe a document rather than its content.
 *
 * A heading called "Introduction" tells a reader nothing about what the
 * section says. Flagged as a recommendation, never as a fault — some article
 * types legitimately use them.
 */
export const GENERIC_HEADINGS = new Set([
  'introduction', 'intro', 'overview', 'conclusion', 'summary', 'final thoughts',
  'wrapping up', 'in conclusion', 'the basics', 'background', 'details', 'more',
  'other', 'miscellaneous', 'notes', 'body', 'content', 'section',
]);
