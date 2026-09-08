import { api } from '../../shared/services/apiClient';
import type {
  CapabilityMeta,
  CatalogFilter,
  CatalogModel,
  CatalogResult,
  ModelPurpose,
  ModelInput,
  ModelValidationResult,
  Provider,
  ProviderDetail,
  ProviderInput,
  ProviderModel,
  SelectableModel,
} from '../../shared/types/aiProvider';

export interface ProviderMeta {
  providerTypes: readonly string[];
  purposes: readonly ModelPurpose[];
  /** Capabilities with the server's own labels and whether any workflow routes to them yet. */
  capabilities: CapabilityMeta[];
}

export function fetchProviderMeta(): Promise<ProviderMeta> {
  return api.get<ProviderMeta>('/ai-providers/meta');
}

export function fetchProviders(): Promise<Provider[]> {
  return api.get<{ providers: Provider[] }>('/ai-providers').then((r) => r.providers);
}

export function fetchProvider(id: number): Promise<ProviderDetail> {
  return api.get<{ provider: ProviderDetail }>(`/ai-providers/${id}`).then((r) => r.provider);
}

export function createProvider(input: ProviderInput): Promise<ProviderDetail> {
  return api.post<{ provider: ProviderDetail }>('/ai-providers', input).then((r) => r.provider);
}

export function updateProvider(id: number, input: ProviderInput): Promise<ProviderDetail> {
  return api.put<{ provider: ProviderDetail }>(`/ai-providers/${id}`, input).then((r) => r.provider);
}

export function setProviderStatus(id: number, isActive: boolean): Promise<ProviderDetail> {
  return api.patch<{ provider: ProviderDetail }>(`/ai-providers/${id}/status`, { isActive }).then((r) => r.provider);
}

export function setDefaultProvider(id: number): Promise<ProviderDetail> {
  return api.patch<{ provider: ProviderDetail }>(`/ai-providers/${id}/default`, {}).then((r) => r.provider);
}

export function deleteProvider(id: number): Promise<void> {
  return api.delete(`/ai-providers/${id}`);
}

/**
 * Verifies Cynth can reach and authenticate with the provider by reading its
 * model catalogue.
 *
 * A metadata read — deliberately not a test generation, which would be a
 * real, billable request. A connection test must never be able to charge
 * anyone.
 */
export function testProviderConnection(id: number): Promise<{
  ok: boolean;
  message: string;
  catalogSize: number;
  counts: { free: number; paid: number; unknown: number };
}> {
  return api.post(`/ai-providers/${id}/test-connection`, {});
}

export function addModel(providerId: number, input: ModelInput): Promise<ProviderModel> {
  return api.post<{ model: ProviderModel }>(`/ai-providers/${providerId}/models`, input).then((r) => r.model);
}

export function updateModel(providerId: number, modelId: number, input: ModelInput): Promise<ProviderModel> {
  return api.put<{ model: ProviderModel }>(`/ai-providers/${providerId}/models/${modelId}`, input).then((r) => r.model);
}

export function setModelStatus(providerId: number, modelId: number, isEnabled: boolean): Promise<ProviderModel> {
  return api
    .patch<{ model: ProviderModel }>(`/ai-providers/${providerId}/models/${modelId}/status`, { isEnabled })
    .then((r) => r.model);
}

/**
 * Makes a model the system default for ONE of its capabilities.
 *
 * The purpose is required: a model that writes articles AND reviews SEO has
 * two independent default questions, and picking one on the user's behalf
 * would silently reassign a default they never touched.
 */
export function setModelDefault(
  providerId: number,
  modelId: number,
  purpose: ModelPurpose,
): Promise<ProviderModel> {
  return api
    .patch<{ model: ProviderModel }>(`/ai-providers/${providerId}/models/${modelId}/default`, { purpose })
    .then((r) => r.model);
}

/** Adds one capability without disturbing the others the model holds. */
export function addModelCapability(
  providerId: number,
  modelId: number,
  purpose: ModelPurpose,
): Promise<ProviderModel> {
  return api
    .post<{ model: ProviderModel }>(`/ai-providers/${providerId}/models/${modelId}/capabilities`, { purpose })
    .then((r) => r.model);
}

/**
 * Removes one capability.
 *
 * If it was the system default for that purpose, the purpose is left with NO
 * default rather than another model being promoted into the role.
 */
export function removeModelCapability(
  providerId: number,
  modelId: number,
  purpose: ModelPurpose,
): Promise<ProviderModel> {
  return api
    .delete<{ model: ProviderModel }>(`/ai-providers/${providerId}/models/${modelId}/capabilities/${purpose}`)
    .then((r) => r.model);
}

/**
 * VALIDATE WITHOUT SAVING.
 *
 * Runs the full pipeline — configuration, endpoint, credential, catalogue,
 * and (with permission, or on a free model) one minimal live request — and
 * reports every stage. Writes nothing either way.
 */
export function validateModel(
  providerId: number,
  input: { modelName: string; confirmLiveTest?: boolean },
): Promise<ModelValidationResult> {
  return api.post<ModelValidationResult>(`/ai-providers/${providerId}/validate-model`, input);
}

export interface ModelTestResult {
  ok: boolean;
  tested: boolean;
  model?: ProviderModel;
  validation?: ModelValidationResult;
  estimatedProbeCost?: number | null;
  costClass?: string;
}

/**
 * TEST MODEL.
 *
 * Sends the smallest request that establishes the endpoint answers, the key
 * authenticates, the model runs and the response parses. It does NOT create
 * an article: the prompt is four words and the output is capped at a handful
 * of tokens.
 *
 * A free model is tested outright. A paid one needs `confirmLiveTest`, and
 * without it the request comes back as a 402 carrying the estimated cost.
 */
export function testModel(
  providerId: number,
  modelId: number,
  confirmLiveTest = false,
): Promise<ModelTestResult> {
  return api.post<ModelTestResult>(`/ai-providers/${providerId}/models/${modelId}/test`, { confirmLiveTest });
}

export function deleteModel(providerId: number, modelId: number): Promise<void> {
  return api.delete(`/ai-providers/${providerId}/models/${modelId}`);
}

export interface CatalogSyncSummary {
  providerId: number;
  providerName: string;
  updated: number;
  missingFromCatalog: string[];
  catalogSize: number;
  counts: { free: number; paid: number; unknown: number };
  syncedAt: string;
}

/**
 * CATALOGUE REFRESH — re-reads the provider's catalogue and updates the
 * provider-published metadata on every registered model.
 *
 * A metadata call: it generates nothing and costs nothing, but it is the only
 * way Cynth learns what a model costs. Without it every model stays
 * "unknown", which the cost layer treats as paid. User configuration
 * (purpose, enabled state, default-for-purpose) is preserved.
 */
export function syncProviderModels(id: number): Promise<CatalogSyncSummary> {
  return api.post<CatalogSyncSummary>(`/ai-providers/${id}/sync-models`, {});
}

/* ------------------------------------------ model discovery (Milestone 13) */

export interface DiscoverOptions {
  filter?: CatalogFilter;
  search?: string;
  /** Ignores the cached catalogue and re-reads it from the provider. */
  refresh?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * MODEL DISCOVERY — the provider's live catalogue.
 *
 * Cynth holds no hardcoded model list; everything this returns came from the
 * provider. `filter` is decided from published pricing, never from a model's
 * name.
 */
export function discoverModels(providerId: number, options: DiscoverOptions = {}): Promise<CatalogResult> {
  const params = new URLSearchParams();
  if (options.filter && options.filter !== 'all') params.set('filter', options.filter);
  if (options.search?.trim()) params.set('search', options.search.trim());
  if (options.refresh) params.set('refresh', 'true');
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));

  const query = params.toString();
  return api.get<CatalogResult>(`/ai-providers/${providerId}/catalog${query ? `?${query}` : ''}`);
}

/** One catalogue entry in full — the inspect step between discovering a model and adding it. */
export function fetchCatalogModel(providerId: number, modelId: string): Promise<CatalogModel> {
  return api
    .get<{ model: CatalogModel }>(`/ai-providers/${providerId}/catalog-entry?modelId=${encodeURIComponent(modelId)}`)
    .then((r) => r.model);
}

export interface AddFromCatalogResult {
  model: ProviderModel;
  /** False when the model was already registered and was refreshed instead of duplicated. */
  created: boolean;
  message: string;
  /** What validation established before the model was saved. */
  validation?: ModelValidationResult;
}

/**
 * ADD MODEL — saves a catalogue entry into Cynth's registry.
 *
 * Pricing comes from the provider's own catalogue server-side; this request
 * names a model and nothing more. Re-adding a registered model refreshes it
 * rather than creating a duplicate.
 */
export function addModelFromCatalog(
  providerId: number,
  input: {
    modelName: string;
    displayName?: string;
    purposes?: ModelPurpose[];
    isEnabled?: boolean;
    /** Permission to send one minimal, chargeable request as part of validating. */
    confirmLiveTest?: boolean;
  },
): Promise<AddFromCatalogResult> {
  return api.post<AddFromCatalogResult>(`/ai-providers/${providerId}/models/from-catalog`, input);
}

/**
 * The models that may serve a task.
 *
 * PURPOSE FILTERING (Milestone 15). Pass a purpose and only the models
 * registered for it come back — the New Article workflow asks for
 * article_generation, the SEO workflow asks for seo_review, and neither is
 * offered the other's models. Omit it to see the whole registry.
 */
export function fetchSelectableModels(purpose?: ModelPurpose): Promise<SelectableModel[]> {
  const query = purpose ? `?purpose=${encodeURIComponent(purpose)}` : '';
  return api.get<{ models: SelectableModel[] }>(`/ai-providers/selectable-models${query}`).then((r) => r.models);
}
