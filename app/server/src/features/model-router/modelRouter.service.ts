import { getDatabase } from '../../shared/database/index.js';
import type { AiProviderRow, AiProviderModelRow } from '../../shared/database/types.js';
import { hasSecret } from '../../shared/secrets/secretStore.js';
import { isValidPurpose } from '../ai-providers/aiProviders.constants.js';
import { classifyModel } from '../generation/generationPolicy.service.js';
import type { ModelCostClass } from '../generation/generationPolicy.service.js';

/**
 * The Model Router: given a task type — or a specific model the user picked —
 * returns which provider and model will handle it, and nothing more. It never
 * contacts a provider and never returns the API key itself, only whether one
 * is set.
 *
 * Two entry points, one shape:
 *
 *   routeForPurpose(purpose)  the configured default for a task
 *   routeForModel(modelId)    a model the user explicitly chose
 *
 * The second exists so the New Article workflow can offer a choice. It is
 * still the router that resolves it: the frontend names a registry entry, it
 * never names a provider, a base URL, or a credential.
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
  /** The upstream house behind the model, as distinct from the provider record reaching it. */
  vendor: string | null;
  /**
   * Pricing per token as last synced from the provider's catalogue. Null
   * means unknown — the cost layer treats unknown as paid, never as free.
   */
  promptPrice: number | null;
  completionPrice: number | null;
  /** A flat per-request charge, where the catalogue publishes one. */
  requestPrice: number | null;
  /** What image output costs, where the catalogue publishes it. */
  imageOutputPrice: number | null;
  contextLength: number | null;
  /** Derived from the prices above, never from the model's name. */
  costClass: ModelCostClass;
  pricingSyncedAt: string | null;
}

export interface ModelRouteResult {
  purpose: string;
  configured: boolean;
  provider: RoutedProvider | null;
  model: RoutedModel | null;
  /** True when the model came from an explicit user choice rather than the purpose default. */
  isExplicitSelection: boolean;
  reason?: string;
}

export interface ModelRouteFailure {
  errors: string[];
}

function unconfigured(purpose: string, reason: string): ModelRouteResult {
  return { purpose, configured: false, provider: null, model: null, isExplicitSelection: false, reason };
}

function mapRoutedModel(row: AiProviderModelRow): RoutedModel {
  return {
    id: row.id,
    modelName: row.model_name,
    displayName: row.display_name,
    vendor: row.vendor,
    promptPrice: row.prompt_price,
    completionPrice: row.completion_price,
    requestPrice: row.request_price,
    imageOutputPrice: row.image_output_price,
    contextLength: row.context_length,
    costClass: classifyModel({
      promptPrice: row.prompt_price,
      completionPrice: row.completion_price,
      requestPrice: row.request_price,
      imageOutputPrice: row.image_output_price,
    }),
    pricingSyncedAt: row.pricing_synced_at,
  };
}

function mapRoutedProvider(row: AiProviderRow): RoutedProvider {
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    hasApiKey: hasSecret(row.api_key_env_var),
  };
}

export function routeForPurpose(purpose: string): ModelRouteResult | ModelRouteFailure {
  if (!isValidPurpose(purpose)) {
    return { errors: ['Unknown task type.'] };
  }

  const db = getDatabase();
  /**
   * The default now lives on the capability, not on the model row
   * (Milestone 15): a model may hold several capabilities and be the default
   * for some of them, so "which model handles SEO Review" is a question about
   * ai_model_capabilities.
   */
  const modelRow = db
    .prepare(`
      SELECT m.* FROM ai_provider_models m
      JOIN ai_model_capabilities c ON c.model_id = m.id
      WHERE c.purpose = ? AND c.is_default_for_purpose = 1
    `)
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
    isExplicitSelection: false,
    provider: mapRoutedProvider(providerRow),
    model: mapRoutedModel(modelRow),
  };
}

/**
 * Resolves one specific registry entry the user chose, for the same task.
 *
 * MODEL SAFETY: this returns exactly the model that was asked for, or it
 * returns a reason why it cannot. There is no branch that quietly resolves to
 * a different model — not the purpose default, not a cheaper one, not a
 * working one. A model the user selected is the model that runs, or nothing
 * runs.
 */
export function routeForModel(purpose: string, modelId: number): ModelRouteResult | ModelRouteFailure {
  if (!isValidPurpose(purpose)) {
    return { errors: ['Unknown task type.'] };
  }

  const db = getDatabase();
  const modelRow = db.prepare('SELECT * FROM ai_provider_models WHERE id = ?').get(modelId) as unknown as
    | AiProviderModelRow
    | undefined;

  if (!modelRow) {
    return unconfigured(purpose, 'The selected model is no longer in Cynth’s model registry.');
  }

  const providerRow = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(modelRow.provider_id) as unknown as
    | AiProviderRow
    | undefined;

  if (!providerRow) return unconfigured(purpose, 'The selected model’s provider no longer exists.');
  if (providerRow.is_active !== 1) {
    return unconfigured(purpose, `The selected model’s provider (${providerRow.name}) is disabled.`);
  }
  if (modelRow.is_enabled !== 1) {
    return unconfigured(purpose, `The selected model (${modelRow.model_name}) is disabled in the model registry.`);
  }

  /**
   * CAPABILITY CHECK (Milestone 15).
   *
   * The pickers already filter by capability, so this only fires on a request
   * that did not come from one. Enforcing it here rather than trusting the UI
   * is what makes "SEO models and article models are different" a property of
   * the system instead of a property of one screen.
   */
  const holdsCapability = db
    .prepare('SELECT id FROM ai_model_capabilities WHERE model_id = ? AND purpose = ?')
    .get(modelRow.id, purpose);
  if (!holdsCapability) {
    return unconfigured(
      purpose,
      `${modelRow.model_name} is not registered for this task. Assign it that capability in Settings then ` +
        `AI Providers, or choose a model that already has it.`,
    );
  }

  return {
    purpose,
    configured: true,
    isExplicitSelection: true,
    provider: mapRoutedProvider(providerRow),
    model: mapRoutedModel(modelRow),
  };
}
