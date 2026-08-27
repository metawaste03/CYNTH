import { api } from '../../shared/services/apiClient';
import type { ArticleDraft, ArticleListResponse, ArticleSummary } from '../../shared/types/article';

/**
 * The Article entity's API surface.
 *
 * Everything here reads or writes the `articles` table — the persistent
 * content record. Generation history lives behind its own endpoint and is
 * never used to build article lists.
 */

/** Real Article records, most recently updated first. `status` filters the lifecycle state. */
export function fetchArticles(options: { status?: string; limit?: number } = {}): Promise<ArticleSummary[]> {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.limit) params.set('limit', String(options.limit));

  const query = params.toString();
  return api.get<ArticleListResponse>(`/articles${query ? `?${query}` : ''}`).then((r) => r.articles);
}

/** One stored Article, including its generated body when it has one. */
export function fetchArticle(id: number): Promise<ArticleDraft> {
  return api.get<{ article: ArticleDraft }>(`/articles/${id}`).then((r) => r.article);
}

/** Moves an article along its lifecycle. Only ever called from a deliberate user action. */
export function setArticleStatus(id: number, status: string): Promise<ArticleDraft> {
  return api.patch<{ article: ArticleDraft }>(`/articles/${id}/status`, { status }).then((r) => r.article);
}
