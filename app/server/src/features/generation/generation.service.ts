import { getArticleById, saveGeneratedArticle } from '../articles/articles.repository.js';
import type { GeneratedArticleDto } from '../articles/articles.repository.js';
import { getArticleTypeById } from '../article-types/article-types.repository.js';
import { getAuthorById } from '../authors/authors.repository.js';
import { getProductById } from '../products/products.repository.js';
import { buildPrompt } from '../prompt-builder/promptBuilder.service.js';
import { resolveProviderTarget } from './providerTarget.service.js';
import type { TokenUsage } from './generation.types.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from './generation.errors.js';
import { GENERATION_TIMEOUT_MS } from './generation.constants.js';
import { parseGeneratedArticle } from './generation.parse.js';
import { recordGeneration } from './generationHistory.repository.js';
import { recordPlacements, resolveProductIdsForArticle } from '../articles/articleProducts.repository.js';
import { scanProductPlacements, stripInvalidMarkers } from '../articles/productPlacement.js';
import {
  ASSUMED_COMPLETION_TOKENS,
  classifyModel,
  estimateCost,
  evaluateSpend,
  getGenerationMode,
} from './generationPolicy.service.js';
import type { CostEstimate, GenerationMode, ModelCostClass, SpendDecision } from './generationPolicy.service.js';

/**
 * The generation engine (Milestone 9).
 *
 *   Article Draft -> Prompt Builder -> Model Router -> Provider Adapter
 *   -> configured AI model -> normalized response -> saved back to the draft
 *
 * Nothing here knows how any individual provider's API works, and nothing
 * here decides which provider to use — that is the Model Router's job, so the
 * frontend can never pick a provider directly.
 *
 * The task type is a parameter, not a constant: title generation, SEO review
 * and the rest are future tasks that will route through this same path.
 */

/** The article-drafting task. Matches MODEL_PURPOSES in ../ai-providers/aiProviders.constants.ts. */
export const ARTICLE_GENERATION_TASK = 'article_generation';

export class DraftNotFoundError extends Error {}

/** The draft is missing something the Prompt Builder requires — reported field by field, exactly as Milestone 7 already does. */
export class DraftNotReadyError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join(' '));
    this.name = 'DraftNotReadyError';
    this.errors = errors;
  }
}

/* ---------------------------------------------------------------- preflight */

export interface GenerationPreflight {
  articleId: number;
  taskType: string;
  articleTypeName: string | null;
  authorName: string | null;
  productName: string | null;
  /** Display-safe: name and type only, never a key. */
  provider: { name: string; providerType: string; hasApiKey: boolean } | null;
  model: {
    /** The registry entry id, so the UI can pre-select the model that will actually be used. */
    id: number;
    modelName: string;
    displayName: string | null;
    vendor: string | null;
    /** Pricing as last synced. Null means unknown, which is treated as paid. */
    promptPrice: number | null;
    completionPrice: number | null;
    requestPrice: number | null;
    contextLength: number | null;
    pricingSyncedAt: string | null;
  } | null;
  /** True when this preflight describes a model the user explicitly chose rather than the configured default. */
  isExplicitSelection: boolean;
  promptCharacterCount: number | null;
  promptWordCount: number | null;
  /** COST SAFETY — what this generation would cost and whether it is allowed at all. */
  mode: GenerationMode;
  costClass: ModelCostClass;
  cost: CostEstimate | null;
  spend: SpendDecision | null;
  /** True only when a request could actually be sent right now. */
  ready: boolean;
  /** Everything standing in the way, in plain language. */
  issues: string[];
  /** Set when the blocking problem is configuration, so the UI can point at AI Provider settings. */
  configurationErrorCode: string | null;
}

/**
 * What the user sees before pressing Generate. Reads local state only —
 * contacts no provider.
 *
 * `modelId` lets the UI preview a model the user is considering: the same
 * provider, the same pricing and the same spend decision the generate call
 * would reach, before anything is committed to.
 */
export function getGenerationPreflight(
  articleId: number,
  taskType: string = ARTICLE_GENERATION_TASK,
  modelId?: number | null,
): GenerationPreflight {
  const article = getArticleById(articleId);
  if (!article) throw new DraftNotFoundError('Draft not found.');

  const issues: string[] = [];

  const built = buildPrompt(articleId);
  const promptOk = !('errors' in built);
  if (!promptOk) issues.push(...(built as { errors: string[] }).errors);

  const resolution = resolveProviderTarget(taskType, modelId, 'Article Generation');
  if (resolution.error) issues.push(resolution.error.message);

  // COST SAFETY: the same decision the generate endpoint will make, surfaced
  // before the user commits, so nothing about the spend is a surprise.
  const routedModel = resolution.route?.model ?? null;
  const costClass: ModelCostClass = routedModel ? classifyModel(routedModel) : 'unknown';
  const cost =
    routedModel && promptOk
      ? estimateCost(routedModel, (built as { characterCount: number }).characterCount, ASSUMED_COMPLETION_TOKENS)
      : null;
  const spend = routedModel ? evaluateSpend(costClass, false) : null;

  if (spend && !spend.allowed && spend.reason && !spend.requiresConfirmation) {
    issues.push(spend.reason);
  }

  const articleType = article.articleTypeId ? getArticleTypeById(article.articleTypeId) : null;
  const author = article.authorId ? getAuthorById(article.authorId) : null;
  const product = article.productId ? getProductById(article.productId) : null;

  return {
    articleId,
    taskType,
    articleTypeName: articleType?.name ?? null,
    authorName: author?.name ?? null,
    productName: product?.title ?? null,
    provider: resolution.route?.provider
      ? {
          name: resolution.route.provider.name,
          providerType: resolution.route.provider.providerType,
          hasApiKey: resolution.route.provider.hasApiKey,
        }
      : null,
    model: resolution.route?.model
      ? {
          id: resolution.route.model.id,
          modelName: resolution.route.model.modelName,
          displayName: resolution.route.model.displayName,
          vendor: resolution.route.model.vendor,
          promptPrice: resolution.route.model.promptPrice,
          completionPrice: resolution.route.model.completionPrice,
          requestPrice: resolution.route.model.requestPrice,
          contextLength: resolution.route.model.contextLength,
          pricingSyncedAt: resolution.route.model.pricingSyncedAt,
        }
      : null,
    isExplicitSelection: resolution.route?.isExplicitSelection ?? false,
    promptCharacterCount: promptOk ? (built as { characterCount: number }).characterCount : null,
    promptWordCount: promptOk ? (built as { wordCount: number }).wordCount : null,
    // Ready means a request could actually be sent right now. A paid model
    // awaiting confirmation is still "ready" — the confirmation is the user's
    // next action, not a configuration fault.
    ready: promptOk && resolution.error === null && (spend === null || spend.allowed || spend.requiresConfirmation),
    issues,
    configurationErrorCode: resolution.error?.code ?? null,
    mode: getGenerationMode(),
    costClass,
    cost,
    spend,
  };
}

/* --------------------------------------------------------------- generation */

/**
 * Drafts currently being generated. Guards against a duplicate request — a
 * double-click, or a second browser tab — starting a second billable API call
 * for the same draft. In-memory is sufficient: Cynth is a single-user,
 * single-process local application (docs/02_VERSION1_SCOPE.md).
 */
const inFlight = new Set<number>();

export interface GenerationOutcome {
  generation: GeneratedArticleDto;
  /** Only what the provider actually reported. Null when it reported nothing. */
  usage: TokenUsage | null;
  historyId: number;
}

export interface GenerateOptions {
  /**
   * A deliberate user confirmation that this generation may cost money.
   *
   * Never defaulted to true anywhere. A paid generation without it is
   * refused, and there is no code path that substitutes a cheaper or free
   * model instead — that decision belongs to the user.
   */
  confirmedCost?: boolean;
  /**
   * A model the user explicitly chose, from Cynth's model registry.
   *
   * MODEL SAFETY: when this is set, this model is used or the generation
   * fails. Cynth does not fall back to the purpose default, does not retry
   * with another model, and above all never quietly moves from a free model
   * to a paid one. Omit it to use the configured default for the task.
   */
  modelId?: number | null;
}

export async function generateArticle(
  articleId: number,
  taskType: string = ARTICLE_GENERATION_TASK,
  options: GenerateOptions = {},
): Promise<GenerationOutcome> {
  const article = getArticleById(articleId);
  if (!article) throw new DraftNotFoundError('Draft not found.');

  const built = buildPrompt(articleId);
  if ('errors' in built) throw new DraftNotReadyError(built.errors);

  const resolution = resolveProviderTarget(taskType, options.modelId, 'Article Generation');
  if (resolution.error) {
    recordGeneration({
      articleId,
      taskType,
      providerName: resolution.route?.provider?.name ?? null,
      providerType: resolution.route?.provider?.providerType ?? null,
      model: resolution.route?.model?.modelName ?? null,
      status: 'failure',
      errorCode: resolution.error.code,
      errorMessage: resolution.error.message,
      metadata: { promptCharacterCount: built.characterCount, promptWordCount: built.wordCount },
    });
    throw resolution.error;
  }

  const target = resolution.target!;

  // COST SAFETY GATE. Everything above this point is free; everything below
  // it can spend money. A refusal here is final — Cynth never retries with a
  // different model, and never downgrades a paid model to a free one.
  const routedModel = resolution.route!.model!;
  // Recomputed here rather than trusted from the route, so the gate below
  // depends on nothing but the stored prices.
  const costClass = classifyModel(routedModel);
  const spend = evaluateSpend(costClass, options.confirmedCost === true);

  if (!spend.allowed) {
    const error = new GenerationError(
      spend.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      spend.reason ?? 'This generation is not permitted in the current mode.',
    );
    recordGeneration({
      articleId,
      taskType,
      providerName: target.providerName,
      providerType: target.providerType,
      model: target.modelName,
      status: 'failure',
      errorCode: error.code,
      errorMessage: error.message,
      metadata: { promptCharacterCount: built.characterCount, promptWordCount: built.wordCount },
    });
    throw error;
  }

  if (inFlight.has(articleId)) {
    throw new GenerationError(
      'generation_in_progress',
      'This draft is already being generated. Wait for the current attempt to finish.',
    );
  }
  inFlight.add(articleId);

  const startedAt = Date.now();
  // Captured before any throw, so a failed attempt can still record whatever
  // the provider said about the tokens it charged for.
  let usage: TokenUsage | null = null;
  let finishReason: string | null = null;

  try {
    const response = await target.adapter.generate(
      { prompt: built.prompt, model: target.modelName, timeoutMs: GENERATION_TIMEOUT_MS },
      { apiKey: target.apiKey, baseUrl: target.baseUrl },
    );

    usage = response.usage;
    finishReason = response.finishReason;

    const parsed = parseGeneratedArticle(response.text);
    if (!parsed.body.trim()) {
      throw new GenerationError(
        'empty_response',
        'The model returned an empty response. Nothing was saved — you can try again.',
      );
    }

    // PRODUCT PLACEMENT (Milestone 17). Read out of what the author actually
    // wrote, before the draft is saved, so the stored body and the recorded
    // placements can never disagree. Markers naming a product that was not
    // offered are dropped here rather than reaching a reader.
    const attachedProductIds = resolveProductIdsForArticle(articleId);
    const scan = scanProductPlacements(parsed.body, attachedProductIds);
    const body = attachedProductIds.length ? stripInvalidMarkers(parsed.body, attachedProductIds) : parsed.body;

    const generation = saveGeneratedArticle(articleId, {
      title: parsed.title,
      content: body,
      provider: target.providerName,
      model: target.modelName,
      promptVersion: built.promptVersion,
      generationMode: spend.mode,
    });
    if (!generation) throw new DraftNotFoundError('Draft not found.');

    // Where each product ended up, including the ones the author judged did
    // not belong anywhere — 'omitted' is recorded as the real outcome it is.
    if (attachedProductIds.length) {
      recordPlacements(
        articleId,
        scan.placements.map((placement) => ({ productId: placement.productId, section: placement.section })),
      );
    }

    const historyId = recordGeneration({
      articleId,
      taskType,
      providerName: target.providerName,
      providerType: target.providerType,
      model: target.modelName,
      status: 'success',
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      durationMs: Date.now() - startedAt,
      metadata: {
        promptCharacterCount: built.characterCount,
        promptWordCount: built.wordCount,
        finishReason,
        reportedModel: response.reportedModel,
        generatedCharacterCount: parsed.body.length,
        titleDetected: parsed.title !== null,
        promptVersion: built.promptVersion,
        generationMode: spend.mode,
        costClass,
        modelSelection: options.modelId ? 'explicit' : 'default',
      },
    });

    return { generation, usage, historyId };
  } catch (error) {
    // Every failure past this point is recorded, then re-thrown for the route
    // to translate. Cynth never retries on its own.
    const known = isGenerationError(error) ? error : null;
    const message = known
      ? known.message
      : truncateForDisplay(redactSecrets(error instanceof Error ? error.message : 'Unknown error.', [target.apiKey]));

    recordGeneration({
      articleId,
      taskType,
      providerName: target.providerName,
      providerType: target.providerType,
      model: target.modelName,
      status: 'failure',
      errorCode: known ? known.code : 'provider_error',
      errorMessage: message,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      durationMs: Date.now() - startedAt,
      metadata: {
        promptCharacterCount: built.characterCount,
        promptWordCount: built.wordCount,
        finishReason,
      },
    });

    if (known) throw known;
    throw new GenerationError('provider_error', `Generation failed: ${message}`);
  } finally {
    inFlight.delete(articleId);
  }
}
