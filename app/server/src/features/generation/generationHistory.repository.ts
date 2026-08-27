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
}

export interface RecordGenerationInput {
  articleId: number;
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
  createdAt: string;
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
