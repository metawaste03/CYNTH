import { getDatabase } from '../../shared/database/index.js';
import { getAdapter } from '../generation/providers/index.js';
import { getProviderById } from '../ai-providers/aiProviders.repository.js';
import { getSecret } from '../../shared/secrets/secretStore.js';
import { GenerationError, isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import { classifyModel, estimateCost, evaluateSpend } from '../generation/generationPolicy.service.js';
import { recordGeneration } from '../generation/generationHistory.repository.js';
import type { TokenUsage } from '../generation/generation.types.js';
import { getRoleAssignment } from './roleRegistry.repository.js';
import type { RoleModelDto } from './roleRegistry.repository.js';
import {
  beginStageRun,
  completeStageRun,
  failStageRun,
  findCompletedStage,
  getPipelineById,
} from './pipeline.repository.js';
import type { StageRunDto } from './pipeline.repository.js';
import { STAGE_DEFINITIONS } from './pipeline.constants.js';
import type { PipelineStage } from './pipeline.constants.js';

/**
 * THE STAGE RUNNER — one place where every paid stage passes through the same
 * four gates, in the same order, so none of them can be forgotten by a stage
 * author:
 *
 *   1. IDEMPOTENCE. A stage with a successful run for this pipeline version
 *      returns that stored result and calls nothing. This is what makes a
 *      restart, a refresh or a reopened article free.
 *   2. THE SPEND GATE. The same gate article generation and SEO analysis use.
 *      Test mode refuses a paid model; Production requires an explicit
 *      per-request confirmation. `confirmedCost` is never defaulted to true.
 *   3. THE CALL. One attempt on the primary model.
 *   4. TECHNICAL FALLBACK. If — and only if — the primary failed for a
 *      technical reason, the configured fallback is tried once. It passes the
 *      spend gate independently, so a free primary can never fall back to a
 *      paid model in Test mode.
 *
 * A poor-quality result is NOT a technical failure and never triggers a
 * fallback. That path is the editorial revision, capped at one, and it lives
 * in the pipeline service rather than here.
 */

/** Provider failures that are worth trying a different model for. */
const FALLBACK_ELIGIBLE_CODES = new Set([
  'provider_error',
  'timeout',
  'network_error',
  'rate_limited',
  'empty_response',
  'model_not_found',
]);

export interface StageRequest {
  pipelineId: number;
  stage: PipelineStage;
  /** The assembled prompt. Stage services build this; the runner never writes one. */
  prompt: string;
  /** Parses and validates the model's reply. Throwing here fails the stage — it does not trigger a fallback. */
  parse: (text: string) => unknown;
  timeoutMs: number;
  /** Output tokens assumed for the up-front cost estimate. */
  assumedCompletionTokens: number;
  confirmedCost?: boolean;
  /** Forces a fresh execution even when a successful run exists. The user's explicit RERUN STAGE. */
  rerun?: boolean;
}

export interface StageResult {
  run: StageRunDto;
  output: unknown;
  /** True when the stored result was returned and nothing was called or spent. */
  reused: boolean;
}

interface ResolvedModel {
  model: RoleModelDto;
  apiKey: string;
  baseUrl: string | null;
  providerType: string;
}

/** Turns an assigned model into something callable, or explains why it is not. */
function resolveCallable(model: RoleModelDto | null, label: string): ResolvedModel | GenerationError {
  if (!model) return new GenerationError('provider_not_configured', `No model is assigned to ${label}.`);
  if (!model.isEnabled) {
    return new GenerationError('provider_not_configured', `The model assigned to ${label} is disabled.`);
  }

  const db = getProviderById(modelProviderId(model.id));
  if (!db) return new GenerationError('provider_not_configured', `The provider for ${label} no longer exists.`);
  if (!db.isActive) return new GenerationError('provider_not_configured', `The provider for ${label} is inactive.`);

  const adapter = getAdapter(db.providerType);
  if (!adapter) {
    return new GenerationError('unsupported_provider', `Cynth has no adapter for ${db.providerType}.`);
  }

  const apiKey = getSecret(db.apiKeyEnvVar);
  if (!apiKey) {
    return new GenerationError('missing_api_key', `No API key is stored for the provider behind ${label}.`);
  }

  return { model, apiKey, baseUrl: db.baseUrl, providerType: db.providerType };
}

/** The provider a model belongs to. Read here rather than carried on the DTO, which stays presentation-shaped. */
function modelProviderId(modelId: number): number {
  const row = getDatabase().prepare('SELECT provider_id FROM ai_provider_models WHERE id = ?').get(modelId) as
    | { provider_id: number }
    | undefined;
  return row?.provider_id ?? -1;
}

/**
 * Runs one paid stage.
 *
 * Throws a GenerationError on every failure path, using the same vocabulary
 * article generation already uses, so routes and UI need no new error handling.
 */
export async function runStage(request: StageRequest): Promise<StageResult> {
  const pipeline = getPipelineById(request.pipelineId);
  if (!pipeline) throw new GenerationError('invalid_configuration', 'Pipeline not found.');

  const definition = STAGE_DEFINITIONS[request.stage];
  if (!definition) throw new GenerationError('invalid_configuration', `Unknown stage ${request.stage}.`);

  /* ---- GATE 1: idempotence -------------------------------------------- */
  if (!request.rerun) {
    const existing = findCompletedStage(pipeline.id, pipeline.version, request.stage);
    if (existing) return { run: existing, output: existing.output, reused: true };
  }

  const role = definition.role;
  if (!role) throw new GenerationError('invalid_configuration', `${request.stage} is not a model stage.`);

  const assignment = getRoleAssignment(role, pipeline.mode);
  const primary = resolveCallable(assignment.primary, assignment.label);
  if (primary instanceof GenerationError) throw primary;

  /* ---- GATE 2: the spend gate ----------------------------------------- */
  const spend = spendFor(primary.model, request.confirmedCost === true, request.prompt, request.assumedCompletionTokens);
  if (!spend.decision.allowed) {
    // The refusal carries the figure. "Confirm the estimated cost" without an
    // estimate is not a question anyone can answer, and that is exactly what
    // this used to be.
    throw new GenerationError(
      spend.decision.requiresConfirmation ? 'cost_confirmation_required' : 'paid_generation_blocked',
      spend.decision.reason ?? `${assignment.label} is not permitted in the current mode.`,
      {
        stage: request.stage,
        stageLabel: definition.label,
        model: primary.model.modelName,
        costClass: spend.costClass,
        estimatedCost: spend.estimate?.totalCost ?? null,
      },
    );
  }

  const run = beginStageRun({
    pipelineId: pipeline.id,
    version: pipeline.version,
    stage: request.stage,
    role,
    requestedModel: primary.model.modelName,
  });

  const startedAt = Date.now();

  /* ---- GATE 3: the call ------------------------------------------------ */
  try {
    const output = await callModel(primary, request);
    return {
      run: completeStageRun(run.id, finish(primary.model, output, startedAt, false)),
      output: output.parsed,
      reused: false,
    };
  } catch (primaryError) {
    const error = isGenerationError(primaryError)
      ? primaryError
      : new GenerationError(
          'provider_error',
          truncateForDisplay(
            redactSecrets(primaryError instanceof Error ? primaryError.message : 'Unknown error.', [primary.apiKey]),
          ),
        );

    /* ---- GATE 4: technical fallback ----------------------------------- */
    const fallbackModel = assignment.fallback;
    const eligible =
      FALLBACK_ELIGIBLE_CODES.has(error.code) &&
      fallbackModel !== null &&
      fallbackModel.fallbackEligible &&
      fallbackModel.id !== primary.model.id;

    if (!eligible) {
      failStageRun(run.id, {
        errorCode: error.code,
        errorMessage: error.message,
        durationMs: Date.now() - startedAt,
        actualModel: primary.model.modelName,
      });
      recordFailure(pipeline.id, request.stage, primary.model.modelName, error, Date.now() - startedAt, false);
      throw error;
    }

    const fallback = resolveCallable(fallbackModel, `${assignment.label} (fallback)`);
    if (fallback instanceof GenerationError) {
      failStageRun(run.id, {
        errorCode: error.code,
        errorMessage: `${error.message} The configured fallback could not be used: ${fallback.message}`,
        durationMs: Date.now() - startedAt,
        actualModel: primary.model.modelName,
      });
      throw error;
    }

    // The fallback passes the spend gate on its own terms. This is what stops
    // a failure on a free model from quietly becoming spend on a paid one.
    const fallbackSpend = spendFor(
      fallback.model,
      request.confirmedCost === true,
      request.prompt,
      request.assumedCompletionTokens,
    );
    if (!fallbackSpend.decision.allowed) {
      failStageRun(run.id, {
        errorCode: error.code,
        errorMessage: `${error.message} The fallback ${fallback.model.modelName} was not used: ${fallbackSpend.decision.reason}`,
        durationMs: Date.now() - startedAt,
        actualModel: primary.model.modelName,
      });
      throw error;
    }

    try {
      const output = await callModel(fallback, request);
      return {
        run: completeStageRun(run.id, finish(fallback.model, output, startedAt, true)),
        output: output.parsed,
        reused: false,
      };
    } catch (fallbackError) {
      const finalError = isGenerationError(fallbackError)
        ? fallbackError
        : new GenerationError(
            'provider_error',
            truncateForDisplay(
              redactSecrets(fallbackError instanceof Error ? fallbackError.message : 'Unknown error.', [
                fallback.apiKey,
              ]),
            ),
          );

      failStageRun(run.id, {
        errorCode: finalError.code,
        errorMessage: `Primary ${primary.model.modelName} failed (${error.code}); fallback ${fallback.model.modelName} also failed: ${finalError.message}`,
        durationMs: Date.now() - startedAt,
        actualModel: fallback.model.modelName,
      });
      recordFailure(pipeline.id, request.stage, fallback.model.modelName, finalError, Date.now() - startedAt, true);
      throw finalError;
    }
  }
}

interface CallOutput {
  parsed: unknown;
  usage: TokenUsage | null;
  reportedModel: string | null;
  characterCount: number;
}

async function callModel(resolved: ResolvedModel, request: StageRequest): Promise<CallOutput> {
  const adapter = getAdapter(resolved.providerType)!;

  const response = await adapter.generate(
    { prompt: request.prompt, model: resolved.model.modelName, timeoutMs: request.timeoutMs },
    { apiKey: resolved.apiKey, baseUrl: resolved.baseUrl },
  );

  if (!response.text.trim()) {
    throw new GenerationError('empty_response', 'The model returned an empty response.');
  }

  // A parse failure is an editorial/format problem, not a transport one. It is
  // thrown with a code that is NOT fallback-eligible, so a malformed reply
  // never causes a second model to be paid for the same question.
  let parsed: unknown;
  try {
    parsed = request.parse(response.text);
  } catch (error) {
    throw new GenerationError(
      'invalid_configuration',
      `The model's reply could not be read: ${error instanceof Error ? error.message : 'unrecognised format'}.`,
    );
  }

  return {
    parsed,
    usage: response.usage,
    reportedModel: response.reportedModel ?? null,
    characterCount: request.prompt.length,
  };
}

function spendFor(model: RoleModelDto, confirmed: boolean, prompt: string, assumedCompletion: number) {
  // classifyModel and estimateCost read the stored prices, so a model with no
  // published pricing classifies as unknown and is gated accordingly.
  const priced = {
    id: model.id,
    modelName: model.modelName,
    promptPrice: model.promptPrice,
    completionPrice: model.completionPrice,
    requestPrice: null,
    // A model priced only for image output publishes zero per-token prices.
    // Without this it would classify as free and skip the gate below.
    imageOutputPrice: model.imageOutputPrice,
    isFree: model.isFree,
  } as any;

  return {
    costClass: classifyModel(priced),
    estimate: estimateCost(priced, prompt.length, assumedCompletion),
    decision: evaluateSpend(classifyModel(priced), confirmed),
  };
}

function finish(model: RoleModelDto, output: CallOutput, startedAt: number, wasFallback: boolean) {
  const estimate = estimateCost(
    {
      id: model.id,
      modelName: model.modelName,
      promptPrice: model.promptPrice,
      completionPrice: model.completionPrice,
      requestPrice: null,
      isFree: model.isFree,
    } as any,
    output.characterCount,
    output.usage?.completionTokens ?? 0,
  );

  return {
    actualModel: output.reportedModel ?? model.modelName,
    provider: model.providerName,
    wasFallback,
    promptTokens: output.usage?.promptTokens ?? null,
    completionTokens: output.usage?.completionTokens ?? null,
    cachedTokens: null,
    totalTokens: output.usage?.totalTokens ?? null,
    estimatedCost: estimate?.totalCost ?? null,
    durationMs: Date.now() - startedAt,
    output: output.parsed,
  };
}

function recordFailure(
  pipelineId: number,
  stage: PipelineStage,
  model: string,
  error: GenerationError,
  durationMs: number,
  wasFallback: boolean,
): void {
  const pipeline = getPipelineById(pipelineId);
  recordGeneration({
    articleId: pipeline?.articleId ?? null,
    taskType: stage,
    providerName: null,
    providerType: null,
    model,
    status: 'failure',
    errorCode: error.code,
    errorMessage: error.message,
    durationMs,
    metadata: { pipelineId, stage, wasFallback },
  });
}
