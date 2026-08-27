import type { GenerationRequest, ModelCapabilities, NormalizedGeneration, ProviderAdapter, ProviderCallContext, ProviderModelInfo } from '../generation.types.js';
import { callChatCompletions } from './openAiCompatible.js';
import { getJson, resolveBaseUrl } from './providerHttp.js';
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
};

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
        contextLength: numberOf(entry.context_length),
        status: statusOf(entry),
        capabilities: capabilitiesOf(entry),
        publishedAt: publishedAtOf(entry),
      };
    });
}

openrouterAdapter.listModels = async (context) => {
  const url = `${resolveBaseUrl(context.baseUrl, 'openrouter')}/models`;
  // The catalogue is public, but an authenticated read can return
  // account-specific availability, so send the key when there is one.
  const headers: Record<string, string> = context.apiKey ? { authorization: `Bearer ${context.apiKey}` } : {};
  const response = await getJson(url, headers, CATALOG_TIMEOUT_MS);
  return parseOpenRouterCatalog(response.json);
};
