import type { ProductDetail } from './product';

/** Where a product ended up. 'omitted' is a real outcome — the author judged it did not belong. */
export type ArticleProductStatus = 'provided' | 'placed' | 'omitted';

/** What the review concluded. 'good' is a first-class outcome, not the absence of a problem. */
export type PlacementVerdict = 'good' | 'acceptable' | 'weak' | 'misplaced';

export interface ArticleProduct {
  id: number;
  articleId: number;
  productId: number;
  position: number;
  editorialNote: string | null;
  status: ArticleProductStatus;
  placementSection: string | null;
  placementRationale: string | null;
  placedAt: string | null;
  /* --- The placement review (Milestone 18). An opinion, never a change. --- */
  reviewVerdict: PlacementVerdict | null;
  reviewAssessment: string | null;
  reviewSuggestedSection: string | null;
  reviewConfidence: number | null;
  reviewModel: string | null;
  reviewedAt: string | null;
  createdAt: string;
  /** Resolved by the API for display. */
  product: ProductDetail | null;
}

/** Whether Cynth may read a URL, answered before anything is fetched from the page. */
export interface RetrievalPreflight {
  url: string;
  host: string;
  canRetrieve: boolean;
  sourceConfigured: boolean;
  sourceId: number | null;
  sourceName: string | null;
  permitted: boolean;
  reason: string;
  /** What the user can do about a refusal. Always present when `permitted` is false. */
  remedy: string | null;
  /** Which subsystem handles this URL: the generic web retriever, or Amazon's official API. */
  source: 'web' | 'amazon_creators_api';
}

/** The structured metadata a page published about itself. Never page copy. */
export interface ExtractedProduct {
  title: string | null;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  features: string[];
  price: string | null;
  currency: string | null;
  availability: string | null;
  sku: string | null;
  category: string | null;
  foundVia: string[];
}

export interface RetrieveProductResult {
  product: ProductDetail;
  extracted: ExtractedProduct;
  retrievalId: number;
  researchId: number;
  created: boolean;
  warnings: string[];
}

export interface ProductResearchPreflight {
  taskType: string;
  provider: { name: string; providerType: string; hasApiKey: boolean } | null;
  model: { id: number; modelName: string; displayName: string | null } | null;
  mode: string;
  costClass: string;
  cost: { totalUsd: number | null } | null;
  spend: { allowed: boolean; requiresConfirmation: boolean; reason: string | null } | null;
  promptCharacterCount: number | null;
  ready: boolean;
  issues: string[];
  configurationErrorCode: string | null;
}

export interface ProductUnderstanding {
  useCase: string;
  problemSolved: string;
  bestFor: string;
  keyFeatures: string[];
  summary: string;
}

export interface PlacementReviewItem {
  productId: number;
  productTitle: string;
  verdict: PlacementVerdict;
  assessment: string;
  suggestedSection: string | null;
  confidence: number;
}

export interface PlacementReviewPreflight {
  articleId: number;
  placedProductCount: number;
  model: { id: number; modelName: string; displayName: string | null } | null;
  mode: string;
  costClass: string;
  ready: boolean;
  issues: string[];
}

export interface PlacementReviewOutcome {
  articleId: number;
  items: PlacementReviewItem[];
}
