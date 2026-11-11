import { getDatabase } from '../../shared/database/index.js';
import { getSetting } from '../../shared/settings/settings.repository.js';
import { getProviderApiKey } from '../ai-providers/aiProviders.repository.js';
import { GenerationError } from '../generation/generation.errors.js';
import { postJson, resolveBaseUrl, throwForFailedResponse } from '../generation/providers/providerHttp.js';

/**
 * TURNING TEXT INTO SOMETHING THAT CAN BE COMPARED BY MEANING.
 *
 * The coverage graph must catch the same idea in different words — "do not
 * propose a topic that is substantially the same article, however differently
 * worded" was already the instruction, and only a model could follow it.
 * Embeddings make that a measurement instead of a request: each point becomes
 * a vector, and two points that say the same thing sit close together.
 *
 * OPENROUTER, BECAUSE THE KEY IS ALREADY THERE. No new provider type and no
 * new secret. The provider is the one named in settings, or else the first
 * active OpenRouter provider that has a key.
 *
 * THE MODEL IS PART OF EVERY STORED VECTOR. Vectors from two different
 * embedding models cannot be compared, so each stored vector records which
 * model made it, and a change of model means a rebuild rather than a quiet
 * mixture.
 *
 * Cost is real but small: openai/text-embedding-3-small is $0.02 per million
 * input tokens, so indexing a 10,000-character article costs well under a
 * hundredth of a cent. It is still recorded, because Cynth reports spend.
 */

export const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const EMBEDDING_MODEL_SETTING = 'coverage.embedding_model';
export const EMBEDDING_PROVIDER_SETTING = 'coverage.embedding_provider_id';

const EMBEDDING_TIMEOUT_MS = 60_000;
/** Inputs per request. Comfortably inside every provider's batch limit. */
const BATCH_SIZE = 64;

export interface EmbeddingTarget {
  providerId: number;
  providerName: string;
  baseUrl: string;
  model: string;
  /** Server-side only. Never returned by a route, never logged, never persisted. */
  apiKey: string;
}

export interface EmbeddingResult {
  vectors: Float32Array[];
  model: string;
  promptTokens: number;
  /** As OpenRouter reports it, or null when it does not. */
  reportedCost: number | null;
}

/** Which provider and model embeddings go to. Throws a readable error when none is usable. */
export function resolveEmbeddingTarget(): EmbeddingTarget {
  const db = getDatabase();
  const configuredId = Number(getSetting(EMBEDDING_PROVIDER_SETTING));

  const candidates = db
    .prepare(
      `SELECT id, name, base_url FROM ai_providers
       WHERE provider_type = 'openrouter' AND is_active = 1
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id`,
    )
    .all(Number.isFinite(configuredId) ? configuredId : -1) as { id: number; name: string; base_url: string | null }[];

  for (const provider of candidates) {
    const apiKey = getProviderApiKey(provider.id);
    if (!apiKey) continue;
    return {
      providerId: provider.id,
      providerName: provider.name,
      baseUrl: resolveBaseUrl(provider.base_url, 'openrouter'),
      model: getSetting(EMBEDDING_MODEL_SETTING)?.trim() || DEFAULT_EMBEDDING_MODEL,
      apiKey,
    };
  }

  throw new GenerationError(
    'provider_not_configured',
    'The coverage graph needs an active OpenRouter provider with an API key to compare articles. Add one in Settings then AI Providers.',
  );
}

/** Embeds texts in order. One vector per input, normalised to unit length so a dot product is the cosine. */
export async function embedTexts(texts: string[], target: EmbeddingTarget = resolveEmbeddingTarget()): Promise<EmbeddingResult> {
  const vectors: Float32Array[] = [];
  let promptTokens = 0;
  let reportedCost: number | null = null;

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const response = await postJson(
      `${target.baseUrl}/embeddings`,
      { authorization: `Bearer ${target.apiKey}`, 'x-title': 'Cynth' },
      { model: target.model, input: batch },
      EMBEDDING_TIMEOUT_MS,
    );

    if (!response.ok) throwForFailedResponse(response, target.apiKey);

    const data = Array.isArray(response.json?.data) ? (response.json!.data as unknown[]) : [];
    const ordered = new Array<Float32Array | null>(batch.length).fill(null);

    for (const entry of data) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const index = typeof record.index === 'number' ? record.index : -1;
      if (index < 0 || index >= batch.length || !Array.isArray(record.embedding)) continue;
      ordered[index] = normalise(Float32Array.from(record.embedding as number[]));
    }

    if (ordered.some((vector) => vector === null)) {
      throw new GenerationError(
        'empty_response',
        `The embedding model returned ${data.length} vectors for ${batch.length} inputs. Nothing was stored.`,
      );
    }

    vectors.push(...(ordered as Float32Array[]));

    const usage = response.json?.usage as Record<string, unknown> | undefined;
    if (typeof usage?.prompt_tokens === 'number') promptTokens += usage.prompt_tokens;
    if (typeof usage?.cost === 'number' && Number.isFinite(usage.cost)) reportedCost = (reportedCost ?? 0) + usage.cost;
  }

  return { vectors, model: target.model, promptTokens, reportedCost };
}

/* -------------------------------------------------------------- vectors --- */

export function normalise(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (length === 0) return vector;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / length;
  return out;
}

/** Cosine similarity of two unit vectors. */
export function similarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Vectors are stored as raw float32 bytes: compact, and exact on the way back. */
export function vectorToBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

export function blobToVector(blob: Uint8Array): Float32Array {
  const copy = new Uint8Array(blob);
  return new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}
