import { getArticleById, saveGeneratedArticle } from '../articles/articles.repository.js';
import type { GeneratedArticleDto } from '../articles/articles.repository.js';
import { getArticleTypeById } from '../article-types/article-types.repository.js';
import { getAuthorById } from '../authors/authors.repository.js';
import { getProductById } from '../products/products.repository.js';
import { buildPrompt } from '../prompt-builder/promptBuilder.service.js';
import { routeForPurpose } from '../model-router/modelRouter.service.js';
import type { ModelRouteResult } from '../model-router/modelRouter.service.js';
import { getProviderApiKey } from '../ai-providers/aiProviders.repository.js';
import { getAdapter } from './providers/index.js';
import type { ProviderAdapter, TokenUsage } from './generation.types.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from './generation.errors.js';
import { GENERATION_TIMEOUT_MS } from './generation.constants.js';
import { parseGeneratedArticle } from './generation.parse.js';
import { recordGeneration } from './generationHistory.repository.js';

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

interface ResolvedTarget {
  providerName: string;
  providerType: string;
  baseUrl: string | null;
  modelName: string;
  adapter: ProviderAdapter;
  /** Server-side only. Never returned by a route, never logged, never persisted. */
  apiKey: string;
}

interface TargetResolution {
  /** Display-safe routing info, present whenever the router found a provider/model at all. */
  route: ModelRouteResult | null;
  target: ResolvedTarget | null;
  /** The first blocking problem, if any — thrown by generation, listed by preflight. */
  error: GenerationError | null;
}

/**
 * Asks the Model Router which provider/model handles this task, then checks
 * everything a request needs: a supported adapter, a model name, and a key
 * that is actually present. Returns rather than throws, so the preflight
 * check can report the same problem the generation call would hit, before
 * anything is sent.
 */
function resolveGenerationTarget(taskType: string): TargetResolution {
  const routed = routeForPurpose(taskType);

  if ('errors' in routed) {
    return {
      route: null,
      target: null,
      error: new GenerationError('invalid_configuration', 'Unknown generation task type.'),
    };
  }

  if (!routed.configured || !routed.provider || !routed.model) {
    const reason = routed.reason ? `${routed.reason} ` : '';
    return {
      route: routed,
      target: null,
      error: new GenerationError(
        'provider_not_configured',
        `No model is configured for Article Generation. ${reason}Open Settings then AI Providers, and set a default model for this task.`,
      ),
    };
  }

  const adapter = getAdapter(routed.provider.providerType);
  if (!adapter) {
    return {
      route: routed,
      target: null,
      error: new GenerationError(
        'unsupported_provider',
        `Cynth has no adapter for provider type "${routed.provider.providerType}". Supported types are OpenRouter, Anthropic, and OpenAI.`,
      ),
    };
  }

  if (!routed.model.modelName.trim()) {
    return {
      route: routed,
      target: null,
      error: new GenerationError(
        'missing_model',
        'The configured provider has no model name set. Add one in Settings then AI Providers.',
      ),
    };
  }

  const apiKey = getProviderApiKey(routed.provider.id);
  if (!apiKey) {
    return {
      route: routed,
      target: null,
      error: new GenerationError(
        'missing_api_key',
        `No API key is stored for "${routed.provider.name}". Add one in Settings then AI Providers.`,
      ),
    };
  }

  return {
    route: routed,
    error: null,
    target: {
      providerName: routed.provider.name,
      providerType: routed.provider.providerType,
      baseUrl: routed.provider.baseUrl,
      modelName: routed.model.modelName,
      adapter,
      apiKey,
    },
  };
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
  model: { modelName: string; displayName: string | null } | null;
  promptCharacterCount: number | null;
  promptWordCount: number | null;
  /** True only when a request could actually be sent right now. */
  ready: boolean;
  /** Everything standing in the way, in plain language. */
  issues: string[];
  /** Set when the blocking problem is configuration, so the UI can point at AI Provider settings. */
  configurationErrorCode: string | null;
}

/** What the user sees before pressing Generate. Reads local state only — contacts no provider. */
export function getGenerationPreflight(
  articleId: number,
  taskType: string = ARTICLE_GENERATION_TASK,
): GenerationPreflight {
  const article = getArticleById(articleId);
  if (!article) throw new DraftNotFoundError('Draft not found.');

  const issues: string[] = [];

  const built = buildPrompt(articleId);
  const promptOk = !('errors' in built);
  if (!promptOk) issues.push(...(built as { errors: string[] }).errors);

  const resolution = resolveGenerationTarget(taskType);
  if (resolution.error) issues.push(resolution.error.message);

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
      ? { modelName: resolution.route.model.modelName, displayName: resolution.route.model.displayName }
      : null,
    promptCharacterCount: promptOk ? (built as { characterCount: number }).characterCount : null,
    promptWordCount: promptOk ? (built as { wordCount: number }).wordCount : null,
    ready: promptOk && resolution.error === null,
    issues,
    configurationErrorCode: resolution.error?.code ?? null,
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

export async function generateArticle(
  articleId: number,
  taskType: string = ARTICLE_GENERATION_TASK,
): Promise<GenerationOutcome> {
  const article = getArticleById(articleId);
  if (!article) throw new DraftNotFoundError('Draft not found.');

  const built = buildPrompt(articleId);
  if ('errors' in built) throw new DraftNotReadyError(built.errors);

  const resolution = resolveGenerationTarget(taskType);
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

    const generation = saveGeneratedArticle(articleId, {
      title: parsed.title,
      content: parsed.body,
      provider: target.providerName,
      model: target.modelName,
    });
    if (!generation) throw new DraftNotFoundError('Draft not found.');

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
