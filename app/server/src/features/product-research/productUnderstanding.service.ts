import { resolveProviderTarget } from '../generation/providerTarget.service.js';
import type { ResolvedTarget } from '../generation/providerTarget.service.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import { classifyModel, estimateCost, evaluateSpend, getGenerationMode } from '../generation/generationPolicy.service.js';
import type { CostEstimate, GenerationMode, ModelCostClass, SpendDecision } from '../generation/generationPolicy.service.js';
import type { TokenUsage } from '../generation/generation.types.js';
import { recordGeneration } from '../generation/generationHistory.repository.js';
import { getProductById } from '../products/products.repository.js';
import { applyResearchFields, getLatestResearch, recordResearch, setResearchStatus } from './productResearch.repository.js';
import { ProductRetrievalError } from './productRetrieval.service.js';

/**
 * PRODUCT UNDERSTANDING — the only part of product research that can cost
 * money, and the first workflow to route to the `research` capability.
 *
 * Its job is one question: what is this product FOR? Everything downstream —
 * deciding which section of an article a monitor light belongs in — depends
 * on an answer to that, and no amount of specification parsing produces one.
 *
 * Four guarantees, matching seoAi.service.ts exactly, because they are the
 * same guarantees and duplicating the reasoning would let them drift:
 *
 *   1. IT ROUTES THROUGH THE EXISTING ARCHITECTURE. Provider and model come
 *      from the Model Router under `research`. No provider, endpoint or key
 *      is named here.
 *   2. IT PASSES THE SAME SPEND GATE. Test mode refuses a paid model;
 *      Production requires explicit per-request confirmation. `confirmedCost`
 *      is never defaulted to true.
 *   3. IT NEVER SUBSTITUTES A MODEL, and never retries.
 *   4. IT IS NEVER GIVEN THE PAGE. The prompt below carries the extracted
 *      metadata fields only — title, brand, published feature strings. The
 *      retrieved HTML does not reach a model, which is what keeps this
 *      research rather than laundering someone's page through an LLM.
 */

export const PRODUCT_RESEARCH_TASK = 'research';

/** Understanding one product is a small, structured job — far shorter than writing an article. */
export const PRODUCT_RESEARCH_TIMEOUT_MS = 90_000;

/** Output tokens a structured product understanding is assumed to need, for the up-front estimate. */
export const ASSUMED_RESEARCH_COMPLETION_TOKENS = 700;

export interface ProductUnderstanding {
  useCase: string;
  problemSolved: string;
  bestFor: string;
  keyFeatures: string[];
  summary: string;
}

export interface ProductResearchPreflight {
  taskType: string;
  provider: { name: string; providerType: string; hasApiKey: boolean } | null;
  model: { id: number; modelName: string; displayName: string | null } | null;
  mode: GenerationMode;
  costClass: ModelCostClass;
  cost: CostEstimate | null;
  spend: SpendDecision | null;
  promptCharacterCount: number | null;
  ready: boolean;
  issues: string[];
  configurationErrorCode: string | null;
}

/**
 * The facts a model is allowed to see about a product.
 *
 * Assembled from stored fields only. Note what is absent: the retrieved HTML,
 * the page's marketing copy, and the affiliate link — a model has no reason
 * to see a tracking URL, and cannot alter what it never receives.
 */
function buildResearchPrompt(product: NonNullable<ReturnType<typeof getProductById>>): string {
  const research = getLatestResearch(product.id);
  const features = research?.keyFeatures ?? [];

  const field = (label: string, value: string | null | undefined) =>
    value?.trim() ? `${label}: ${value.trim()}` : null;

  const facts = [
    field('Product title', product.title),
    field('Brand', product.brand),
    field('Category', product.category),
    field('Description published by the source', product.description),
    field('Editorial notes from the editor', product.editorialFit),
    features.length ? `Specifications published by the source:\n${features.map((f) => `- ${f}`).join('\n')}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return [
    'You are a product research assistant inside an editorial system. You are analysing one product so that a writer can decide where, if anywhere, it belongs in an article.',
    '',
    '=== RULES ===',
    'Use only the facts below. Do not invent specifications, measurements, prices, compatibility, or claims about performance.',
    'Where the facts are thin, say what the product plainly is and stop. A short honest answer is correct; a padded one is not.',
    'Do not write marketing copy, and do not recommend the product. You are describing what it is for, not selling it.',
    'Do not copy the supplied description verbatim — express what the product does in your own words.',
    '',
    '=== PRODUCT FACTS ===',
    facts || 'No facts were supplied.',
    '',
    '=== OUTPUT ===',
    'Reply with JSON only, no commentary and no code fence, in exactly this shape:',
    '{',
    '  "useCase": "one sentence: what this product is used for",',
    '  "problemSolved": "one sentence: the specific problem it addresses",',
    '  "bestFor": "one sentence: the reader or situation it suits",',
    '  "keyFeatures": ["three to six short factual phrases drawn from the facts above"],',
    '  "summary": "two sentences a writer could use as background. Neutral, not promotional."',
    '}',
  ].join('\n');
}

/** What the user sees before pressing Research. Reads local state only — contacts no provider and costs nothing. */
export function getProductResearchPreflight(productId: number, modelId?: number | null): ProductResearchPreflight {
  const issues: string[] = [];
  const product = getProductById(productId);
  if (!product) issues.push('Product not found.');

  const resolution = resolveProviderTarget(PRODUCT_RESEARCH_TASK, modelId, 'Product Research');
  if (resolution.error) issues.push(resolution.error.message);

  const routedModel = resolution.route?.model ?? null;
  const costClass: ModelCostClass = routedModel ? classifyModel(routedModel) : 'unknown';
  const promptLength = product ? buildResearchPrompt(product).length : null;
  const cost =
    routedModel && promptLength !== null
      ? estimateCost(routedModel, promptLength, ASSUMED_RESEARCH_COMPLETION_TOKENS)
      : null;
  const spend = routedModel ? evaluateSpend(costClass, false) : null;

  return {
    taskType: PRODUCT_RESEARCH_TASK,
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
      product !== null &&
      resolution.error === null &&
      (spend === null || spend.allowed || spend.requiresConfirmation),
    issues,
    configurationErrorCode: resolution.error?.code ?? null,
  };
}

/** Strips a code fence a model may have wrapped its JSON in, then parses strictly. */
function parseUnderstanding(text: string): ProductUnderstanding {
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object was found in the response');

  const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as Record<string, unknown>;

  const sentence = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`"${field}" was missing`);
    return value.trim().slice(0, 600);
  };

  const features = Array.isArray(parsed.keyFeatures)
    ? parsed.keyFeatures
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim().slice(0, 200))
        .slice(0, 8)
    : [];

  return {
    useCase: sentence(parsed.useCase, 'useCase'),
    problemSolved: sentence(parsed.problemSolved, 'problemSolved'),
    bestFor: sentence(parsed.bestFor, 'bestFor'),
    keyFeatures: features,
    summary: sentence(parsed.summary, 'summary'),
  };
}

export interface ProductResearchOutcome {
  understanding: ProductUnderstanding;
  target: { providerName: string; providerType: string; modelName: string };
  costClass: ModelCostClass;
  mode: GenerationMode;
  usage: TokenUsage | null;
  durationMs: number;
}

/** Guards against a double-click starting a second billable research run for the same product. */
const inFlight = new Set<number>();

export async function researchProduct(
  productId: number,
  options: { confirmedCost?: boolean; modelId?: number | null } = {},
): Promise<ProductResearchOutcome> {
  // Not a GenerationError: nothing was routed, nothing was spent, and the
  // error vocabulary there describes provider and cost outcomes only.
  const product = getProductById(productId);
  if (!product) throw new ProductRetrievalError('product_not_found', 'Product not found.');

  const prompt = buildResearchPrompt(product);

  const resolution = resolveProviderTarget(PRODUCT_RESEARCH_TASK, options.modelId, 'Product Research');
  if (resolution.error) throw resolution.error;

  const target: ResolvedTarget = resolution.target!;
  const routedModel = resolution.route!.model!;

  // COST SAFETY GATE. Everything above this line is free.
  const costClass = classifyModel(routedModel);
  const spend = evaluateSpend(costClass, options.confirmedCost === true);
  if (!spend.allowed) {
    throw new GenerationError(
      spend.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      spend.reason ?? 'This product research is not permitted in the current mode.',
    );
  }

  if (inFlight.has(productId)) {
    throw new GenerationError('generation_in_progress', 'This product is already being researched.');
  }
  inFlight.add(productId);

  const startedAt = Date.now();
  try {
    const response = await target.adapter.generate(
      { prompt, model: target.modelName, timeoutMs: PRODUCT_RESEARCH_TIMEOUT_MS },
      { apiKey: target.apiKey, baseUrl: target.baseUrl },
    );

    if (!response.text.trim()) {
      throw new GenerationError('empty_response', 'The model returned an empty response. Nothing was saved.');
    }

    let understanding: ProductUnderstanding;
    try {
      understanding = parseUnderstanding(response.text);
    } catch (error) {
      throw new GenerationError(
        'empty_response',
        `The model's product research could not be read: ${
          error instanceof Error ? error.message : 'unrecognised format'
        }. Nothing was saved.`,
      );
    }

    // Persisted as its own pass, so the model's interpretation stays
    // distinguishable from the page's published facts.
    recordResearch({
      productId,
      sourceUrl: product.sourceUrl,
      extractionMethod: 'ai',
      extractionModel: target.modelName,
      useCase: understanding.useCase,
      problemSolved: understanding.problemSolved,
      bestFor: understanding.bestFor,
      keyFeatures: understanding.keyFeatures,
      summary: understanding.summary,
    });

    applyResearchFields(productId, {
      useCase: understanding.useCase,
      problemSolved: understanding.problemSolved,
      bestFor: understanding.bestFor,
      keyFeatures: understanding.keyFeatures,
      researchStatus: 'researched',
    });

    const outcome: ProductResearchOutcome = {
      understanding,
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
      articleId: null,
      taskType: PRODUCT_RESEARCH_TASK,
      providerName: target.providerName,
      providerType: target.providerType,
      model: target.modelName,
      status: 'success',
      promptTokens: response.usage?.promptTokens ?? null,
      completionTokens: response.usage?.completionTokens ?? null,
      totalTokens: response.usage?.totalTokens ?? null,
      durationMs: outcome.durationMs,
      metadata: { productId, productTitle: product.title, promptCharacterCount: prompt.length },
    });

    return outcome;
  } catch (error) {
    setResearchStatus(productId, 'failed');

    const generationError = isGenerationError(error)
      ? error
      : new GenerationError(
          'provider_error',
          truncateForDisplay(
            redactSecrets(error instanceof Error ? error.message : 'Unknown error.', [target.apiKey]),
          ),
        );

    recordGeneration({
      articleId: null,
      taskType: PRODUCT_RESEARCH_TASK,
      providerName: target.providerName,
      providerType: target.providerType,
      model: target.modelName,
      status: 'failure',
      errorCode: generationError.code,
      errorMessage: generationError.message,
      durationMs: Date.now() - startedAt,
      metadata: { productId, promptCharacterCount: prompt.length },
    });

    throw generationError;
  } finally {
    inFlight.delete(productId);
  }
}
