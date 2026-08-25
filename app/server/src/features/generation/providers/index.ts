import type { ProviderAdapter } from '../generation.types.js';
import { openaiAdapter } from './openaiAdapter.js';
import { openrouterAdapter } from './openrouterAdapter.js';
import { anthropicAdapter } from './anthropicAdapter.js';

/**
 * The adapter registry. Adding a provider means writing one adapter and
 * adding it to this list — the generation engine, the routes, and the UI
 * stay untouched.
 *
 * Keyed by ai_providers.provider_type, matching SUPPORTED_PROVIDER_TYPES in
 * ../../ai-providers/aiProviders.constants.ts.
 */
const ADAPTERS: ProviderAdapter[] = [openaiAdapter, anthropicAdapter, openrouterAdapter];

const ADAPTERS_BY_TYPE = new Map(ADAPTERS.map((adapter) => [adapter.providerType, adapter]));

export function getAdapter(providerType: string): ProviderAdapter | null {
  return ADAPTERS_BY_TYPE.get(providerType.trim().toLowerCase()) ?? null;
}

/** The provider types generation can actually run against, as opposed to the types a provider record may be stored with. */
export function supportedAdapterTypes(): string[] {
  return ADAPTERS.map((adapter) => adapter.providerType);
}
