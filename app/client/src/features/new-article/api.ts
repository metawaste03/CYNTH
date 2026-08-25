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

/** Reads local configuration and the last saved generation. Sends nothing to any provider. */
export function fetchGenerationStatus(id: number): Promise<GenerationStatusResponse> {
  return api.get<GenerationStatusResponse>(`/articles/${id}/generation`);
}

/**
 * Runs one generation. The provider and model are chosen server-side by the
 * Model Router — deliberately not selectable here.
 */
export function generateArticle(id: number): Promise<GenerationResponse> {
  return api.post<GenerationResponse>(`/articles/${id}/generate`, {});
}

export function fetchGenerationHistory(id: number): Promise<GenerationHistoryEntry[]> {
  return api.get<{ entries: GenerationHistoryEntry[] }>(`/articles/${id}/generation-history`).then((r) => r.entries);
}
