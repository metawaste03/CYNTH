export type ModelPurpose =
  | 'article_generation'
  | 'seo_review'
  | 'research'
  | 'quality_review'
  | 'title_generation'
  | 'keyword_expansion'
  | 'image_generation';

/**
 * One capability a registered model holds (Milestone 15).
 *
 * A model holds a SET of these. The best article writer is not automatically
 * the best SEO reviewer, but one model may legitimately be both.
 */
export interface ModelCapability {
  purpose: ModelPurpose;
  isDefaultForPurpose: boolean;
}

/** A capability with the wording the server owns, plus whether anything routes to it yet. */
export interface CapabilityMeta {
  value: ModelPurpose;
  label: string;
  description: string;
  /** False for capabilities that can be assigned but that no workflow uses yet. */
  implemented: boolean;
}

/** Whether a model's configuration was ever verified against the provider, and what happened last. */
export interface ModelValidation {
  status: 'unvalidated' | 'valid' | 'invalid';
  code: string | null;
  message: string | null;
  validatedAt: string | null;
  lastTest: {
    status: 'passed' | 'failed';
    /** 'catalog' = metadata only and free; 'live' = a real minimal request was sent. */
    mode: 'catalog' | 'live' | null;
    message: string | null;
    testedAt: string | null;
  } | null;
}

/** The ordered stages the validation pipeline runs, so a failure has a place. */
export type ValidationStage =
  | 'configuration'
  | 'endpoint'
  | 'credential'
  | 'catalog'
  | 'live_probe'
  | 'normalisation';

export interface ValidationStageResult {
  stage: ValidationStage;
  ok: boolean;
  /** True when the stage was skipped rather than run — a skipped stage proves nothing. */
  skipped?: boolean;
  detail: string;
}

export interface ModelValidationResult {
  ok: boolean;
  code: string | null;
  message: string;
  failedStage: ValidationStage | null;
  stages: ValidationStageResult[];
  costClass: ModelCostClass;
  /** True when a real request was sent. False means nothing chargeable happened. */
  liveProbeRan: boolean;
  probe: {
    reportedModel: string | null;
    finishReason: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    responseLength: number;
    durationMs: number;
  } | null;
  /** What one live probe would cost, from published prices. Null when the provider publishes none. */
  estimatedProbeCost?: number | null;
}

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
  /** The jobs this model is registered for. May hold several. */
  assignedCapabilities: ModelCapability[];
  /** @deprecated Milestone 15 — read `assignedCapabilities`. */
  purpose: ModelPurpose | null;
  isEnabled: boolean;
  /** @deprecated Milestone 15 — the default flag is per capability. True when default for any of them. */
  isDefaultForPurpose: boolean;
  validation: ModelValidation;
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
  /**
   * What image output costs, where the catalogue publishes it.
   *
   * Shown because it is often the ONLY price an image model has: several
   * publish zero for input and output and charge here instead, and a card
   * reading "Paid" beside "Input Free / Output Free" is otherwise inexplicable.
   */
  imageOutputPrice: number | null;
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
  /** Every job this model is registered for. */
  assignedCapabilities: ModelCapability[];
  /** @deprecated Milestone 15 — read `assignedCapabilities`. */
  purpose: string | null;
  /** True when this model is the default for the purpose that was asked for. */
  isDefaultForPurpose: boolean;
  /** False when no credential is stored for the provider — the model is listed but cannot run. */
  hasApiKey: boolean;
  validation: ModelValidation;
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
  /** The jobs this model is registered for. Empty is allowed: registered, not yet assigned. */
  purposes: ModelPurpose[];
  isEnabled: boolean;
}
