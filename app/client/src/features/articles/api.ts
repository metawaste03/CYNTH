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

/**
 * A product this article places, resolved the way the published card resolves
 * it — the uploaded primary image wins over the retailer's.
 */
export interface ArticleProductCard {
  productId: number;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  affiliateUrl: string | null;
  description: string | null;
  useCase: string | null;
  keyFeatures: string[];
}

/** The products behind this article's `[[product:id]]` markers, for the preview. */
export function fetchArticleProducts(id: number): Promise<ArticleProductCard[]> {
  return api.get<{ products: ArticleProductCard[] }>(`/articles/${id}/products`).then((r) => r.products);
}

/** Moves an article along its lifecycle. Only ever called from a deliberate user action. */
export function setArticleStatus(id: number, status: string): Promise<ArticleDraft> {
  return api.patch<{ article: ArticleDraft }>(`/articles/${id}/status`, { status }).then((r) => r.article);
}

export interface DeletionPreflight {
  articleId: number;
  title: string | null;
  status: string;
  /** Reasons deletion is refused without an explicit override. */
  blockers: string[];
  warnings: string[];
  /** What deleting actually removes. */
  removes: string[];
  /** What survives it. */
  keeps: string[];
  canDelete: boolean;
}

/** What deleting this draft would do. Free, and destroys nothing. */
export function fetchDeletionPreflight(id: number): Promise<DeletionPreflight> {
  return api.get<{ preflight: DeletionPreflight }>(`/articles/${id}/deletion-preflight`).then((r) => r.preflight);
}

/** `force` overrides the CMS-link blocker and nothing else. Never sent by default. */
export function deleteArticle(id: number, force = false): Promise<void> {
  return api.delete(`/articles/${id}${force ? '?force=true' : ''}`);
}
