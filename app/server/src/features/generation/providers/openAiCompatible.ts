import type { GenerationRequest, NormalizedGeneration, ProviderCallContext, TokenUsage } from '../generation.types.js';
import { postJson, readTokenCount, resolveBaseUrl, throwForFailedResponse, throwForUnparsableBody } from './providerHttp.js';

/**
 * OpenAI's Chat Completions request/response shape, which OpenRouter also
 * speaks. Shared so the two adapters differ only where they actually differ
 * (endpoint host, extra headers) rather than by copy-paste.
 *
 * No output-token limit is sent: it is optional here, and omitting it avoids
 * the max_tokens vs. max_completion_tokens split between older and newer
 * OpenAI models. See generation.constants.ts.
 */

interface ChatChoice {
  message?: { content?: unknown };
  finish_reason?: unknown;
}

function readUsage(body: Record<string, unknown>): TokenUsage | null {
  const usage = body.usage;
  if (!usage || typeof usage !== 'object') return null;

  return {
    promptTokens: readTokenCount(usage, 'prompt_tokens'),
    completionTokens: readTokenCount(usage, 'completion_tokens'),
    totalTokens: readTokenCount(usage, 'total_tokens'),
  };
}

export async function callChatCompletions(
  providerType: string,
  extraHeaders: Record<string, string>,
  request: GenerationRequest,
  context: ProviderCallContext,
): Promise<NormalizedGeneration> {
  const url = `${resolveBaseUrl(context.baseUrl, providerType)}/chat/completions`;

  const response = await postJson(
    url,
    { authorization: `Bearer ${context.apiKey}`, ...extraHeaders },
    {
      model: request.model,
      messages: [{ role: 'user', content: request.prompt }],
      // Sent ONLY when the caller set a cap — that is, for a model test.
      // Generation still sends no limit, which is what keeps the max_tokens
      // vs. max_completion_tokens split off the article path entirely.
      ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
    },
    request.timeoutMs,
  );

  if (!response.ok) throwForFailedResponse(response, context.apiKey);
  if (!response.json) throwForUnparsableBody(response);

  const choices = response.json.choices;
  const choice: ChatChoice | undefined = Array.isArray(choices) ? (choices[0] as ChatChoice) : undefined;
  const content = choice?.message?.content;

  return {
    // An absent/blank body is not an error here — the service decides what
    // "empty" means, in one place, for every provider.
    text: typeof content === 'string' ? content : '',
    usage: readUsage(response.json),
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    reportedModel: typeof response.json.model === 'string' ? response.json.model : null,
  };
}
