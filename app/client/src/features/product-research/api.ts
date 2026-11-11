import { api } from '../../shared/services/apiClient';
import type {
  ArticleProduct,
  ProductResearchPreflight,
  ProductUnderstanding,
  RetrievalPreflight,
  RetrieveProductResult,
  PlacementReviewOutcome,
  PlacementReviewPreflight,
} from '../../shared/types/articleProduct';
import type { ProductDetail } from '../../shared/types/product';

/** Whether Cynth may read this URL. Free, and makes no request to the page itself. */
export function checkProductUrl(url: string): Promise<RetrievalPreflight> {
  return api.post<{ preflight: RetrievalPreflight }>('/product-research/check', { url }).then((r) => r.preflight);
}

/**
 * Reads a product page and creates or updates a product from what it
 * publishes. `affiliateUrl` is the user's link and is stored verbatim.
 */
export function retrieveProduct(input: {
  url: string;
  affiliateUrl?: string | null;
  productId?: number | null;
  editorialNote?: string | null;
}): Promise<RetrieveProductResult> {
  return api.post<RetrieveProductResult>('/product-research/retrieve', input);
}

export function fetchResearchPreflight(productId: number, modelId?: number | null): Promise<ProductResearchPreflight> {
  const query = modelId ? `?modelId=${modelId}` : '';
  return api
    .get<{ preflight: ProductResearchPreflight }>(`/product-research/${productId}/research/preflight${query}`)
    .then((r) => r.preflight);
}

/** Works out what a product is for. The only call here that can cost money. */
export function researchProduct(
  productId: number,
  options: { confirmedCost?: boolean; modelId?: number | null } = {},
): Promise<{ understanding: ProductUnderstanding; product: ProductDetail }> {
  return api.post<{ understanding: ProductUnderstanding; product: ProductDetail }>(
    `/product-research/${productId}/research`,
    options,
  );
}

/* ----------------------------------------------------- article products --- */

export function fetchArticleProducts(articleId: number): Promise<ArticleProduct[]> {
  return api
    .get<{ products: ArticleProduct[] }>(`/product-research/articles/${articleId}/products`)
    .then((r) => r.products);
}

export function attachArticleProduct(
  articleId: number,
  productId: number,
  editorialNote?: string | null,
): Promise<ArticleProduct> {
  return api
    .post<{ attached: ArticleProduct; product: ProductDetail }>(`/product-research/articles/${articleId}/products`, {
      productId,
      editorialNote,
    })
    .then((r) => ({ ...r.attached, product: r.product }));
}

export function detachArticleProduct(articleId: number, productId: number): Promise<void> {
  return api.delete(`/product-research/articles/${articleId}/products/${productId}`);
}

/* ------------------------------------------------------ placement review --- */

export function fetchPlacementReviewPreflight(articleId: number): Promise<PlacementReviewPreflight> {
  return api
    .get<{ preflight: PlacementReviewPreflight }>(
      `/product-research/articles/${articleId}/placement-review/preflight`,
    )
    .then((r) => r.preflight);
}

/** Reviews where each product landed. Advice only — it never moves a product. */
export function reviewPlacements(
  articleId: number,
  options: { confirmedCost?: boolean } = {},
): Promise<PlacementReviewOutcome> {
  return api.post<PlacementReviewOutcome>(`/product-research/articles/${articleId}/placement-review`, options);
}
