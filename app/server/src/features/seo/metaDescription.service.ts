import { getArticleById } from '../articles/articles.repository.js';
import { resolveProviderTarget } from '../generation/providerTarget.service.js';
import type { ResolvedTarget } from '../generation/providerTarget.service.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import { classifyModel, evaluateSpend } from '../generation/generationPolicy.service.js';
import { getArticleSeo, setSeoMetadataField } from './seo.repository.js';
import {
  META_DESCRIPTION_MAX_CHARS,
  META_DESCRIPTION_MIN_CHARS,
  SEO_TITLE_MAX_CHARS,
} from './seo.constants.js';

/**
 * WRITING THE SEARCH-RESULT METADATA FOR AN ARTICLE THAT ALREADY EXISTS.
 *
 * A meta description and an SEO title are ONE job, not two: both answer "how
 * does this article present itself on a results page", and both are decided
 * from the same reading of it. Writing them in one call rather than two is
 * not only cheaper — it is the only way the title and the description are
 * guaranteed to agree with each other rather than being written blind.
 *
 * This is a REPAIR, not the normal path. The writer produces a meta
 * description as part of writing the article (Milestone 36) — one more field
 * in a call that already happens, from the one stage that has read the whole
 * piece, at no extra cost. That remains the default and should stay so.
 *
 * This exists for the articles written before that, and as a safety net for
 * any article whose description is missing for whatever reason. It reads the
 * finished article and writes one short paragraph, which is a small enough
 * job for a free model to do well.
 *
 * The rules it inherits rather than reinvents:
 *
 *   - It routes through the Model Router, so no provider, endpoint or key is
 *     named here.
 *   - It passes the same spend gate as everything else. A free model runs
 *     silently; a paid one is refused or confirmed exactly as elsewhere.
 *   - IT NEVER OVERWRITES A DESCRIPTION THAT EXISTS. An editor's own copy, or
 *     the writer's, is a decision already made. `force` re-reads an article
 *     whose description is missing; it is not a licence to replace one.
 */

/**
 * The routing purpose.
 *
 * `meta_description` is its own purpose because it is its own job, but it
 * falls back to `title_generation` when no model is assigned to it — the two
 * are the same kind of work (short copy written to be read on a results page)
 * and an unconfigured purpose should not make the feature unavailable.
 */
export const META_DESCRIPTION_TASK = 'meta_description';
export const META_DESCRIPTION_FALLBACK_TASK = 'title_generation';

const TIMEOUT_MS = 60_000;

/** How much of the article the model is shown. Enough to know what it argues; not the whole thing. */
const EXCERPT_WORD_BUDGET = 700;

function firstWords(text: string, limit: number): string {
  const words = text.replace(/\[\[product:\d+\]\]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length <= limit ? words.join(' ') : `${words.slice(0, limit).join(' ')}…`;
}

function buildPrompt(input: {
  title: string;
  excerpt: string;
  body: string;
  targetQuery: string | null;
  wantDescription: boolean;
  wantTitle: boolean;
}): string {
  // Only what is actually missing is asked for. An article that already has a
  // good description written by a human, or by the writer, must not have one
  // proposed anyway — the caller would discard it, and asking wastes the call.
  const wants = [
    input.wantDescription
      ? `"meta_description": the sentence under the title in search results, ${META_DESCRIPTION_MIN_CHARS}-${META_DESCRIPTION_MAX_CHARS} characters`
      : '',
    input.wantTitle
      ? `"seo_title": the title as it should appear in a search result, at most ${SEO_TITLE_MAX_CHARS} characters`
      : '',
  ].filter(Boolean);

  return [
    'You write the copy that represents an article in search results.',
    '',
    '=== RULES ===',
    'Write for someone who has NOT clicked yet. Say what the article settles and who it is for.',
    'Do NOT copy a sentence out of the article, and do NOT rewrite the excerpt. This is its own piece of copy.',
    'Do NOT use marketing language, and do not promise anything the article does not deliver. No "discover", no "ultimate", no "everything you need to know".',
    'State only what the article actually contains. You are reading it below — nothing outside it is known to you.',
    input.wantTitle
      ? `The title is the hard one. The article's own headline is below and is usually too long for a results page; keep the part that makes someone click and drop the part that only makes sense once they have. Stay at or under ${SEO_TITLE_MAX_CHARS} characters — a title cut off mid-word is worse than a plainer one that fits.`
      : '',
    '',
    '=== THE ARTICLE ===',
    `Title: ${input.title}`,
    input.targetQuery ? `It should be findable by: ${input.targetQuery}` : '',
    input.excerpt ? `Its own summary line (do NOT reuse this wording): ${input.excerpt}` : '',
    '',
    firstWords(input.body, EXCERPT_WORD_BUDGET),
    '',
    '=== OUTPUT ===',
    'Reply with JSON only. No commentary, no code fence.',
    `{ ${wants.map((w) => w.replace(': ', ': "') + '"').join(', ')} }`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Reads the reply.
 *
 * Tolerant of a bare string when only one field was asked for, because a small
 * model told to return one value often returns the value rather than an object
 * wrapping it — and refusing that would waste a correct answer.
 */
function readReply(raw: string, wantDescription: boolean, wantTitle: boolean): { description: string; title: string } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const json = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      return {
        description: typeof json.meta_description === 'string' ? cleanMetaDescription(json.meta_description) : '',
        title: typeof json.seo_title === 'string' ? cleanSeoTitle(json.seo_title) : '',
      };
    } catch {
      // Falls through to the bare-value reading below.
    }
  }

  if (wantDescription && !wantTitle) return { description: cleanMetaDescription(text), title: '' };
  if (wantTitle && !wantDescription) return { description: '', title: cleanSeoTitle(text) };
  return { description: '', title: '' };
}

/**
 * An SEO title is kept only if it actually fits.
 *
 * Truncating one would defeat its entire purpose — the field exists because
 * the editorial title is too long — so an overrun is discarded and Cynth falls
 * back to the article title, which is the honest outcome.
 */
export function cleanSeoTitle(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^(?:seo\s*title|title)\s*[:\-–]\s*/i, '')
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > SEO_TITLE_MAX_CHARS ? '' : cleaned;
}

/**
 * Cleans what the model returned.
 *
 * Models wrap short copy in quotes and prefix it with a label more often than
 * not, and neither belongs in a meta tag.
 */
export function cleanMetaDescription(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^(?:meta\s*description|description)\s*[:\-–]\s*/i, '')
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return trimToLimit(cleaned);
}

/**
 * Brings an over-long description under the limit without cutting a word in
 * half.
 *
 * A hard `slice()` produces "...when the tracking itself becomes count", which
 * reads as broken rather than as truncated. Preferring the last sentence that
 * fits gives a description that ends properly; failing that, the last whole
 * word, with any dangling comma or conjunction removed.
 */
function trimToLimit(text: string): string {
  if (text.length <= META_DESCRIPTION_MAX_CHARS) return text;

  const clipped = text.slice(0, META_DESCRIPTION_MAX_CHARS);

  // A complete sentence is the best ending, but only if it keeps enough of
  // the description to still be worth showing.
  const lastSentence = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '));
  if (lastSentence >= META_DESCRIPTION_MIN_CHARS) return clipped.slice(0, lastSentence + 1);

  const lastSpace = clipped.lastIndexOf(' ');
  const onWord = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;

  // "…, and" or "…, but" left hanging at the end reads worse than stopping.
  return onWord.replace(/[\s,;:]+(?:and|but|or|which|that|with|for|from|to|of|in|on)?[\s,;:]*$/i, '').trim();
}

export interface SearchMetadataOutcome {
  articleId: number;
  /** Empty when the article already had one, or the model did not return a usable one. */
  metaDescription: string;
  seoTitle: string;
  /** What was actually written, so a caller can report it rather than guess. */
  written: ('meta_description' | 'seo_title')[];
  model: string;
  provider: string;
  costClass: string;
  durationMs: number;
}

/**
 * Fills whatever search-result metadata an article is missing.
 *
 * Asks for only the missing fields, in ONE call, and writes only what came
 * back usable. An article that already has both is refused rather than
 * rewritten — which is what makes running this over everything safe, and why
 * the caller does not need to filter first.
 */
export async function writeSearchMetadata(
  articleId: number,
  options: { confirmedCost?: boolean; modelId?: number | null } = {},
): Promise<SearchMetadataOutcome> {
  const article = getArticleById(articleId);
  if (!article) throw new GenerationError('invalid_configuration', 'Article not found.');

  const body = article.generated?.content?.trim() ?? '';
  if (!body) {
    throw new GenerationError(
      'invalid_configuration',
      'This article has no generated content, so there is nothing to describe.',
    );
  }

  const record = getArticleSeo(articleId);
  const editorialTitle = article.generated?.title?.trim() || article.title?.trim() || '';

  const wantDescription = !record.metadata.metaDescription?.trim();

  // An SEO title is only worth having when the editorial one does not fit a
  // results page. Asking for one on a title that already fits would produce a
  // second field saying the same thing, which is worse than none.
  const wantTitle = !record.metadata.seoTitle?.trim() && editorialTitle.length > SEO_TITLE_MAX_CHARS;

  if (!wantDescription && !wantTitle) {
    throw new GenerationError(
      'invalid_configuration',
      'This article already has the search-result metadata it needs. Clear a field first if you want it rewritten — Cynth will not overwrite one you or the writer already wrote.',
    );
  }

  // The dedicated purpose when it is configured, the short-copy purpose when
  // it is not. Stated in the error if neither resolves.
  let resolution = resolveProviderTarget(META_DESCRIPTION_TASK, options.modelId, 'Search metadata');
  if (resolution.error) {
    resolution = resolveProviderTarget(META_DESCRIPTION_FALLBACK_TASK, options.modelId, 'Search metadata');
  }
  if (resolution.error) throw resolution.error;

  const target: ResolvedTarget = resolution.target!;
  const routedModel = resolution.route!.model!;

  const costClass = classifyModel(routedModel);
  const spend = evaluateSpend(costClass, options.confirmedCost === true);
  if (!spend.allowed) {
    throw new GenerationError(
      spend.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      spend.reason ?? 'Writing search metadata is not permitted in the current mode.',
    );
  }

  const prompt = buildPrompt({
    title: editorialTitle,
    excerpt: article.excerpt?.trim() ?? '',
    body,
    targetQuery: record.configuration.targetQuery?.trim() || null,
    wantDescription,
    wantTitle,
  });

  const startedAt = Date.now();
  try {
    const response = await target.adapter.generate(
      { prompt, model: target.modelName, timeoutMs: TIMEOUT_MS },
      { apiKey: target.apiKey, baseUrl: target.baseUrl },
    );

    const parsed = readReply(response.text ?? '', wantDescription, wantTitle);

    // A title identical to the headline is no use: Cynth already falls back to
    // the article title when this field is empty.
    const title = wantTitle && parsed.title && parsed.title !== editorialTitle ? parsed.title : '';
    const description = wantDescription ? parsed.description : '';

    if (!title && !description) {
      throw new GenerationError(
        'empty_response',
        'The model returned nothing usable. Nothing was saved — you can try again.',
      );
    }

    const written: ('meta_description' | 'seo_title')[] = [];
    if (description) {
      setSeoMetadataField(articleId, 'meta_description', description);
      written.push('meta_description');
    }
    if (title) {
      setSeoMetadataField(articleId, 'seo_title', title);
      written.push('seo_title');
    }

    return {
      articleId,
      metaDescription: description,
      seoTitle: title,
      written,
      model: target.modelName,
      provider: target.providerName,
      costClass,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (isGenerationError(error)) throw error;
    const message = truncateForDisplay(
      redactSecrets(error instanceof Error ? error.message : 'Unknown error.', [target.apiKey]),
    );
    throw new GenerationError('provider_error', `Writing the search metadata failed: ${message}`);
  }
}

export interface BackfillOutcome {
  considered: number;
  written: { articleId: number; metaDescription: string; seoTitle: string; fields: string[] }[];
  failed: { articleId: number; reason: string }[];
}

/**
 * Writes a meta description for every generated article that lacks one.
 *
 * Sequential on purpose. These run on a free model where rate limits are the
 * binding constraint, and a burst of parallel requests is the reliable way to
 * be throttled. One failure does not stop the rest — the outcome reports
 * exactly which articles were written and which were not.
 */
export async function backfillSearchMetadata(
  articleIds: number[],
  options: { confirmedCost?: boolean } = {},
): Promise<BackfillOutcome> {
  const outcome: BackfillOutcome = { considered: articleIds.length, written: [], failed: [] };

  for (const articleId of articleIds) {
    try {
      const result = await writeSearchMetadata(articleId, options);
      outcome.written.push({
        articleId,
        metaDescription: result.metaDescription,
        seoTitle: result.seoTitle,
        fields: result.written,
      });
    } catch (error) {
      outcome.failed.push({
        articleId,
        reason: isGenerationError(error) ? error.message : 'Unexpected error.',
      });
    }
  }

  return outcome;
}
