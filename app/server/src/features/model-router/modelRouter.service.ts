import { getDatabase } from '../../shared/database/index.js';
import type { AiProviderRow, AiProviderModelRow } from '../../shared/database/types.js';
import { hasProviderSecret } from '../../shared/secrets/providerSecrets.js';
import { isValidPurpose } from '../ai-providers/aiProviders.constants.js';

/**
 * The Model Router: given a task type, returns which provider and model are
 * configured to handle it — nothing more. It never contacts a provider and
 * never returns the API key itself, only whether one is set.
 */

export interface RoutedProvider {
  id: number;
  name: string;
  providerType: string;
  baseUrl: string | null;
  hasApiKey: boolean;
}

export interface RoutedModel {
  id: number;
  modelName: string;
  displayName: string | null;
}

export interface ModelRouteResult {
  purpose: string;
  configured: boolean;
  provider: RoutedProvider | null;
  model: RoutedModel | null;
  reason?: string;
}

export interface ModelRouteFailure {
  errors: string[];
}

function unconfigured(purpose: string, reason: string): ModelRouteResult {
  return { purpose, configured: false, provider: null, model: null, reason };
}

export function routeForPurpose(purpose: string): ModelRouteResult | ModelRouteFailure {
  if (!isValidPurpose(purpose)) {
    return { errors: ['Unknown task type.'] };
  }

  const db = getDatabase();
  const modelRow = db
    .prepare('SELECT * FROM ai_provider_models WHERE purpose = ? AND is_default_for_purpose = 1')
    .get(purpose) as unknown as AiProviderModelRow | undefined;

  if (!modelRow) return unconfigured(purpose, 'No default model is set for this purpose yet.');

  const providerRow = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(modelRow.provider_id) as unknown as
    | AiProviderRow
    | undefined;

  if (!providerRow) return unconfigured(purpose, 'The configured provider no longer exists.');
  if (providerRow.is_active !== 1) return unconfigured(purpose, 'The configured provider is disabled.');
  if (modelRow.is_enabled !== 1) return unconfigured(purpose, 'The configured model is disabled.');

  return {
    purpose,
    configured: true,
    provider: {
      id: providerRow.id,
      name: providerRow.name,
      providerType: providerRow.provider_type,
      baseUrl: providerRow.base_url,
      hasApiKey: hasProviderSecret(providerRow.api_key_env_var),
    },
    model: {
      id: modelRow.id,
      modelName: modelRow.model_name,
      displayName: modelRow.display_name,
    },
  };
}
