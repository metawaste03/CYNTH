import type { GenerationRequest, NormalizedGeneration, ProviderAdapter, ProviderCallContext, TokenUsage } from '../generation.types.js';
import { ANTHROPIC_API_VERSION, ANTHROPIC_MAX_OUTPUT_TOKENS } from '../generation.constants.js';
import { postJson, readTokenCount, resolveBaseUrl, throwForFailedResponse, throwForUnparsableBody } from './providerHttp.js';

/**
 * Anthropic, via its Messages API. Differs from the OpenAI-compatible
 * providers in three ways, all handled here so nothing upstream knows:
 * an x-api-key header instead of a bearer token, a required anthropic-version
 * header, a required max_tokens, and a response body made of content blocks
 * rather than a single string.
 */

interface ContentBlock {
  type?: unknown;
  text?: unknown;
}

/** Concatenates the text blocks and ignores any other block type, so a future block type can't corrupt the article. */
function readText(body: Record<string, unknown>): string {
  const content = body.content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block): block is ContentBlock => Boolean(block) && typeof block === 'object')
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

/** Anthropic reports input/output tokens rather than prompt/completion, and reports no total — Cynth leaves it null rather than adding them up as if the provider had said so. */
function readUsage(body: Record<string, unknown>): TokenUsage | null {
  const usage = body.usage;
  if (!usage || typeof usage !== 'object') return null;

  return {
    promptTokens: readTokenCount(usage, 'input_tokens'),
    completionTokens: readTokenCount(usage, 'output_tokens'),
    totalTokens: null,
  };
}

export const anthropicAdapter: ProviderAdapter = {
  providerType: 'anthropic',

  async generate(request: GenerationRequest, context: ProviderCallContext): Promise<NormalizedGeneration> {
    const url = `${resolveBaseUrl(context.baseUrl, 'anthropic')}/v1/messages`;

    const response = await postJson(
      url,
      { 'x-api-key': context.apiKey, 'anthropic-version': ANTHROPIC_API_VERSION },
      {
        model: request.model,
        // Anthropic requires an explicit cap, so one is always sent. A caller
        // that asked for a smaller one (the model test) gets it.
        max_tokens: request.maxOutputTokens ?? ANTHROPIC_MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: request.prompt }],
      },
      request.timeoutMs,
    );

    if (!response.ok) throwForFailedResponse(response, context.apiKey);
    if (!response.json) throwForUnparsableBody(response);

    return {
      text: readText(response.json),
      usage: readUsage(response.json),
      finishReason: typeof response.json.stop_reason === 'string' ? response.json.stop_reason : null,
      reportedModel: typeof response.json.model === 'string' ? response.json.model : null,
    };
  },
};
