import { getDatabase } from '../../shared/database/index.js';
import type { GenerationHistoryRow } from '../../shared/database/types.js';

/**
 * One row per generation attempt, success or failure, in the
 * generation_history table created back in Milestone 2.
 *
 * What is deliberately NOT recorded: API keys, authorization headers,
 * environment variable values, and raw provider response bodies. The
 * `payload` column holds a small, fixed JSON summary and nothing else.
 * Token counts are written only when the provider actually reported them.
 */

export interface GenerationHistoryMetadata {
  promptCharacterCount?: number;
  promptWordCount?: number;
  finishReason?: string | null;
  /** The model id the provider says it served, which can differ from the configured one. */
  reportedModel?: string | null;
  generatedCharacterCount?: number;
  titleDetected?: boolean;
  /** Reproducibility: the prompt structure, mode and cost class this attempt ran under. */
  promptVersion?: string;
  generationMode?: string;
  costClass?: string;
  /** Whether the model came from an explicit user choice or the configured purpose default. */
  modelSelection?: 'explicit' | 'default';
  /** Product research (Milestone 17): which product an attempt was about, when it was not about an article. */
  productId?: number;
  productTitle?: string;
  /** The editorial pipeline this attempt belonged to (Milestone 20). */
  pipelineId?: number;
  stage?: string;
  /** True when a technical fallback model answered instead of the requested one. */
  wasFallback?: boolean;
  /**
   * Featured image generation (Milestone 25).
   *
   * Images are billed per image, not per token, so the charge cannot live in
   * the token columns. It is recorded here as the figure the PROVIDER
   * reported, with `costBasis` saying so — an unreported cost is 'unreported'
   * and stays null, never rounded down to zero.
   */
  images?: number;
  reportedCostUsd?: number | null;
  costBasis?: 'provider_reported' | 'unreported';
}

export interface RecordGenerationInput {
  /**
   * Null for work that is not about one article.
   *
   * Product research is the first such task: researching a product happens
   * before, and independently of, any article that might use it. The column
   * has always been nullable; until Milestone 17 nothing wrote null to it.
   */
  articleId: number | null;
  taskType: string;
  providerName: string | null;
  providerType: string | null;
  model: string | null;
  status: 'success' | 'failure';
  errorCode?: string | null;
  errorMessage?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  metadata?: GenerationHistoryMetadata;
}

export interface GenerationHistoryEntryDto {
  id: number;
  articleId: number | null;
  taskType: string | null;
  provider: string | null;
  providerType: string | null;
  model: string | null;
  status: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  /**
   * The small fixed metadata summary recorded with the attempt. Exposed
   * (Milestone 15) so the Quality Gate can read the provider's own
   * `finishReason` — "it stopped because it hit the output limit" is the
   * difference between a short article and a truncated one, and only the
   * provider knows which happened.
   *
   * Contains no credential and no provider payload; see recordGeneration().
   */
  metadata: GenerationHistoryMetadata | null;
  createdAt: string;
}

/** A stored metadata blob back into an object. A malformed blob must not break reading the history it belongs to. */
function parseMetadata(raw: string | null): GenerationHistoryMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as GenerationHistoryMetadata) : null;
  } catch {
    return null;
  }
}

function mapEntry(row: GenerationHistoryRow): GenerationHistoryEntryDto {
  return {
    id: row.id,
    articleId: row.article_id,
    taskType: row.action,
    provider: row.provider,
    providerType: row.provider_type,
    model: row.model,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    durationMs: row.duration_ms,
    metadata: parseMetadata(row.payload),
    createdAt: row.created_at,
  };
}

export function recordGeneration(input: RecordGenerationInput): number {
  const db = getDatabase();
  const result = db
    .prepare(`
      INSERT INTO generation_history (
        article_id, provider, action, payload, provider_type, model, status,
        error_code, error_message, prompt_tokens, completion_tokens, total_tokens, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.articleId,
      input.providerName,
      input.taskType,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.providerType,
      input.model,
      input.status,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.totalTokens ?? null,
      input.durationMs ?? null,
    );

  return Number(result.lastInsertRowid);
}

export function listGenerationHistoryForArticle(articleId: number, limit = 20): GenerationHistoryEntryDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM generation_history WHERE article_id = ? ORDER BY id DESC LIMIT ?')
    .all(articleId, limit) as unknown as GenerationHistoryRow[];
  return rows.map(mapEntry);
}
