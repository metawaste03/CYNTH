import { api } from '../../shared/services/apiClient';
import type { ArticleType } from '../../shared/types/articleType';
import type { ArticleDraft, ArticleDraftInput } from '../../shared/types/article';
import type { AssembledPrompt } from '../../shared/types/prompt';
import type { ModelRouteResult } from '../../shared/types/modelRoute';
import type {
  GenerationStatusResponse,
  GenerationResponse,
  GenerationHistoryEntry,
} from '../../shared/types/generation';

export function fetchArticleTypes(): Promise<ArticleType[]> {
  return api.get<{ articleTypes: ArticleType[] }>('/article-types').then((r) => r.articleTypes);
}

export function fetchArticleDraft(id: number): Promise<ArticleDraft> {
  return api.get<{ article: ArticleDraft }>(`/articles/${id}`).then((r) => r.article);
}

export function createArticleDraft(input: ArticleDraftInput): Promise<ArticleDraft> {
  return api.post<{ article: ArticleDraft }>('/articles', input).then((r) => r.article);
}

export function updateArticleDraft(id: number, input: ArticleDraftInput): Promise<ArticleDraft> {
  return api.put<{ article: ArticleDraft }>(`/articles/${id}`, input).then((r) => r.article);
}

export function fetchAssembledPrompt(id: number): Promise<AssembledPrompt> {
  return api.get<AssembledPrompt>(`/articles/${id}/prompt`);
}

/** Model Router lookup only — never an actual AI request. */
export function fetchModelRoute(purpose: string): Promise<ModelRouteResult> {
  return api.get<ModelRouteResult>(`/model-router?purpose=${encodeURIComponent(purpose)}`);
}

/* ------------------------------------------- AI generation (Milestone 9) --- */

/**
 * Reads local configuration and the last saved generation. Sends nothing to
 * any provider.
 *
 * `modelId` previews a model the user is considering: the same provider,
 * pricing and spend decision the generate call would reach, before anything
 * is committed to.
 */
export function fetchGenerationStatus(id: number, modelId?: number | null): Promise<GenerationStatusResponse> {
  const query = modelId ? `?modelId=${modelId}` : '';
  return api.get<GenerationStatusResponse>(`/articles/${id}/generation${query}`);
}

/**
 * Runs one generation.
 *
 * `confirmedCost` is only ever true when the user has explicitly accepted the
 * estimated spend. It is never defaulted, and the server refuses a paid
 * generation without it.
 *
 * `modelId` names a registry entry the user chose — never a provider, an
 * endpoint or a credential. The Model Router still resolves it server-side,
 * and a chosen model that cannot run produces an error rather than a silent
 * substitution. Omit it to use the configured default for the task.
 */
export function generateArticle(
  id: number,
  confirmedCost = false,
  modelId: number | null = null,
): Promise<GenerationResponse> {
  return api.post<GenerationResponse>(`/articles/${id}/generate`, { confirmedCost, modelId });
}

export function fetchGenerationHistory(id: number): Promise<GenerationHistoryEntry[]> {
  return api.get<{ entries: GenerationHistoryEntry[] }>(`/articles/${id}/generation-history`).then((r) => r.entries);
}
