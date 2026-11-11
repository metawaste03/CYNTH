import { getSetting, setSetting } from '../../shared/settings/settings.repository.js';

/**
 * COST SAFETY.
 *
 * Cynth can spend real money. Everything that decides whether a generation is
 * allowed to cost anything lives here, in one place, so the rule cannot be
 * accidentally bypassed by a caller that forgot to check.
 *
 * Two invariants this file exists to guarantee:
 *
 *   1. Cynth NEVER silently falls back from a free model to a paid one. There
 *      is no fallback path at all — a failed model is an error the user
 *      resolves, not a reason to charge them.
 *   2. A model whose price is UNKNOWN is treated as paid. Unknown is not free.
 */

export const GENERATION_MODE_KEY = 'generation.mode';

/**
 * test       — free models only. Paid generation is refused outright.
 * production — paid models allowed, but only with explicit per-request confirmation.
 *
 * Defaults to `test`: the safe state has to be the one you get by doing
 * nothing, because the unsafe state costs money.
 */
export type GenerationMode = 'test' | 'production';

export const DEFAULT_GENERATION_MODE: GenerationMode = 'test';

export function getGenerationMode(): GenerationMode {
  return getSetting(GENERATION_MODE_KEY) === 'production' ? 'production' : DEFAULT_GENERATION_MODE;
}

export function setGenerationMode(mode: GenerationMode): GenerationMode {
  setSetting(GENERATION_MODE_KEY, mode);
  return getGenerationMode();
}

export function isValidGenerationMode(value: unknown): value is GenerationMode {
  return value === 'test' || value === 'production';
}

/* ------------------------------------------------------------- pricing --- */

/** How a model is classified for cost purposes. `unknown` is deliberately distinct from `free`. */
export type ModelCostClass = 'free' | 'paid' | 'unknown';

/**
 * The prices a classification decision is allowed to look at.
 *
 * `requestPrice` is optional because not every catalogue publishes one; when
 * it is absent the classification rests on the per-token prices alone.
 */
export interface PricedModel {
  promptPrice: number | null;
  completionPrice: number | null;
  /** A flat per-request charge, where the catalogue publishes one. */
  requestPrice?: number | null;
  /**
   * The price of image output, where the catalogue publishes one.
   *
   * Optional because most models have none. Where it exists it is decisive:
   * an image model can publish zero per-token prices and still charge for
   * every image, so a classification that ignored this would call it free.
   */
  imageOutputPrice?: number | null;
}

/**
 * Free / paid / unknown, decided ONLY from pricing metadata the provider
 * published.
 *
 * Two rules this function exists to enforce:
 *
 *   1. A model's NAME is never evidence. OpenRouter lists ids ending in
 *      ":free", and it also lists paid models with "free" in their name.
 *      Nothing here reads the id at all, so neither can mislead it.
 *   2. Unknown is not free. A price the provider did not publish is a price
 *      Cynth does not know, and an unknown price is treated as paid
 *      everywhere downstream.
 *
 * A model is free only when EVERY price the catalogue publishes for it is
 * known and zero — the per-token prices, any flat per-request charge, and any
 * image-output charge. Each of those is a real charge on its own.
 */
export function classifyModel(model: PricedModel): ModelCostClass {
  const { promptPrice, completionPrice } = model;
  if (promptPrice === null || completionPrice === null) return 'unknown';

  // Absent is fine (not every catalogue publishes these); present-but-non-zero
  // is a charge and makes the model paid, whatever the per-token prices say.
  //
  // The image price is here because of a real model: OpenRouter lists
  // Seedream 4.5 with prompt 0, completion 0 and image output at $9.58/M
  // tokens. Classifying on the first two alone called a model that charges
  // for every image "free", which would have let it run in Test mode and skip
  // the cost confirmation entirely.
  for (const extra of [model.requestPrice, model.imageOutputPrice]) {
    if (extra !== null && extra !== undefined && extra !== 0) return 'paid';
  }

  return promptPrice === 0 && completionPrice === 0 ? 'free' : 'paid';
}

export interface CostEstimate {
  costClass: ModelCostClass;
  /** Null whenever the model's pricing is not known — never a guess. */
  currency: 'USD' | null;
  promptTokens: number | null;
  estimatedCompletionTokens: number | null;
  promptCost: number | null;
  completionCost: number | null;
  totalCost: number | null;
  /** Plain-language explanation shown to the user before they spend anything. */
  note: string;
}

/**
 * A rough token count for a prompt Cynth has already assembled.
 *
 * Deliberately labelled an estimate everywhere it surfaces: Cynth does not
 * ship a tokenizer, and the ~4-characters-per-token ratio is an approximation
 * that varies by model and language. It exists to give an order of magnitude
 * before spending, not to predict a bill.
 */
const CHARS_PER_TOKEN = 4;

export function estimatePromptTokens(promptCharacterCount: number): number {
  return Math.max(1, Math.ceil(promptCharacterCount / CHARS_PER_TOKEN));
}

/**
 * What a generation is expected to cost, from the provider's own published
 * prices. Returns nulls rather than numbers when pricing is unknown — an
 * invented figure would be worse than no figure.
 */
export function estimateCost(
  model: PricedModel,
  promptCharacterCount: number,
  expectedCompletionTokens: number,
): CostEstimate {
  const costClass = classifyModel(model);
  const promptTokens = estimatePromptTokens(promptCharacterCount);

  if (costClass === 'unknown') {
    return {
      costClass,
      currency: null,
      promptTokens,
      estimatedCompletionTokens: expectedCompletionTokens,
      promptCost: null,
      completionCost: null,
      totalCost: null,
      note: 'This model has no pricing on record. Sync the provider’s model catalogue to get prices; until then Cynth treats it as paid and will not estimate a cost.',
    };
  }

  // A flat per-request charge belongs in the total, not in either half.
  const requestCost = model.requestPrice ?? 0;
  const promptCost = promptTokens * (model.promptPrice ?? 0) + requestCost;
  const completionCost = expectedCompletionTokens * (model.completionPrice ?? 0);

  return {
    costClass,
    currency: 'USD',
    promptTokens,
    estimatedCompletionTokens: expectedCompletionTokens,
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
    note:
      costClass === 'free'
        ? 'This model is priced at zero by the provider. Generation should not cost anything.'
        : 'Estimated from the provider’s published per-token prices and an approximate token count. The actual charge depends on how much the model writes.',
  };
}

/** How many output tokens a full article is assumed to need when estimating cost up front. */
export const ASSUMED_COMPLETION_TOKENS = 2500;

/* --------------------------------------------------------------- guard --- */

export interface SpendDecision {
  allowed: boolean;
  /** True when the user must explicitly confirm the spend before Cynth proceeds. */
  requiresConfirmation: boolean;
  costClass: ModelCostClass;
  mode: GenerationMode;
  reason: string | null;
}

/**
 * The single gate every paid generation must pass.
 *
 * `confirmed` comes from a deliberate user action, never from a default.
 * Nothing here can promote a refused request into an allowed one, and there
 * is no branch that substitutes a different model.
 */
export function evaluateSpend(costClass: ModelCostClass, confirmed: boolean): SpendDecision {
  const mode = getGenerationMode();

  if (costClass === 'free') {
    return { allowed: true, requiresConfirmation: false, costClass, mode, reason: null };
  }

  if (mode === 'test') {
    return {
      allowed: false,
      requiresConfirmation: false,
      costClass,
      mode,
      reason:
        costClass === 'unknown'
          ? 'Cynth is in Test mode, which allows free models only. This model has no pricing on record, so it is treated as paid. Sync the provider catalogue, or switch to Production mode to use it.'
          : 'Cynth is in Test mode, which allows free models only. Switch to Production mode in Settings to generate with a paid model.',
    };
  }

  if (!confirmed) {
    return {
      allowed: false,
      requiresConfirmation: true,
      costClass,
      mode,
      reason: 'This is a paid model. Confirm the estimated cost to continue.',
    };
  }

  return { allowed: true, requiresConfirmation: false, costClass, mode, reason: null };
}
