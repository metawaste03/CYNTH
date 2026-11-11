import type {
  GeneratedImage,
  GenerationRequest,
  ImageGenerationRequest,
  ModelCapabilities,
  NormalizedGeneration,
  NormalizedImageGeneration,
  ProviderAdapter,
  ProviderCallContext,
  ProviderModelInfo,
} from '../generation.types.js';
import { GenerationError } from '../generation.errors.js';
import { callChatCompletions } from './openAiCompatible.js';
import { getJson, postJson, resolveBaseUrl, throwForFailedResponse } from './providerHttp.js';
import { CATALOG_TIMEOUT_MS } from '../generation.constants.js';

/**
 * OpenRouter, which exposes the same Chat Completions shape as OpenAI at a
 * different host. X-Title is OpenRouter's optional app-identification header;
 * it carries nothing but the product name — no key, no user data, no URL.
 */
export const openrouterAdapter: ProviderAdapter = {
  providerType: 'openrouter',

  generate(request: GenerationRequest, context: ProviderCallContext): Promise<NormalizedGeneration> {
    return callChatCompletions('openrouter', { 'x-title': 'Cynth' }, request, context);
  },

  generateImages(request: ImageGenerationRequest, context: ProviderCallContext): Promise<NormalizedImageGeneration> {
    return generateImagesViaOpenRouter(request, context);
  },
};

/* ---------------------------------------------------------------- images --- */

/**
 * OpenRouter's image endpoint.
 *
 * A different endpoint from chat completions, with a different billing model:
 * images are priced per image, and the response reports what the call
 * actually cost. Cynth records that reported figure rather than deriving one
 * from tokens, because a per-image charge cannot be recovered from a token
 * count. OpenRouter bills a generation in full or not at all — a failure is
 * not charged — so there is no partial cost to account for.
 *
 * The bytes are decoded here and returned as a Buffer. The data URI the API
 * sends never reaches the rest of Cynth, and a generated image is never
 * referenced by a remote URL: either the file is on our disk or it does not
 * exist.
 */
async function generateImagesViaOpenRouter(
  request: ImageGenerationRequest,
  context: ProviderCallContext,
): Promise<NormalizedImageGeneration> {
  const base = resolveBaseUrl(context.baseUrl, 'openrouter');

  const response = await postJson(
    `${base}/images`,
    { authorization: `Bearer ${context.apiKey}`, 'x-title': 'Cynth' },
    {
      model: request.model,
      prompt: request.prompt,
      n: request.count,
      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      output_format: 'png',
    },
    request.timeoutMs,
  );

  if (!response.ok) throwForFailedResponse(response, context.apiKey);

  const data = Array.isArray(response.json?.data) ? (response.json!.data as unknown[]) : [];
  const images: GeneratedImage[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.b64_json !== 'string' || !record.b64_json) continue;

    const decoded = Buffer.from(record.b64_json, 'base64');
    if (decoded.length === 0) continue;

    images.push({
      data: decoded,
      mimeType: typeof record.media_type === 'string' ? record.media_type : 'image/png',
    });
  }

  if (images.length === 0) {
    throw new GenerationError('empty_response', 'The provider returned no image data.');
  }

  const usage = response.json?.usage as Record<string, unknown> | undefined;
  const cost = typeof usage?.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : null;

  return {
    images,
    reportedCost: cost,
    reportedModel: typeof response.json?.model === 'string' ? response.json.model : null,
  };
}

/* ------------------------------------------------------------- catalogue --- */

/**
 * OpenRouter publishes a public model catalogue with per-token pricing and
 * capability metadata.
 *
 * Nothing below names a model. Cynth reads whatever the catalogue currently
 * lists, which is the entire point: OpenRouter's roster changes constantly,
 * and a hardcoded list would be wrong within weeks.
 *
 * Prices arrive as decimal strings; anything unparseable stays null rather
 * than becoming a guess. A missing price is "unknown", never "free".
 */
function priceOf(pricing: unknown, key: string): number | null {
  if (!pricing || typeof pricing !== 'object') return null;
  const raw = (pricing as Record<string, unknown>)[key];
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;

  if (!Number.isFinite(value)) return null;

  // OpenRouter publishes -1 for models whose price it cannot state up front —
  // `openrouter/auto`, for instance, whose real cost depends on which model it
  // routes to. A negative number is a sentinel, not a price: treating it as
  // one would let the cost estimator report a NEGATIVE charge, and would
  // present a genuinely unpredictable model as though its cost were known.
  // Null is the honest answer, and Cynth treats unknown as paid.
  if (value < 0) return null;

  return value;
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArrayOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => typeof entry === 'string');
  return items.length ? items : undefined;
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The upstream house behind a model.
 *
 * OpenRouter ids are conventionally `vendor/model`, so the vendor is read off
 * the id rather than assumed from a lookup table that would need maintaining.
 * An id with no slash simply has no vendor — Cynth says so instead of
 * inventing one.
 */
function vendorOf(id: string, entry: Record<string, unknown>): string | null {
  const explicit = stringOf((entry.top_provider as Record<string, unknown> | undefined)?.name);
  if (explicit) return explicit;

  const slash = id.indexOf('/');
  return slash > 0 ? id.slice(0, slash) : null;
}

function capabilitiesOf(entry: Record<string, unknown>): ModelCapabilities {
  const architecture = (entry.architecture ?? {}) as Record<string, unknown>;
  const topProvider = (entry.top_provider ?? {}) as Record<string, unknown>;

  const capabilities: ModelCapabilities = {};

  const input = stringArrayOf(architecture.input_modalities);
  if (input) capabilities.inputModalities = input;

  const output = stringArrayOf(architecture.output_modalities);
  if (output) capabilities.outputModalities = output;

  const tokenizer = stringOf(architecture.tokenizer);
  if (tokenizer) capabilities.tokenizer = tokenizer;

  const maxCompletion = numberOf(topProvider.max_completion_tokens);
  if (maxCompletion !== null) capabilities.maxCompletionTokens = maxCompletion;

  if (typeof topProvider.is_moderated === 'boolean') capabilities.moderated = topProvider.is_moderated;

  const parameters = stringArrayOf(entry.supported_parameters);
  if (parameters) capabilities.supportedParameters = parameters;

  return capabilities;
}

/**
 * Availability, as OpenRouter reports it.
 *
 * The catalogue has no single status field, so the two facts it does publish
 * are reported plainly: a model the top provider has disabled, and one whose
 * per-request limits mark it as restricted. Anything else is left null rather
 * than reported as "available" on no evidence.
 */
function statusOf(entry: Record<string, unknown>): string | null {
  const topProvider = (entry.top_provider ?? {}) as Record<string, unknown>;
  if (topProvider.is_disabled === true) return 'disabled';

  const perRequestLimits = entry.per_request_limits;
  if (perRequestLimits && typeof perRequestLimits === 'object' && Object.keys(perRequestLimits).length > 0) {
    return 'limited';
  }

  return null;
}

/** Seconds-since-epoch, as OpenRouter publishes creation dates. */
function publishedAtOf(entry: Record<string, unknown>): string | null {
  const created = numberOf(entry.created);
  if (created === null || created <= 0) return null;
  const date = new Date(created * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseOpenRouterCatalog(body: Record<string, unknown> | null): ProviderModelInfo[] {
  const data = Array.isArray(body?.data) ? (body!.data as Record<string, unknown>[]) : [];

  return data
    .filter((entry) => typeof entry.id === 'string' && entry.id.trim())
    .map((entry) => {
      const id = (entry.id as string).trim();
      return {
        id,
        displayName: stringOf(entry.name),
        vendor: vendorOf(id, entry),
        description: stringOf(entry.description),
        promptPrice: priceOf(entry.pricing, 'prompt'),
        completionPrice: priceOf(entry.pricing, 'completion'),
        requestPrice: priceOf(entry.pricing, 'request'),
        imageOutputPrice: priceOf(entry.pricing, 'image_output'),
        contextLength: numberOf(entry.context_length),
        status: statusOf(entry),
        capabilities: capabilitiesOf(entry),
        publishedAt: publishedAtOf(entry),
      };
    });
}

/**
 * The catalogue, in TWO reads.
 *
 * `/models` on its own is not the whole roster. It answers with 431 models
 * and only eleven of them produce images — the multimodal chat models.
 * `/models?output_modalities=image` answers with 52, of which 41 appear
 * NOWHERE in the first list: Seedream, Recraft, MAI-Image, Muse, Grok
 * Imagine. A single read therefore hides most of the image models from the
 * registry entirely, which is not something a user can diagnose from the UI —
 * the model simply is not there.
 *
 * So both are read and merged by id, the plain catalogue winning on conflict
 * because it is the one the provider serves by default. The second read is a
 * metadata GET like the first: it costs nothing and generates nothing.
 *
 * If the image read fails, the plain catalogue is still returned. A provider
 * that has no such filter, or a transient failure on the second call, must
 * degrade to fewer models rather than to no catalogue at all.
 */
openrouterAdapter.listModels = async (context) => {
  const base = resolveBaseUrl(context.baseUrl, 'openrouter');
  // The catalogue is public, but an authenticated read can return
  // account-specific availability, so send the key when there is one.
  const headers: Record<string, string> = context.apiKey ? { authorization: `Bearer ${context.apiKey}` } : {};

  const response = await getJson(`${base}/models`, headers, CATALOG_TIMEOUT_MS);
  const models = parseOpenRouterCatalog(response.json);

  let imageModels: ProviderModelInfo[] = [];
  try {
    const imageResponse = await getJson(
      `${base}/models?output_modalities=image`,
      headers,
      CATALOG_TIMEOUT_MS,
    );
    imageModels = parseOpenRouterCatalog(imageResponse.json);
  } catch {
    // Fewer models, not none.
  }

  const byId = new Map(models.map((model) => [model.id, model]));
  for (const model of imageModels) {
    if (!byId.has(model.id)) byId.set(model.id, model);
  }
  return [...byId.values()];
};
