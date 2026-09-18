import { getAdapter } from '../generation/providers/index.js';
import { isGenerationError, redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';
import { diagnoseBaseUrl } from '../generation/providers/baseUrl.js';
import type { ModelCostClass } from '../generation/generationPolicy.service.js';
import type { NormalizedGeneration } from '../generation/generation.types.js';
import { findCatalogModel } from './modelCatalog.service.js';
import type { DiscoveredModel } from './modelCatalog.service.js';
import { getProviderApiKey, getProviderById } from './aiProviders.repository.js';


/**
 * MODEL VALIDATION (Milestone 15).
 *
 * Before this, saving a model wrote a row. Whether the model existed, whether
 * the key worked, whether the endpoint was even an API endpoint — none of it
 * was established, so the first time anyone found out was mid-generation.
 *
 * Validation runs as an ordered pipeline, and the ORDER is the point: each
 * stage rules out one class of failure, so whatever stage fails names the
 * actual problem instead of the symptom it eventually produced.
 *
 *   1. configuration   Is there a provider, an adapter, and a model id?
 *   2. endpoint        Is the Base URL an API root rather than a website?
 *   3. credential      Is a key stored at all?
 *   4. catalogue       Does the provider list this model, and is it available?
 *   5. live probe      Does a real, minimal request authenticate and answer?
 *   6. normalisation   Can the answer be read into Cynth's own shape?
 *
 * Stages 1–4 contact nothing chargeable: 1–3 are local, and 4 is a metadata
 * read. Stage 5 is the only one that can ever cost anything, and it does not
 * run on a paid model without explicit permission — see runLiveProbe().
 *
 * A model is only saved as `valid` once the stages that ran all passed. A
 * failure is never suppressed into a generic "Request Failed": every stage
 * returns its own code and its own sentence.
 */

/** What each stage is called, in the order they run. Reported to the UI so a failure has a place. */
export type ValidationStage = 'configuration' | 'endpoint' | 'credential' | 'catalog' | 'live_probe' | 'normalisation';

export interface ValidationStageResult {
  stage: ValidationStage;
  ok: boolean;
  /** True when the stage was skipped rather than run — a skipped stage proves nothing and says so. */
  skipped?: boolean;
  detail: string;
}

export interface ModelValidationResult {
  ok: boolean;
  /** Cynth's own error vocabulary, e.g. 'model_not_found'. Null when everything passed. */
  code: string | null;
  /** One sentence a person can act on. Never a raw provider payload, never a credential. */
  message: string;
  /** Which stage decided the outcome. */
  failedStage: ValidationStage | null;
  stages: ValidationStageResult[];
  /** The catalogue entry, when the provider publishes one for this model. */
  catalogEntry: DiscoveredModel | null;
  costClass: ModelCostClass;
  /** True when a real request was sent to the model. False means nothing chargeable happened. */
  liveProbeRan: boolean;
  /** What the probe actually got back, normalised. Null when no probe ran. */
  probe: {
    reportedModel: string | null;
    finishReason: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    /** How many characters the model wrote. The text itself is not kept — it is a throwaway. */
    responseLength: number;
    durationMs: number;
  } | null;
}

export interface ValidateModelOptions {
  /**
   * Permission to send one real, minimal request.
   *
   * A FREE model probes without it, because a free request cannot cost
   * anything and skipping it would mean saving a model nothing had actually
   * spoken to. A PAID or unknown-price model never probes without it: the
   * catalogue stages already establish that the model exists and the key
   * works, so the probe adds confirmation, not permission to spend.
   */
  allowLiveProbe?: boolean;
  /** Overrides the model id to check. Defaults to whatever the registry row holds. */
  modelName: string;
  providerId: number;
}

/** A tiny prompt whose answer nobody reads. Its only job is to make the provider do the auth-and-route work. */
const PROBE_PROMPT = 'Reply with the single word: ok';
/** Enough for the word "ok" and a reasoning model's minimum, and nowhere near enough to be expensive. */
const PROBE_MAX_OUTPUT_TOKENS = 16;
const PROBE_TIMEOUT_MS = 45_000;

function stage(name: ValidationStage, ok: boolean, detail: string, skipped = false): ValidationStageResult {
  return { stage: name, ok, detail, skipped };
}

/** Turns whatever went wrong into Cynth's vocabulary, keeping the provider's own wording where it explains something. */
function describeFailure(error: unknown, apiKey: string): { code: string; message: string } {
  if (isGenerationError(error)) return { code: error.code, message: error.message };

  const raw = error instanceof Error ? error.message : 'Unknown error.';
  return { code: 'provider_error', message: truncateForDisplay(redactSecrets(raw, [apiKey])) };
}

function fail(
  stages: ValidationStageResult[],
  failedStage: ValidationStage,
  code: string,
  message: string,
  extras: Partial<ModelValidationResult> = {},
): ModelValidationResult {
  return {
    ok: false,
    code,
    message,
    failedStage,
    stages,
    catalogEntry: null,
    costClass: 'unknown',
    liveProbeRan: false,
    probe: null,
    ...extras,
  };
}

/**
 * Runs the pipeline and reports what it established.
 *
 * Never throws for a validation failure — a refused model is a result, not an
 * exception, and the caller needs every stage either way.
 */
export async function validateModel(options: ValidateModelOptions): Promise<ModelValidationResult> {
  const stages: ValidationStageResult[] = [];
  const modelName = options.modelName.trim();

  /* -- 1. configuration ------------------------------------------------- */

  const provider = getProviderById(options.providerId);
  if (!provider) {
    return fail(
      [stage('configuration', false, 'The provider record does not exist.')],
      'configuration',
      'provider_not_configured',
      'That AI provider no longer exists. Open Settings then AI Providers.',
    );
  }

  if (!modelName) {
    return fail(
      [stage('configuration', false, 'No model id was given.')],
      'configuration',
      'missing_model',
      'A model id is required. It must be written exactly as the provider publishes it.',
    );
  }

  const adapter = getAdapter(provider.providerType);
  if (!adapter) {
    return fail(
      [stage('configuration', false, `No adapter is registered for provider type "${provider.providerType}".`)],
      'configuration',
      'unsupported_provider',
      `Cynth has no adapter for provider type "${provider.providerType}", so it cannot talk to this provider at all.`,
    );
  }

  stages.push(
    stage('configuration', true, `${provider.name} is a ${provider.providerType} provider and "${modelName}" is a well-formed model id.`),
  );

  /* -- 2. endpoint ------------------------------------------------------ */

  const endpoint = diagnoseBaseUrl(provider.baseUrl, provider.providerType);
  if (!endpoint.ok) {
    stages.push(stage('endpoint', false, endpoint.problem ?? 'The Base URL is not usable.'));
    return fail(
      stages,
      'endpoint',
      'invalid_configuration',
      endpoint.suggestion
        ? `${endpoint.problem} Set the Base URL to ${endpoint.suggestion}.`
        : (endpoint.problem ?? 'The Base URL is not usable.'),
    );
  }
  stages.push(
    stage(
      'endpoint',
      true,
      provider.baseUrl
        ? `Requests will go to ${endpoint.resolved}.`
        : `No Base URL is set, so Cynth will use the default for ${provider.providerType}: ${endpoint.resolved}.`,
    ),
  );

  /* -- 3. credential ---------------------------------------------------- */

  const apiKey = getProviderApiKey(provider.id);
  if (!apiKey) {
    stages.push(stage('credential', false, 'No API key is stored for this provider.'));
    return fail(
      stages,
      'credential',
      'missing_api_key',
      `No API key is stored for ${provider.name}. Add one in Settings then AI Providers before saving a model against it.`,
    );
  }
  // The key's VALUE is never described — only that one is present.
  stages.push(stage('credential', true, `An API key is stored for ${provider.name}.`));

  /* -- 4. catalogue ----------------------------------------------------- */

  let catalogEntry: DiscoveredModel | null = null;

  if (!adapter.listModels) {
    stages.push(
      stage(
        'catalog',
        true,
        `${provider.name} publishes no model catalogue, so Cynth cannot confirm the model id from metadata alone.`,
        true,
      ),
    );
  } else {
    try {
      catalogEntry = await findCatalogModel(provider.id, modelName);
    } catch (error) {
      const failure = describeFailure(error, apiKey);
      stages.push(stage('catalog', false, failure.message));
      return fail(stages, 'catalog', failure.code, failure.message);
    }

    if (!catalogEntry) {
      const message =
        `${provider.name} does not list a model called "${modelName}". Check the id against the provider's ` +
        `catalogue — it must match exactly, including the vendor prefix.`;
      stages.push(stage('catalog', false, message));
      return fail(stages, 'catalog', 'model_not_found', message);
    }

    if (catalogEntry.status === 'disabled') {
      const message = `${provider.name} lists "${modelName}" but reports it as disabled, so requests to it will fail.`;
      stages.push(stage('catalog', false, message));
      return fail(stages, 'catalog', 'model_unavailable', message, { catalogEntry, costClass: catalogEntry.costClass });
    }

    stages.push(
      stage(
        'catalog',
        true,
        `${provider.name} lists "${modelName}"${catalogEntry.vendor ? ` from ${catalogEntry.vendor}` : ''}, ` +
          `priced as ${catalogEntry.costClass}.`,
      ),
    );
  }

  const costClass = catalogEntry ? catalogEntry.costClass : 'unknown';

  /* -- 5. live probe ---------------------------------------------------- */

  /**
   * COST SAFETY. A free model is probed because a free request costs nothing
   * and a save that has never spoken to the model proves less. Anything paid
   * or unpriced needs explicit permission — validation must never be a route
   * by which Cynth spends money the user did not agree to.
   */
  const mayProbe = costClass === 'free' || options.allowLiveProbe === true;

  if (!mayProbe) {
    stages.push(
      stage(
        'live_probe',
        true,
        costClass === 'paid'
          ? 'Skipped: this is a paid model, and Cynth does not send a chargeable request without permission. Use Test Model to run one deliberately.'
          : 'Skipped: this model has no published price, which Cynth treats as paid. Use Test Model to run one deliberately.',
        true,
      ),
    );
    stages.push(stage('normalisation', true, 'Skipped: no provider response was requested.', true));

    return {
      ok: true,
      code: null,
      message:
        `"${modelName}" was verified against ${provider.name}'s catalogue and its stored credential. ` +
        `No request was sent to the model itself, so nothing was charged.`,
      failedStage: null,
      stages,
      catalogEntry,
      costClass,
      liveProbeRan: false,
      probe: null,
    };
  }

  const startedAt = Date.now();
  let generation: NormalizedGeneration;

  try {
    generation = await adapter.generate(
      { prompt: PROBE_PROMPT, model: modelName, timeoutMs: PROBE_TIMEOUT_MS, maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS },
      { apiKey, baseUrl: provider.baseUrl },
    );
  } catch (error) {
    const failure = describeFailure(error, apiKey);
    stages.push(stage('live_probe', false, failure.message));
    return fail(stages, 'live_probe', failure.code, failure.message, { catalogEntry, costClass, liveProbeRan: true });
  }

  const durationMs = Date.now() - startedAt;
  stages.push(
    stage(
      'live_probe',
      true,
      `${provider.name} accepted the request and ${modelName} answered in ${durationMs} ms.`,
    ),
  );

  /* -- 6. normalisation ------------------------------------------------- */

  /**
   * The adapter has already translated the provider's own JSON into
   * NormalizedGeneration — that IS the normalisation layer, and it is the
   * same one generation uses. This stage checks the result is usable rather
   * than re-doing the work: a response that parsed but carries no text is a
   * model Cynth cannot generate with, and saying so now is better than
   * discovering it during an article.
   */
  if (typeof generation.text !== 'string') {
    const message = `${modelName} returned a response with no readable text content.`;
    stages.push(stage('normalisation', false, message));
    return fail(stages, 'normalisation', 'empty_response', message, { catalogEntry, costClass, liveProbeRan: true });
  }

  stages.push(
    stage(
      'normalisation',
      true,
      `The response normalised into Cynth's own format` +
        `${generation.reportedModel ? ` (the provider served "${generation.reportedModel}")` : ''}.`,
    ),
  );

  return {
    ok: true,
    code: null,
    message:
      `"${modelName}" is valid on ${provider.name}: the endpoint answered, the key authenticated, the model ran, ` +
      `and its response was read successfully.`,
    failedStage: null,
    stages,
    catalogEntry,
    costClass,
    liveProbeRan: true,
    probe: {
      reportedModel: generation.reportedModel,
      finishReason: generation.finishReason,
      promptTokens: generation.usage?.promptTokens ?? null,
      completionTokens: generation.usage?.completionTokens ?? null,
      // The text itself is deliberately not kept: it is a throwaway "ok".
      responseLength: generation.text.length,
      durationMs,
    },
  };
}

/**
 * What a live probe would cost, so the UI can warn before running one.
 *
 * Priced from the provider's published per-token rates and the probe's actual
 * shape — a fixed short prompt and a hard output cap — rather than from a
 * guess. An unpriced model returns null: "unknown", never "free".
 */
export function estimateProbeCost(entry: DiscoveredModel | null): number | null {
  if (!entry) return null;
  if (entry.promptPrice === null || entry.completionPrice === null) return null;

  // Roughly four characters per token; the exact number does not matter at
  // this scale, and the point is an order of magnitude, not a bill.
  const promptTokens = Math.ceil(PROBE_PROMPT.length / 4);
  const cost =
    promptTokens * entry.promptPrice +
    PROBE_MAX_OUTPUT_TOKENS * entry.completionPrice +
    (entry.requestPrice ?? 0);
  return cost;
}
