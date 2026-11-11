import { routeForModel, routeForPurpose } from '../model-router/modelRouter.service.js';
import type { ModelRouteResult } from '../model-router/modelRouter.service.js';
import { getProviderApiKey } from '../ai-providers/aiProviders.repository.js';
import { getAdapter } from './providers/index.js';
import type { ProviderAdapter } from './generation.types.js';
import { GenerationError } from './generation.errors.js';

/**
 * PROVIDER TARGET RESOLUTION.
 *
 * One answer to "which provider and model will run this task, and can it
 * actually run" — shared by every AI task rather than reimplemented per
 * feature. Article generation (Milestone 9) and SEO analysis (Milestone 14)
 * both resolve through here, so a task cannot accidentally acquire different
 * configuration rules or a different notion of what counts as ready.
 *
 * It returns rather than throws, so a preflight can report exactly the
 * problem the live call would hit, before anything is sent.
 *
 * The API key never leaves this module except inside ResolvedTarget, which is
 * server-side only and is never serialised into a route response.
 */

export interface ResolvedTarget {
  providerName: string;
  providerType: string;
  baseUrl: string | null;
  modelName: string;
  adapter: ProviderAdapter;
  /** Server-side only. Never returned by a route, never logged, never persisted. */
  apiKey: string;
}

export interface TargetResolution {
  /** Display-safe routing info, present whenever the router found a provider/model at all. */
  route: ModelRouteResult | null;
  target: ResolvedTarget | null;
  /** The first blocking problem, if any. */
  error: GenerationError | null;
}

/**
 * `modelId` is an explicit user selection. When it is given, that model is
 * resolved and no other — a selected model that cannot run produces an error,
 * never a substitution. There is no fallback path anywhere in this function.
 */
export function resolveProviderTarget(
  taskType: string,
  modelId?: number | null,
  taskLabel = 'this task',
): TargetResolution {
  const routed = modelId ? routeForModel(taskType, modelId) : routeForPurpose(taskType);

  if ('errors' in routed) {
    return {
      route: null,
      target: null,
      error: new GenerationError('invalid_configuration', 'Unknown task type.'),
    };
  }

  if (!routed.configured || !routed.provider || !routed.model) {
    const reason = routed.reason ? `${routed.reason} ` : '';
    return {
      route: routed,
      target: null,
      error: new GenerationError(
        'provider_not_configured',
        modelId
          ? `The selected model cannot be used. ${reason}Choose another model, or fix it in Settings then AI Providers.`
          : `No model is configured for ${taskLabel}. ${reason}Open Settings then AI Providers, and set a default model for this task.`,
      ),
    };
  }

  const adapter = getAdapter(routed.provider.providerType);
  if (!adapter) {
    return {
      route: routed,
      target: null,
      error: new GenerationError(
        'unsupported_provider',
        `Cynth has no adapter for provider type "${routed.provider.providerType}". Supported types are OpenRouter, Anthropic, and OpenAI.`,
      ),
    };
  }

  if (!routed.model.modelName.trim()) {
    return {
      route: routed,
      target: null,
      error: new GenerationError(
        'missing_model',
        'The configured provider has no model name set. Add one in Settings then AI Providers.',
      ),
    };
  }

  const apiKey = getProviderApiKey(routed.provider.id);
  if (!apiKey) {
    return {
      route: routed,
      target: null,
      error: new GenerationError(
        'missing_api_key',
        `No API key is stored for "${routed.provider.name}". Add one in Settings then AI Providers.`,
      ),
    };
  }

  return {
    route: routed,
    error: null,
    target: {
      providerName: routed.provider.name,
      providerType: routed.provider.providerType,
      baseUrl: routed.provider.baseUrl,
      modelName: routed.model.modelName,
      adapter,
      apiKey,
    },
  };
}
