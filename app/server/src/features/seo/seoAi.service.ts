import { resolveProviderTarget } from '../generation/providerTarget.service.js';
import type { ResolvedTarget } from '../generation/providerTarget.service.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import {
  classifyModel,
  estimateCost,
  evaluateSpend,
  getGenerationMode,
} from '../generation/generationPolicy.service.js';
import type { CostEstimate, GenerationMode, ModelCostClass, SpendDecision } from '../generation/generationPolicy.service.js';
import type { TokenUsage } from '../generation/generation.types.js';
import { SEO_ANALYSIS_TASK } from './seo.constants.js';
import { buildSeoAnalysisPrompt } from './seoPrompt.service.js';
import type { AssembledSeoPrompt, SeoPromptInput } from './seoPrompt.service.js';
import { parseSeoAnalysisResponse, SeoResponseParseError } from './seoAi.parse.js';
import type { ParsedSeoAnalysis } from './seoAi.parse.js';

/**
 * AI-ASSISTED SEO ANALYSIS.
 *
 * The only part of the SEO engine that can cost money, kept in one file so
 * the guarantees are inspectable in one place:
 *
 *   1. IT ROUTES THROUGH THE EXISTING ARCHITECTURE. The provider and model
 *      come from the Model Router under the `seo_review` purpose, exactly as
 *      article generation comes from it under `article_generation`. No
 *      provider is named here, no endpoint is named here, and no key is
 *      chosen here. Adding a provider to Cynth adds it to SEO analysis.
 *   2. IT PASSES THE SAME SPEND GATE. Test mode refuses a paid model
 *      outright; Production mode requires an explicit per-request
 *      confirmation. `confirmedCost` is never defaulted to true anywhere.
 *   3. IT NEVER SUBSTITUTES A MODEL. A selected model runs or the analysis
 *      fails. There is no path from a free model to a paid one, and none from
 *      a failed model to a working one.
 *   4. IT NEVER SILENTLY RETRIES. One attempt per request, like generation.
 *
 * How much SEO analysis costs is a question of how often it runs. The
 * deterministic pass covers everything code can decide, and the caller reuses
 * a previous AI run whose fingerprints still match, so the model is asked
 * only when there is genuinely a new question.
 */

/** How long one SEO analysis request may take. Shorter than article generation: this reads, it does not write an article. */
export const SEO_ANALYSIS_TIMEOUT_MS = 120_000;

/** Output tokens a structured SEO analysis is assumed to need, for the up-front cost estimate. */
export const ASSUMED_SEO_COMPLETION_TOKENS = 1800;

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
  mode: GenerationMode;
  costClass: ModelCostClass;
  cost: CostEstimate | null;
  spend: SpendDecision | null;
  /** True only when a request could actually be sent right now. */
  ready: boolean;
  issues: string[];
  configurationErrorCode: string | null;
}

/**
 * What the user sees before pressing "Run AI analysis". Reads local state
 * only — contacts no provider and costs nothing.
 */
export function getSeoAiPreflight(prompt: AssembledSeoPrompt | null, modelId?: number | null): SeoAiPreflight {
  const issues: string[] = [];
  const resolution = resolveProviderTarget(SEO_ANALYSIS_TASK, modelId, 'SEO Analysis');
  if (resolution.error) issues.push(resolution.error.message);

  const routedModel = resolution.route?.model ?? null;
  const costClass: ModelCostClass = routedModel ? classifyModel(routedModel) : 'unknown';
  const cost =
    routedModel && prompt ? estimateCost(routedModel, prompt.characterCount, ASSUMED_SEO_COMPLETION_TOKENS) : null;
  const spend = routedModel ? evaluateSpend(costClass, false) : null;

  if (spend && !spend.allowed && spend.reason && !spend.requiresConfirmation) issues.push(spend.reason);
  if (!prompt) issues.push('There is nothing to analyse: the article has no generated content.');

  return {
    taskType: SEO_ANALYSIS_TASK,
    provider: resolution.route?.provider
      ? {
          name: resolution.route.provider.name,
          providerType: resolution.route.provider.providerType,
          hasApiKey: resolution.route.provider.hasApiKey,
        }
      : null,
    model: routedModel
      ? {
          id: routedModel.id,
          modelName: routedModel.modelName,
          displayName: routedModel.displayName,
          vendor: routedModel.vendor,
          promptPrice: routedModel.promptPrice,
          completionPrice: routedModel.completionPrice,
          requestPrice: routedModel.requestPrice,
          contextLength: routedModel.contextLength,
          pricingSyncedAt: routedModel.pricingSyncedAt,
        }
      : null,
    isExplicitSelection: resolution.route?.isExplicitSelection ?? false,
    promptCharacterCount: prompt?.characterCount ?? null,
    promptWordCount: prompt?.wordCount ?? null,
    mode: getGenerationMode(),
    costClass,
    cost,
    spend,
    ready:
      prompt !== null &&
      resolution.error === null &&
      (spend === null || spend.allowed || spend.requiresConfirmation),
    issues,
    configurationErrorCode: resolution.error?.code ?? null,
  };
}

export interface SeoAiRequest {
  promptInput: SeoPromptInput;
  /** Article ids the model may reference for internal links. Anything else is discarded on parse. */
  allowedArticleIds: Set<number>;
  /** A deliberate user confirmation that this analysis may cost money. Never defaulted to true. */
  confirmedCost: boolean;
  /** A model the user explicitly chose. Omit to use the configured default for SEO analysis. */
  modelId?: number | null;
}

export interface SeoAiOutcome {
  analysis: ParsedSeoAnalysis;
  prompt: AssembledSeoPrompt;
  target: { providerName: string; providerType: string; modelName: string };
  costClass: ModelCostClass;
  mode: GenerationMode;
  usage: TokenUsage | null;
  durationMs: number;
}

/** Guards against a double-click starting a second billable analysis for the same article. */
const inFlight = new Set<number>();

/**
 * Runs one AI-assisted SEO analysis.
 *
 * Throws a GenerationError on every failure path — the same error vocabulary
 * article generation uses, so the routes and the UI already know how to
 * report a missing key, a rate limit, a refused spend, or a timeout.
 */
export async function runSeoAiAnalysis(articleId: number, request: SeoAiRequest): Promise<SeoAiOutcome> {
  const prompt = buildSeoAnalysisPrompt(request.promptInput);

  const resolution = resolveProviderTarget(SEO_ANALYSIS_TASK, request.modelId, 'SEO Analysis');
  if (resolution.error) throw resolution.error;

  const target: ResolvedTarget = resolution.target!;
  const routedModel = resolution.route!.model!;

  // COST SAFETY GATE. Everything above this line is free; everything below it
  // can spend money. Recomputed from the stored prices rather than trusted
  // from the route, so the gate depends on nothing but the pricing metadata.
  const costClass = classifyModel(routedModel);
  const spend = evaluateSpend(costClass, request.confirmedCost === true);

  if (!spend.allowed) {
    throw new GenerationError(
      spend.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      spend.reason ?? 'This SEO analysis is not permitted in the current mode.',
    );
  }

  if (inFlight.has(articleId)) {
    throw new GenerationError(
      'generation_in_progress',
      'An SEO analysis is already running for this article. Wait for it to finish.',
    );
  }
  inFlight.add(articleId);

  const startedAt = Date.now();
  try {
    const response = await target.adapter.generate(
      { prompt: prompt.prompt, model: target.modelName, timeoutMs: SEO_ANALYSIS_TIMEOUT_MS },
      { apiKey: target.apiKey, baseUrl: target.baseUrl },
    );

    if (!response.text.trim()) {
      throw new GenerationError(
        'empty_response',
        'The model returned an empty response. Nothing was saved — you can try again.',
      );
    }

    let analysis: ParsedSeoAnalysis;
    try {
      analysis = parseSeoAnalysisResponse(response.text, {
        document: request.promptInput.document,
        allowedArticleIds: request.allowedArticleIds,
      });
    } catch (error) {
      // A response Cynth cannot validate is recorded as a failure, not
      // salvaged into findings the model may never have made.
      throw new GenerationError(
        'empty_response',
        error instanceof SeoResponseParseError
          ? `The model's SEO analysis could not be read: ${error.message} Nothing was saved.`
          : 'The model returned an SEO analysis Cynth could not read. Nothing was saved.',
      );
    }

    return {
      analysis,
      prompt,
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
  } catch (error) {
    if (isGenerationError(error)) throw error;
    const message = truncateForDisplay(
      redactSecrets(error instanceof Error ? error.message : 'Unknown error.', [target.apiKey]),
    );
    throw new GenerationError('provider_error', `SEO analysis failed: ${message}`);
  } finally {
    inFlight.delete(articleId);
  }
}
