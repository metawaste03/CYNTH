import type { GenerationRequest, NormalizedGeneration, ProviderAdapter, ProviderCallContext } from '../generation.types.js';
import { callChatCompletions } from './openAiCompatible.js';

/**
 * OpenRouter, which exposes the same Chat Completions shape as OpenAI at a
 * different host. X-Title is OpenRouter's optional app-identification header;
 * it carries nothing but the product name — no key, no user data, no URL.
 */
export const openrouterAdapter: ProviderAdapter = {
  providerType: 'openrouter',

  generate(request: GenerationRequest, context: ProviderCallContext): Promise<NormalizedGeneration> {
    return callChatCompletions('openrouter', { 'x-title': 'Cynth' }, request, context);
  },
};
