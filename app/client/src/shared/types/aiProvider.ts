export type ModelPurpose =
  | 'article_generation'
  | 'seo_review'
  | 'quality_review'
  | 'title_generation'
  | 'keyword_expansion';

/** How a model is classified for cost. Decided from published pricing, never from the model's name. */
export type ModelCostClass = 'free' | 'paid' | 'unknown';

/** Capability metadata a catalogue may publish. Every field optional — absent means the provider said nothing. */
export interface ModelCapabilities {
  inputModalities?: string[];
  outputModalities?: string[];
  maxCompletionTokens?: number | null;
  tokenizer?: string | null;
  supportedParameters?: string[];
  moderated?: boolean | null;
}

export interface ProviderModel {
  id: number;
  modelName: string;
  displayName: string | null;
  purpose: ModelPurpose | null;
  isEnabled: boolean;
  isDefaultForPurpose: boolean;
  /** Pricing per token as last refreshed from the provider. Null means unknown — treated as paid, never as free. */
  promptPrice: number | null;
  completionPrice: number | null;
  requestPrice: number | null;
  contextLength: number | null;
  isFree: boolean | null;
  pricingSyncedAt: string | null;
  vendor: string | null;
  catalogStatus: string | null;
  capabilities: ModelCapabilities | null;
  /** Whether the provider's catalogue still listed this model at the last refresh. */
  inCatalog: boolean | null;
  costClass: ModelCostClass;
  createdAt: string;
  updatedAt: string;
}

/**
 * One model as the provider's live catalogue describes it (Milestone 13).
 *
 * Nothing in Cynth hardcodes a model. Everything shown in the discovery
 * browser came from the provider moments ago.
 */
export interface CatalogModel {
  id: string;
  displayName: string | null;
  vendor: string | null;
  description: string | null;
  promptPrice: number | null;
  completionPrice: number | null;
  requestPrice: number | null;
  contextLength: number | null;
  status: string | null;
  capabilities: ModelCapabilities;
  publishedAt: string | null;
  costClass: ModelCostClass;
  /** True when this model is already saved in Cynth's registry under this provider. */
  isRegistered: boolean;
}

export type CatalogFilter = 'all' | 'free' | 'paid' | 'unknown';

export interface CatalogResult {
  providerId: number;
  providerName: string;
  providerType: string;
  models: CatalogModel[];
  total: number;
  matched: number;
  counts: { free: number; paid: number; unknown: number };
  fetchedAt: string;
  fromCache: boolean;
  cacheExpiresAt: string;
}

/** A model that can serve a generation task, with everything the choice depends on. */
export interface SelectableModel {
  modelId: number;
  modelName: string;
  displayName: string | null;
  vendor: string | null;
  providerId: number;
  providerName: string;
  providerType: string;
  promptPrice: number | null;
  completionPrice: number | null;
  requestPrice: number | null;
  contextLength: number | null;
  costClass: ModelCostClass;
  purpose: string | null;
  isDefaultForPurpose: boolean;
  /** False when no credential is stored for the provider — the model is listed but cannot run. */
  hasApiKey: boolean;
  pricingSyncedAt: string | null;
}

export interface Provider {
  id: number;
  name: string;
  providerType: string;
  description: string | null;
  baseUrl: string | null;
  defaultModel: string | null;
  apiKeyEnvVar: string | null;
  hasApiKey: boolean;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  modelCount: number;
}

export interface ProviderDetail extends Provider {
  models: ProviderModel[];
}

export interface ProviderInput {
  name: string;
  providerType: string;
  description?: string;
  baseUrl?: string;
  defaultModel?: string;
  /** Omit to leave the stored key untouched; '' clears it; any other value sets/rotates it. */
  apiKey?: string;
}

export interface ModelInput {
  modelName: string;
  displayName?: string;
  purpose?: ModelPurpose | '';
  isEnabled: boolean;
}
