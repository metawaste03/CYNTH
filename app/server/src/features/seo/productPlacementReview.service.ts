import { resolveProviderTarget } from '../generation/providerTarget.service.js';
import type { ResolvedTarget } from '../generation/providerTarget.service.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import { classifyModel, estimateCost, evaluateSpend, getGenerationMode } from '../generation/generationPolicy.service.js';
import type { CostEstimate, GenerationMode, ModelCostClass, SpendDecision } from '../generation/generationPolicy.service.js';
import type { TokenUsage } from '../generation/generation.types.js';
import { recordGeneration } from '../generation/generationHistory.repository.js';
import { getArticleById } from '../articles/articles.repository.js';
import { listArticleProducts, recordPlacementReviews } from '../articles/articleProducts.repository.js';
import type { PlacementVerdict } from '../articles/articleProducts.repository.js';
import { PLACEMENT_VERDICTS } from '../articles/articleProducts.repository.js';
import { buildGenerationContext } from '../generation/generationContext.service.js';
import { SEO_ANALYSIS_TASK } from './seo.constants.js';
import type { SeoFinding } from './seo.types.js';

/**
 * PRODUCT PLACEMENT REVIEW (Milestone 18).
 *
 * Milestone 17 let the author decide where a product belongs. Nothing then
 * checked whether that decision was any good. This does.
 *
 * It is a REVIEW, and the distinction is structural rather than a matter of
 * wording: it writes only to the review columns on `article_products`, never
 * to `placement_section`, never to `status`, and never to the article body.
 * A suggestion that a product would sit better elsewhere is stored as a
 * suggestion. Moving it is the editor's decision.
 *
 * It reports GOOD placements as good. A review that only ever speaks up to
 * complain gives the editor no way to tell "this was checked and it is fine"
 * apart from "this was not checked".
 *
 * Routing: the `seo_review` capability, the same one the AI SEO pass uses,
 * because the results land on the SEO Review page and are stored as SEO
 * findings. Same Model Router, same spend gate, same history — no second AI
 * system.
 */

export const PLACEMENT_REVIEW_TIMEOUT_MS = 120_000;

/** Output tokens a structured placement review is assumed to need, for the up-front estimate. */
export const ASSUMED_PLACEMENT_COMPLETION_TOKENS = 900;

/** How much of the article the reviewer is shown around each placement. */
const CONTEXT_CHARACTERS = 1200;

export interface PlacementReviewItem {
  productId: number;
  productTitle: string;
  verdict: PlacementVerdict;
  /** Why the placement works, or why it does not. Always populated. */
  assessment: string;
  /** Only when the verdict is weak or misplaced. Null when the placement is fine. */
  suggestedSection: string | null;
  confidence: number;
}

export interface PlacementReviewOutcome {
  articleId: number;
  items: PlacementReviewItem[];
  /** Findings for the weak placements, in the shape the SEO engine already stores. */
  findings: SeoFinding[];
  target: { providerName: string; providerType: string; modelName: string };
  costClass: ModelCostClass;
  mode: GenerationMode;
  usage: TokenUsage | null;
  durationMs: number;
}

/**
 * The article as the reviewer sees it: the placed products, and the prose
 * around each marker.
 *
 * Sections are extracted rather than the whole body sent, because the question
 * is local — does the surrounding content introduce this product — and a
 * 3,000-word article would bury it.
 */
interface PlacementSubject {
  productId: number;
  title: string;
  useCase: string | null;
  section: string | null;
  /** The prose immediately before and after the marker. */
  context: string;
  editorialNote: string | null;
}

function collectSubjects(articleId: number): { subjects: PlacementSubject[]; headings: string[] } {
  const article = getArticleById(articleId);
  const body = article?.generated?.content ?? '';
  const context = buildGenerationContext(articleId);
  const attached = listArticleProducts(articleId);

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const headings = lines
    .map((line) => /^\s*#{1,6}\s+(.*)$/.exec(line)?.[1]?.trim())
    .filter((heading): heading is string => Boolean(heading));

  const subjects: PlacementSubject[] = [];

  for (const row of attached) {
    if (row.status !== 'placed') continue;

    const product = context?.products.find((entry) => entry.productId === row.productId);
    const markerIndex = lines.findIndex((line) => new RegExp(`\\[\\[product:${row.productId}\\]\\]`).test(line));
    if (markerIndex === -1) continue;

    // The prose either side of the marker, trimmed to a readable window.
    const before = lines.slice(Math.max(0, markerIndex - 12), markerIndex).join('\n');
    const after = lines.slice(markerIndex + 1, markerIndex + 8).join('\n');

    subjects.push({
      productId: row.productId,
      title: product?.title ?? `Product ${row.productId}`,
      useCase: product?.useCase ?? null,
      section: row.placementSection,
      context: `${before.slice(-CONTEXT_CHARACTERS)}\n[PRODUCT APPEARS HERE]\n${after.slice(0, 400)}`.trim(),
      editorialNote: row.editorialNote,
    });
  }

  return { subjects, headings };
}

function buildReviewPrompt(subjects: PlacementSubject[], headings: string[]): string {
  const blocks = subjects.map((subject) =>
    [
      `--- Product ${subject.productId}: ${subject.title} ---`,
      subject.useCase ? `What it is for: ${subject.useCase}` : 'What it is for: not researched.',
      subject.editorialNote ? `Editor's note: ${subject.editorialNote}` : null,
      `Placed under the heading: ${subject.section ?? '(no heading — before the first one)'}`,
      'Surrounding content:',
      subject.context,
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
  );

  return [
    'You are reviewing where products were placed in a published-draft article. You are assessing an editorial decision that has already been made. You are not rewriting the article and nothing you say will be applied automatically.',
    '',
    '=== RULES ===',
    'Judge each placement on whether the surrounding content actually leads into that product — whether a reader arriving at that point would find it relevant.',
    'Say so plainly when a placement is good. A good placement is a real and expected outcome, not a missing problem.',
    'Only call a placement weak when you can say what is wrong with it and name a better section from the list of headings below.',
    'Do not suggest adding products, removing products, or changing the article\'s argument. Do not comment on the writing quality.',
    'Do not invent headings. A suggested section must be one of the headings listed.',
    '',
    `=== ARTICLE HEADINGS ===\n${headings.length ? headings.map((h) => `- ${h}`).join('\n') : '(the article has no headings)'}`,
    '',
    `=== PLACEMENTS TO REVIEW ===\n${blocks.join('\n\n')}`,
    '',
    '=== OUTPUT ===',
    'Reply with JSON only, no commentary and no code fence:',
    '{',
    '  "placements": [',
    '    {',
    '      "productId": 12,',
    `      "verdict": "one of: ${PLACEMENT_VERDICTS.join(' | ')}",`,
    '      "assessment": "one or two sentences: why this placement works, or what is wrong with it",',
    '      "suggestedSection": "an exact heading from the list above, or null when the placement is fine",',
    '      "confidence": 0.0',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

export interface PlacementReviewPreflight {
  articleId: number;
  placedProductCount: number;
  provider: { name: string; providerType: string; hasApiKey: boolean } | null;
  model: { id: number; modelName: string; displayName: string | null } | null;
  mode: GenerationMode;
  costClass: ModelCostClass;
  cost: CostEstimate | null;
  spend: SpendDecision | null;
  promptCharacterCount: number | null;
  ready: boolean;
  issues: string[];
}

/** Reads local state only — contacts no provider and costs nothing. */
export function getPlacementReviewPreflight(articleId: number, modelId?: number | null): PlacementReviewPreflight {
  const issues: string[] = [];
  const { subjects, headings } = collectSubjects(articleId);

  if (!subjects.length) {
    issues.push('This article has no placed products to review. Generate the article with products attached first.');
  }

  const resolution = resolveProviderTarget(SEO_ANALYSIS_TASK, modelId, 'Product Placement Review');
  if (resolution.error) issues.push(resolution.error.message);

  const routedModel = resolution.route?.model ?? null;
  const costClass: ModelCostClass = routedModel ? classifyModel(routedModel) : 'unknown';
  const promptLength = subjects.length ? buildReviewPrompt(subjects, headings).length : null;
  const cost =
    routedModel && promptLength !== null
      ? estimateCost(routedModel, promptLength, ASSUMED_PLACEMENT_COMPLETION_TOKENS)
      : null;
  const spend = routedModel ? evaluateSpend(costClass, false) : null;

  return {
    articleId,
    placedProductCount: subjects.length,
    provider: resolution.route?.provider
      ? {
          name: resolution.route.provider.name,
          providerType: resolution.route.provider.providerType,
          hasApiKey: resolution.route.provider.hasApiKey,
        }
      : null,
    model: routedModel
      ? { id: routedModel.id, modelName: routedModel.modelName, displayName: routedModel.displayName }
      : null,
    mode: getGenerationMode(),
    costClass,
    cost,
    spend,
    promptCharacterCount: promptLength,
    ready:
      subjects.length > 0 &&
      resolution.error === null &&
      (spend === null || spend.allowed || spend.requiresConfirmation),
    issues,
  };
}

/**
 * Parses the review, discarding anything that does not correspond to a real
 * placement.
 *
 * `allowedProductIds` and `allowedHeadings` are the same discipline the SEO
 * parser applies to internal links: a model naming a product that was not
 * placed, or a heading the article does not have, is not allowed to invent
 * either into the record.
 */
function parseReview(
  text: string,
  allowedProductIds: Set<number>,
  allowedHeadings: Set<string>,
): PlacementReviewItem[] {
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object was found in the response');

  const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as Record<string, unknown>;
  const rows = Array.isArray(parsed.placements) ? parsed.placements : [];

  const items: PlacementReviewItem[] = [];
  const seen = new Set<number>();

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;

    const productId = Number(row.productId);
    if (!allowedProductIds.has(productId) || seen.has(productId)) continue;

    const verdict = typeof row.verdict === 'string' ? row.verdict.toLowerCase().trim() : '';
    if (!(PLACEMENT_VERDICTS as string[]).includes(verdict)) continue;

    const assessment = typeof row.assessment === 'string' ? row.assessment.trim().slice(0, 800) : '';
    if (!assessment) continue;

    // A suggestion is kept only when it names a heading the article has.
    const suggestedRaw = typeof row.suggestedSection === 'string' ? row.suggestedSection.trim() : '';
    const suggestedSection = suggestedRaw && allowedHeadings.has(suggestedRaw) ? suggestedRaw : null;

    const confidenceRaw = Number(row.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.min(Math.max(confidenceRaw, 0), 1) : 0.5;

    seen.add(productId);
    items.push({
      productId,
      productTitle: '',
      verdict: verdict as PlacementVerdict,
      assessment,
      suggestedSection,
      confidence,
    });
  }

  return items;
}

/** A weak placement becomes an SEO finding, so it reaches the score, the gate and the existing findings list. */
function findingsFor(items: PlacementReviewItem[]): SeoFinding[] {
  return items
    .filter((item) => item.verdict === 'weak' || item.verdict === 'misplaced')
    .map((item) => ({
      code: item.verdict === 'misplaced' ? 'product_placement_misplaced' : 'product_placement_weak',
      category: 'product_placement',
      dimension: 'content_relevance',
      // A misplaced product is a reader-trust problem; a merely weak one is
      // advice. Neither blocks: the author's decision stands unless a human
      // changes it.
      severity: item.verdict === 'misplaced' ? 'warning' : 'recommendation',
      origin: 'ai',
      summary: `"${item.productTitle}" may not be well placed.`,
      explanation: item.assessment,
      recommendation: item.suggestedSection
        ? `Consider moving it to "${item.suggestedSection}".`
        : 'Consider whether the surrounding content leads into this product.',
      element: 'section',
      locator: null,
      confidence: item.confidence,
    }));
}

/** Guards against a double-click starting a second billable review for the same article. */
const inFlight = new Set<number>();

export async function reviewProductPlacements(
  articleId: number,
  options: { confirmedCost?: boolean; modelId?: number | null } = {},
): Promise<PlacementReviewOutcome> {
  const { subjects, headings } = collectSubjects(articleId);
  if (!subjects.length) {
    throw new GenerationError(
      'invalid_configuration',
      'This article has no placed products to review.',
    );
  }

  const prompt = buildReviewPrompt(subjects, headings);

  const resolution = resolveProviderTarget(SEO_ANALYSIS_TASK, options.modelId, 'Product Placement Review');
  if (resolution.error) throw resolution.error;

  const target: ResolvedTarget = resolution.target!;
  const routedModel = resolution.route!.model!;

  // COST SAFETY GATE. Everything above this line is free.
  const costClass = classifyModel(routedModel);
  const spend = evaluateSpend(costClass, options.confirmedCost === true);
  if (!spend.allowed) {
    throw new GenerationError(
      spend.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      spend.reason ?? 'This placement review is not permitted in the current mode.',
    );
  }

  if (inFlight.has(articleId)) {
    throw new GenerationError('generation_in_progress', 'A placement review is already running for this article.');
  }
  inFlight.add(articleId);

  const startedAt = Date.now();
  try {
    const response = await target.adapter.generate(
      { prompt, model: target.modelName, timeoutMs: PLACEMENT_REVIEW_TIMEOUT_MS },
      { apiKey: target.apiKey, baseUrl: target.baseUrl },
    );

    if (!response.text.trim()) {
      throw new GenerationError('empty_response', 'The model returned an empty response. Nothing was saved.');
    }

    let items: PlacementReviewItem[];
    try {
      items = parseReview(
        response.text,
        new Set(subjects.map((subject) => subject.productId)),
        new Set(headings),
      );
    } catch (error) {
      throw new GenerationError(
        'empty_response',
        `The placement review could not be read: ${
          error instanceof Error ? error.message : 'unrecognised format'
        }. Nothing was saved.`,
      );
    }

    // Titles come from Cynth's records, not from the model's echo of them.
    const titleByProductId = new Map(subjects.map((subject) => [subject.productId, subject.title]));
    for (const item of items) item.productTitle = titleByProductId.get(item.productId) ?? `Product ${item.productId}`;

    recordPlacementReviews(
      articleId,
      items.map((item) => ({
        productId: item.productId,
        verdict: item.verdict,
        assessment: item.assessment,
        suggestedSection: item.suggestedSection,
        confidence: item.confidence,
        model: target.modelName,
      })),
    );

    const outcome: PlacementReviewOutcome = {
      articleId,
      items,
      findings: findingsFor(items),
      target: {
        providerName: target.providerName,
        providerType: target.providerType,
        modelName: target.modelName,
      },
      costClass,
      mode: spend.mode,
      usage: response.usage,
      durationMs: Date.now() - startedAt,
    };

    recordGeneration({
      articleId,
      taskType: 'product_placement_review',
      providerName: target.providerName,
      providerType: target.providerType,
      model: target.modelName,
      status: 'success',
      promptTokens: response.usage?.promptTokens ?? null,
      completionTokens: response.usage?.completionTokens ?? null,
      totalTokens: response.usage?.totalTokens ?? null,
      durationMs: outcome.durationMs,
      metadata: { promptCharacterCount: prompt.length, generationMode: spend.mode, costClass },
    });

    return outcome;
  } catch (error) {
    const generationError = isGenerationError(error)
      ? error
      : new GenerationError(
          'provider_error',
          truncateForDisplay(
            redactSecrets(error instanceof Error ? error.message : 'Unknown error.', [target.apiKey]),
          ),
        );

    recordGeneration({
      articleId,
      taskType: 'product_placement_review',
      providerName: target.providerName,
      providerType: target.providerType,
      model: target.modelName,
      status: 'failure',
      errorCode: generationError.code,
      errorMessage: generationError.message,
      durationMs: Date.now() - startedAt,
      metadata: { promptCharacterCount: prompt.length },
    });

    throw generationError;
  } finally {
    inFlight.delete(articleId);
  }
}
