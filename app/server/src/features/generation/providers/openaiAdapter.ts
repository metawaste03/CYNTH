import type { GenerationRequest, NormalizedGeneration, ProviderAdapter, ProviderCallContext } from '../generation.types.js';
import { callChatCompletions } from './openAiCompatible.js';

/** OpenAI, via its Chat Completions API. Base URL defaults to https://api.openai.com/v1. */
export const openaiAdapter: ProviderAdapter = {
  providerType: 'openai',

  generate(request: GenerationRequest, context: ProviderCallContext): Promise<NormalizedGeneration> {
    return callChatCompletions('openai', {}, request, context);
  },
};
