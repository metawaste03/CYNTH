import { getAdapter } from '../generation/providers/index.js';
import { GenerationError } from '../generation/generation.errors.js';
import type { ProviderModelInfo } from '../generation/generation.types.js';
import { classifyModel } from '../generation/generationPolicy.service.js';
import type { ModelCostClass } from '../generation/generationPolicy.service.js';
import {
  getProviderApiKey,
  getProviderById,
  listRegisteredModelNames,
  refreshRegisteredModelMetadata,
} from './aiProviders.repository.js';
import type { ProviderDetailDto } from './aiProviders.repository.js';

/**
 * MODEL DISCOVERY.
 *
 * Reads a provider's own model catalogue and reports what it publishes:
 * names, ids, the upstream vendor, context length, input and output pricing,
 * capability metadata, and availability where the provider states it.
 *
 * Two things this file exists to guarantee:
 *
 *   1. Cynth has NO hardcoded model list. There is no array of model names
 *      anywhere in the codebase, because OpenRouter's roster changes and a
 *      baked-in list would be wrong within weeks. Everything offered comes
 *      from a live read of the provider's catalogue.
 *   2. Pricing comes from the provider and nowhere else. Nothing types a
 *      price in by hand and nothing infers one from a model's name — a model
 *      whose price the provider does not publish stays "unknown", which the
 *      cost layer treats as paid.
 *
 * Discovery is a metadata read: it generates nothing and costs nothing. It is
 * still an outbound call, so it is cached, and only performed when the user
 * asks or the cache has expired.
 */

/* ----------------------------------------------------------------- cache --- */

interface CachedCatalog {
  models: ProviderModelInfo[];
  fetchedAt: number;
}

/**
 * How long a fetched catalogue is reused before it is read again.
 *
 * Long enough that browsing, filtering and paging through models does not
 * re-hit the provider on every keystroke; short enough that pricing shown to
 * a user who has had the page open for a while is not meaningfully stale.
 * Any refresh=true request bypasses it entirely.
 */
export const CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;

const cache = new Map<number, CachedCatalog>();

/** Drops a provider's cached catalogue — used when its base URL or key changes, and by an explicit refresh. */
export function invalidateCatalogCache(providerId?: number): void {
  if (providerId === undefined) cache.clear();
  else cache.delete(providerId);
}

/* ------------------------------------------------------------- discovery --- */

/** A catalogue entry with the two things Cynth adds: its cost class, and whether it is already in the registry. */
export interface DiscoveredModel extends ProviderModelInfo {
  /**
   * Decided from published pricing alone, never from the model's name.
   * See classifyModel() in generation/generationPolicy.service.ts.
   */
  costClass: ModelCostClass;
  /** True when this model is already saved in Cynth's registry under this provider. */
  isRegistered: boolean;
}

export type CatalogFilter = 'all' | 'free' | 'paid' | 'unknown';

export function isValidCatalogFilter(value: unknown): value is CatalogFilter {
  return value === 'all' || value === 'free' || value === 'paid' || value === 'unknown';
}

export interface DiscoverModelsOptions {
  /** Free / paid / unknown, decided from pricing metadata. Defaults to every model. */
  filter?: CatalogFilter;
  /** Case-insensitive substring match against the model id, display name and vendor. */
  search?: string;
  /** Ignores the cache and re-reads the provider's catalogue. */
  refresh?: boolean;
  limit?: number;
  offset?: number;
}

export interface DiscoverModelsResult {
  providerId: number;
  providerName: string;
  providerType: string;
  /** The page of models being returned. */
  models: DiscoveredModel[];
  /** How many the provider publishes in total. */
  total: number;
  /** How many survived the filter and search. */
  matched: number;
  /** Counts across the WHOLE catalogue, so the UI can label its filters honestly. */
  counts: { free: number; paid: number; unknown: number };
  fetchedAt: string;
  /** True when this answer came from the cached catalogue rather than a fresh read. */
  fromCache: boolean;
  cacheExpiresAt: string;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function requireCatalogAdapter(provider: ProviderDetailDto) {
  const adapter = getAdapter(provider.providerType);
  if (!adapter) {
    throw new GenerationError(
      'unsupported_provider',
      `Cynth has no adapter for provider type "${provider.providerType}".`,
    );
  }
  if (!adapter.listModels) {
    throw new GenerationError(
      'invalid_configuration',
      `${provider.name} does not publish a model catalogue that Cynth can read, so its models must be added by hand and their pricing stays unknown.`,
    );
  }
  return adapter;
}

/** Reads the catalogue, from cache when it is fresh enough. */
async function loadCatalog(
  provider: ProviderDetailDto,
  refresh: boolean,
): Promise<{ models: ProviderModelInfo[]; fetchedAt: number; fromCache: boolean }> {
  const cached = cache.get(provider.id);
  if (!refresh && cached && Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return { models: cached.models, fetchedAt: cached.fetchedAt, fromCache: true };
  }

  const adapter = requireCatalogAdapter(provider);
  // The catalogue may be public, but send the key when there is one — some
  // providers return account-specific availability. The key never leaves this
  // call: it is not cached, logged, or returned.
  const apiKey = getProviderApiKey(provider.id) ?? '';
  const models = await adapter.listModels!({ apiKey, baseUrl: provider.baseUrl });

  const fetchedAt = Date.now();
  cache.set(provider.id, { models, fetchedAt });
  return { models, fetchedAt, fromCache: false };
}

function matchesSearch(model: ProviderModelInfo, needle: string): boolean {
  return (
    model.id.toLowerCase().includes(needle) ||
    (model.displayName?.toLowerCase().includes(needle) ?? false) ||
    (model.vendor?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * The provider's catalogue, classified and filtered.
 *
 * Discover -> inspect -> add is the intended path: this is the "discover"
 * step, and it writes nothing. Saving a model to the registry is a separate,
 * deliberate action (addModelFromCatalog).
 */
export async function discoverModels(
  providerId: number,
  options: DiscoverModelsOptions = {},
): Promise<DiscoverModelsResult> {
  const provider = getProviderById(providerId);
  if (!provider) throw new GenerationError('invalid_configuration', 'Provider not found.');

  const { models, fetchedAt, fromCache } = await loadCatalog(provider, options.refresh === true);
  const registered = new Set(listRegisteredModelNames(providerId));

  const classified: DiscoveredModel[] = models.map((model) => ({
    ...model,
    costClass: classifyModel(model),
    isRegistered: registered.has(model.id),
  }));

  const counts = { free: 0, paid: 0, unknown: 0 };
  for (const model of classified) counts[model.costClass] += 1;

  const filter = options.filter ?? 'all';
  const needle = options.search?.trim().toLowerCase() ?? '';

  const filtered = classified.filter(
    (model) => (filter === 'all' || model.costClass === filter) && (!needle || matchesSearch(model, needle)),
  );

  // Cheapest first within a class, so "what can I use for nothing" and "what
  // is the least this will cost" are both one glance. Unpriced models sort
  // last rather than pretending to be cheap.
  filtered.sort((a, b) => {
    const priceOf = (m: DiscoveredModel) =>
      m.promptPrice === null || m.completionPrice === null
        ? Number.POSITIVE_INFINITY
        : m.promptPrice + m.completionPrice;
    const diff = priceOf(a) - priceOf(b);
    return diff !== 0 && Number.isFinite(diff) ? diff : a.id.localeCompare(b.id);
  });

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? DEFAULT_LIMIT));

  return {
    providerId,
    providerName: provider.name,
    providerType: provider.providerType,
    models: filtered.slice(offset, offset + limit),
    total: classified.length,
    matched: filtered.length,
    counts,
    fetchedAt: new Date(fetchedAt).toISOString(),
    fromCache,
    cacheExpiresAt: new Date(fetchedAt + CATALOG_CACHE_TTL_MS).toISOString(),
  };
}

/** One catalogue entry by id, for the inspect step. Null when the provider no longer lists it. */
export async function findCatalogModel(providerId: number, modelId: string): Promise<DiscoveredModel | null> {
  const found = await discoverModels(providerId, { search: modelId, limit: MAX_LIMIT });
  return found.models.find((model) => model.id === modelId) ?? null;
}

/* --------------------------------------------------------------- refresh --- */

export interface CatalogSyncResult {
  providerId: number;
  providerName: string;
  /** How many registered models under this provider had their provider metadata refreshed. */
  updated: number;
  /** Registered models the provider's catalogue no longer lists at all. */
  missingFromCatalog: string[];
  /** How many models the provider currently publishes, and how they classify. */
  catalogSize: number;
  counts: { free: number; paid: number; unknown: number };
  syncedAt: string;
}

/**
 * CATALOGUE REFRESH.
 *
 * Re-reads the provider's catalogue and updates the provider-published
 * metadata on every model already in Cynth's registry: pricing, context
 * length, vendor, capabilities and availability.
 *
 * What it deliberately does NOT touch is everything the user chose —
 * display name, purpose, enabled state and default-for-purpose. Provider
 * metadata is the provider's to change; configuration is the user's, and a
 * refresh must never quietly undo a decision they made.
 *
 * A model that has vanished from the catalogue keeps its last known pricing
 * and is reported as missing. Blanking it would be worse: "we no longer know
 * what this costs" would then be indistinguishable from "this is free".
 */
export async function refreshProviderModels(providerId: number): Promise<CatalogSyncResult> {
  const provider = getProviderById(providerId);
  if (!provider) throw new GenerationError('invalid_configuration', 'Provider not found.');

  requireCatalogAdapter(provider);
  const discovered = await discoverModels(providerId, { refresh: true, limit: MAX_LIMIT });

  // discoverModels() paginates; the refresh needs the whole catalogue, so read
  // it back out of the cache it just populated.
  const catalog = cache.get(providerId)?.models ?? discovered.models;
  const result = refreshRegisteredModelMetadata(providerId, catalog);

  return {
    providerId,
    providerName: provider.name,
    updated: result.updated,
    missingFromCatalog: result.missingFromCatalog,
    catalogSize: catalog.length,
    counts: discovered.counts,
    syncedAt: new Date().toISOString(),
  };
}

/** The free models a catalogue currently publishes. Classification is by price, never by name. */
export function freeModelsIn(catalog: ProviderModelInfo[]): ProviderModelInfo[] {
  return catalog.filter((model) => classifyModel(model) === 'free');
}
