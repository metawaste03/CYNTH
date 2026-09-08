import { getArticleById } from '../articles/articles.repository.js';
import type { ArticleDraftDto } from '../articles/articles.repository.js';
import { getArticleTypeById } from '../article-types/article-types.repository.js';
import { getAuthorById } from '../authors/authors.repository.js';
import { getThemeById, getTopicById } from '../content/content.repository.js';
import { listGenerationHistoryForArticle } from '../generation/generationHistory.repository.js';
import { parseSeoDocument } from '../seo/seoDocument.js';
import type { SeoDocument } from '../seo/seoDocument.js';
import { contentFingerprint } from '../seo/seoAnalysis.service.js';
import type {
  QualityCheckGroup,
  QualityCheckResult,
  QualityGateDecision,
  QualityGateStatus,
  QualitySeverity,
} from './qualityGate.types.js';

/**
 * THE QUALITY GATE — the checks themselves.
 *
 * Every check is deterministic, local, and free. Nothing here calls a model:
 * an editorial-judgement pass belongs to the `quality_review` capability and
 * a later milestone, and until it exists the gate says what it can actually
 * establish rather than implying a judgement it never made.
 *
 * Three severities, and the distinction matters:
 *
 *   blocking   the article is not reviewable — no body, no title, nothing
 *              generated. These decide Failed.
 *   warning    reviewable, but a person should look. These decide
 *              Passed with Warnings, and never Failed.
 *   advisory   reported and never counted, for configuration Cynth supports
 *              but does not require.
 *
 * Which severity a check carries is the whole design. A missing thematic area
 * is a warning rather than a blocker because an article can legitimately be
 * written outside the content architecture; a missing body is blocking
 * because there is nothing to review. Getting this wrong in either direction
 * produces a gate that either blocks real work or waves through empty pages.
 */

/* ------------------------------------------------------------- utilities --- */

function check(
  key: string,
  label: string,
  severity: QualitySeverity,
  passed: boolean,
  detail: string,
  fix: string | null = null,
): QualityCheckResult {
  return { key, label, severity, outcome: passed ? 'passed' : 'failed', detail, fix };
}

function notApplicable(key: string, label: string, detail: string): QualityCheckResult {
  return { key, label, severity: 'advisory', outcome: 'not_applicable', detail, fix: null };
}

/**
 * Phrases that mean generation produced something other than an article.
 *
 * Matched against the OPENING of the body only. A refusal or a template
 * placeholder appears at the start; the same words appearing mid-article are
 * far more likely to be the article discussing them, and flagging those would
 * make the check useless on any piece about AI or about writing.
 */
const GENERATION_FAILURE_MARKERS: { pattern: RegExp; what: string }[] = [
  { pattern: /^\s*(i'?m sorry|i am sorry|i cannot|i can'?t|i apologi[sz]e)\b/i, what: 'a refusal from the model' },
  { pattern: /^\s*as an ai\b/i, what: 'a model disclaimer rather than an article' },
  { pattern: /^\s*lorem ipsum\b/i, what: 'placeholder filler text' },
  { pattern: /^\s*\[?(insert|your \w+ here|todo|tbd)\b/i, what: 'an unfilled template placeholder' },
  { pattern: /^\s*\{\{/, what: 'an unrendered template variable' },
];

/**
 * Whether a body looks cut off mid-thought.
 *
 * Several independent guards, because any one alone produces false positives.
 * The Markdown strip in particular is not optional: an article ending on an
 * italicised editor's note closes with `…publication.*`, whose final
 * character is an asterisk, and a naive punctuation test reads that complete
 * article as truncated.
 */
function looksTruncated(body: string): boolean {
  const trimmed = body.trimEnd();
  if (!trimmed) return false;

  const lastLine = trimmed
    .slice(trimmed.lastIndexOf('\n') + 1)
    .trim()
    // Trailing emphasis and code markers are formatting, not content.
    .replace(/[*_`~]+$/, '')
    .trim();

  if (!lastLine) return false;
  // A body ending on a heading, a list item, a rule or a table row is not
  // truncated — it is simply not ending on prose.
  if (lastLine.startsWith('#')) return false;
  if (/^[-*+]\s|^\d+[.)]\s/.test(lastLine)) return false;
  if (/^([-*_]\s*){3,}$/.test(lastLine)) return false;
  if (lastLine.startsWith('|')) return false;
  if (/[.!?:;"'”’)\]]$/.test(lastLine)) return false;

  // Short trailing fragments are usually a caption, a label, or a signature.
  return lastLine.length > 40;
}

/**
 * Unfilled placeholders left in the body.
 *
 * A model asked for a product round-up it has no product data for will
 * frequently produce the whole article and mark the facts it could not supply
 * — "[To be completed]", "[Product entry pending]". That is not a stylistic
 * quibble: it is an article that is not finished, and it would go to
 * WordPress verbatim.
 *
 * Markdown links and images are bracketed too, so anything followed by `(` is
 * excluded — flagging every link would make this check useless.
 */
const PLACEHOLDER_PATTERN = /\[[^\]\n]{2,80}\](?!\()/g;
const TEMPLATE_VARIABLE_PATTERN = /\{\{[^}\n]{1,80}\}\}/g;

/**
 * A product marker is the OPPOSITE of an unfilled placeholder.
 *
 * `[[product:14]]` is Cynth's own syntax for "the card for product 14 goes
 * here", and the CMS renderer replaces it with a real card built from stored
 * records. It is a finished instruction, not missing information.
 *
 * The bracket pattern above saw the inner `[product:14]` and reported every
 * placed product as an unfilled placeholder — which BLOCKED the gate, so an
 * article was penalised precisely for placing the products it was asked to
 * place. Markers are removed before the scan rather than added as an
 * exception to the pattern, so the pattern stays readable and this stays one
 * decision in one place.
 *
 * A marker pointing at a product that is not attached is a different problem,
 * and is already handled: `stripInvalidMarkers` removes those before the body
 * is stored, so nothing reaches here that the renderer would drop.
 */
const PRODUCT_MARKER_GLOBAL = /\[\[product:\d+\]\]/g;

function findPlaceholders(body: string): string[] {
  const withoutMarkers = body.replace(PRODUCT_MARKER_GLOBAL, ' ');
  const found = [
    ...withoutMarkers.matchAll(PLACEHOLDER_PATTERN),
    ...withoutMarkers.matchAll(TEMPLATE_VARIABLE_PATTERN),
  ].map((match) => match[0]);
  return [...new Set(found)];
}

/** The provider's own word for why it stopped, from the most recent successful attempt. */
function lastFinishReason(articleId: number): string | null {
  const history = listGenerationHistoryForArticle(articleId, 20);
  const success = history.find((entry) => entry.status === 'success');
  return success?.metadata?.finishReason ?? null;
}

/* ---------------------------------------------------------------- groups --- */

/** GROUP 1 — is there an article at all? Everything here is blocking. */
function articleChecks(article: ArticleDraftDto, document: SeoDocument | null): QualityCheckResult[] {
  const checks: QualityCheckResult[] = [];

  const generated = article.generated;
  const body = generated?.content?.trim() ?? '';

  checks.push(
    check(
      'generated',
      'The article has been generated',
      'blocking',
      Boolean(generated),
      generated
        ? `Generated ${generated.generatedAt} by ${generated.model ?? 'the configured model'}.`
        : 'Nothing has been generated for this draft yet, so there is no article to check.',
      generated ? null : 'Generate the article on the New Article workflow.',
    ),
  );

  const title = article.title?.trim() || generated?.title?.trim() || '';
  checks.push(
    check(
      'title',
      'The article has a title',
      'blocking',
      Boolean(title),
      title ? `Title: "${title}".` : 'The article has neither a working title nor a generated one.',
      title ? null : 'Set a working title on the New Article workflow.',
    ),
  );

  checks.push(
    check(
      'content_present',
      'The article has content',
      'blocking',
      body.length > 0,
      body.length > 0 ? `${body.length} characters of body content.` : 'The article body is empty.',
      body.length > 0 ? null : 'Regenerate the article.',
    ),
  );

  if (!body) return checks;

  /**
   * A LENGTH FLOOR, not a length target.
   *
   * 400 words is not an editorial standard — it is the point below which a
   * "finished article" is almost certainly a failed generation rather than a
   * short piece. Cynth has no opinion about how long an article should be,
   * and this is a warning rather than a blocker for exactly that reason.
   */
  const wordCount = document?.wordCount ?? 0;
  checks.push(
    check(
      'content_substantial',
      'The body is long enough to be a finished article',
      'warning',
      wordCount >= 400,
      wordCount >= 400
        ? `${wordCount} words.`
        : `${wordCount} words. That is short enough that generation may have stopped early rather than finished.`,
      wordCount >= 400 ? null : 'Check the article body, and regenerate if it stopped early.',
    ),
  );

  const finishReason = lastFinishReason(article.id);
  const stoppedAtLimit = finishReason === 'length' || finishReason === 'max_tokens';
  const truncated = stoppedAtLimit || looksTruncated(body);
  checks.push(
    check(
      'not_truncated',
      'The article is not cut off',
      'blocking',
      !truncated,
      stoppedAtLimit
        ? `The provider reported it stopped because it hit the output limit ("${finishReason}"), so the ending is missing.`
        : truncated
          ? 'The body ends mid-sentence, which usually means generation was cut short.'
          : finishReason
            ? `The provider reported it finished normally ("${finishReason}").`
            : 'The body ends on a complete sentence.',
      truncated ? 'Regenerate the article.' : null,
    ),
  );

  const failure = GENERATION_FAILURE_MARKERS.find((marker) => marker.pattern.test(body));
  checks.push(
    check(
      'no_generation_failure',
      'The body is an article, not a failure message',
      'blocking',
      !failure,
      failure
        ? `The body opens with ${failure.what} rather than article content.`
        : 'The body opens as article content.',
      failure ? 'Regenerate the article, and check the prompt if it happens again.' : null,
    ),
  );

  const placeholders = findPlaceholders(body);
  checks.push(
    check(
      'no_placeholders',
      'The article has no unfilled placeholders',
      'blocking',
      placeholders.length === 0,
      placeholders.length === 0
        ? 'No placeholder markers were found in the body.'
        : `${placeholders.length} distinct placeholder(s) are still unfilled, for example ` +
          `${placeholders.slice(0, 3).join(', ')}. Sending this to a CMS would publish them verbatim.`,
      placeholders.length === 0 ? null : 'Fill in the placeholders, or regenerate with the missing information supplied.',
    ),
  );

  return checks;
}

/** GROUP 2 — is it shaped like an article? Warnings: structure is editorial, not existential. */
function structureChecks(document: SeoDocument | null): QualityCheckResult[] {
  if (!document) {
    return [notApplicable('structure', 'Article structure', 'There is no body to examine.')];
  }

  const checks: QualityCheckResult[] = [];

  checks.push(
    check(
      'has_headings',
      'The article is divided by headings',
      'warning',
      document.headings.length > 0,
      document.headings.length > 0
        ? `${document.headings.length} heading(s).`
        : 'The body has no headings at all, so it is one undivided block of prose.',
      document.headings.length > 0 ? null : 'Review the article body and add section headings.',
    ),
  );

  /**
   * A heading with nothing under it means the article promises a section it
   * never delivers — the most common shape of a partially-completed
   * generation, and invisible from a word count alone.
   */
  const empty = document.sections.filter((section) => section.paragraphIndexes.length === 0);
  checks.push(
    check(
      'no_empty_sections',
      'Every section has content',
      'warning',
      empty.length === 0,
      empty.length === 0
        ? 'Every heading is followed by content.'
        : `${empty.length} heading(s) have nothing beneath them: ${empty
            .map((section) => `"${section.heading ?? 'untitled'}"`)
            .join(', ')}.`,
      empty.length === 0 ? null : 'Fill in or remove the empty sections.',
    ),
  );

  checks.push(
    check(
      'has_paragraphs',
      'The article has readable paragraphs',
      'warning',
      document.paragraphs.length >= 3,
      document.paragraphs.length >= 3
        ? `${document.paragraphs.length} paragraphs.`
        : `Only ${document.paragraphs.length} paragraph(s) — too few to read as a finished article.`,
      document.paragraphs.length >= 3 ? null : 'Check whether the article body is complete.',
    ),
  );

  return checks;
}

/**
 * GROUP 3 — editorial configuration.
 *
 * Article Type and Author are blocking: without them the article was written
 * with no format and no voice, which is not a Cynth article. Theme and Topic
 * are warnings: the content architecture is optional, and an article outside
 * it is a legitimate thing to have.
 */
function editorialChecks(article: ArticleDraftDto): QualityCheckResult[] {
  const provenance = article.provenance;

  /**
   * The name, resolved in this order: the live record, then the provenance
   * snapshot, then the bare id.
   *
   * The live record first, because a check that reads "Article type: #3" tells
   * the user nothing they can act on. The snapshot second, so an article whose
   * theme has since been deleted still reports what it was written under. The
   * id last, because it is better than nothing.
   */
  const nameOf = (id: number | null, live: () => string | null, snapshot: string | null): string =>
    id === null ? '' : (live() ?? snapshot ?? `#${id}`);

  const articleTypeName = nameOf(
    article.articleTypeId,
    () => getArticleTypeById(article.articleTypeId!)?.name ?? null,
    provenance?.articleTypeName ?? null,
  );
  const authorName = nameOf(
    article.authorId,
    () => getAuthorById(article.authorId!)?.name ?? null,
    provenance?.authorName ?? null,
  );
  const themeName = nameOf(
    article.themeId,
    () => getThemeById(article.themeId!)?.name ?? null,
    provenance?.themeName ?? null,
  );
  const topicName = nameOf(
    article.topicId,
    () => getTopicById(article.topicId!)?.title ?? null,
    provenance?.topicTitle ?? null,
  );

  return [
    check(
      'article_type',
      'The article type is known',
      'blocking',
      article.articleTypeId !== null,
      article.articleTypeId !== null
        ? `Article type: ${articleTypeName}.`
        : 'No article type is set, so nothing defines what kind of article this is.',
      article.articleTypeId !== null ? null : 'Set the article type on the New Article workflow.',
    ),
    check(
      'author',
      'The author is known',
      'blocking',
      article.authorId !== null,
      article.authorId !== null
        ? `Author: ${authorName}.`
        : 'No author is set, so the article was written in no particular voice.',
      article.authorId !== null ? null : 'Choose an author on the New Article workflow.',
    ),
    check(
      'topic',
      'The subject is known',
      'blocking',
      Boolean(article.topic?.trim()) || article.topicId !== null,
      article.topicId !== null
        ? `Topic: ${topicName}.`
        : article.topic?.trim()
          ? `Subject: "${article.topic.trim()}".`
          : 'The article has no subject and no linked topic.',
      article.topic?.trim() || article.topicId !== null
        ? null
        : 'Set the topic on the New Article workflow.',
    ),
    check(
      'theme',
      'The article belongs to a thematic area',
      'warning',
      article.themeId !== null,
      article.themeId !== null
        ? `Thematic area: ${themeName}.`
        : 'The article is not filed under a thematic area. That is allowed, but it will not appear in theme-based views.',
      article.themeId !== null ? null : 'Assign a thematic area on the New Article workflow.',
    ),
    check(
      'audience',
      'The target audience is stated',
      'warning',
      Boolean(article.targetAudience?.trim()),
      article.targetAudience?.trim()
        ? `Audience: ${article.targetAudience.trim()}.`
        : 'No target audience was recorded in the content brief.',
      article.targetAudience?.trim() ? null : 'Fill in the content brief on the New Article workflow.',
    ),
    /**
     * ADVISORY, not a warning.
     *
     * A missing provenance snapshot is a record-keeping gap — it says Cynth
     * cannot reconstruct which provider and model produced this article. It
     * says nothing about whether the article is fit to review, which is the
     * only question this gate asks, so it is reported and never counted.
     * Articles generated before Milestone 10 have no snapshot at all, and
     * penalising them for it would be noise.
     */
    check(
      'provenance',
      'The article records what produced it',
      'advisory',
      provenance !== null,
      provenance
        ? `Produced by ${provenance.providerName ?? 'an unrecorded provider'} / ${provenance.modelName ?? 'an unrecorded model'}.`
        : 'No provenance snapshot was captured, so what produced this article cannot be reconstructed.',
      null,
    ),
  ];
}

/* ------------------------------------------------------------- evaluation --- */

/** Rolls the per-check outcomes into one status. Blocking failures decide Failed; warnings never do. */
export function statusFrom(checks: QualityCheckResult[]): QualityGateStatus {
  const failed = checks.filter((result) => result.outcome === 'failed');
  if (failed.some((result) => result.severity === 'blocking')) return 'failed';
  if (failed.some((result) => result.severity === 'warning')) return 'passed_with_warnings';
  return 'passed';
}

/**
 * Runs the gate against an article, in memory.
 *
 * Pure: reads the article and its history, writes nothing. Persisting the
 * result is a separate, deliberate step (qualityGate.repository.ts), so
 * previewing an article's readiness never mutates it.
 */
export function evaluateQualityGate(article: ArticleDraftDto): QualityGateDecision {
  const body = article.generated?.content?.trim() ?? '';
  const document = body ? parseSeoDocument(body) : null;

  const groups: QualityCheckGroup[] = [
    { key: 'article', label: 'The article itself', checks: articleChecks(article, document) },
    { key: 'structure', label: 'Structure', checks: structureChecks(document) },
    { key: 'editorial', label: 'Editorial configuration', checks: editorialChecks(article) },
  ];

  const all = groups.flatMap((group) => group.checks);
  const failed = all.filter((result) => result.outcome === 'failed');

  return {
    articleId: article.id,
    status: statusFrom(all),
    failedCount: failed.filter((result) => result.severity === 'blocking').length,
    warningCount: failed.filter((result) => result.severity === 'warning').length,
    passedCount: all.filter((result) => result.outcome === 'passed').length,
    groups,
    blockingReasons: failed.filter((result) => result.severity === 'blocking').map((result) => result.detail),
    warnings: failed.filter((result) => result.severity === 'warning').map((result) => result.detail),
    evaluatedAt: null,
    isCurrent: true,
    contentFingerprint: contentFingerprint(article),
  };
}

/** Convenience for callers holding only an id. Null when the article does not exist. */
export function evaluateArticleById(articleId: number): QualityGateDecision | null {
  const article = getArticleById(articleId);
  return article ? evaluateQualityGate(article) : null;
}
