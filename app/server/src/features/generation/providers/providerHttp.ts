import { GenerationError, redactSecrets, truncateForDisplay } from '../generation.errors.js';
import { describeUnparsableBody, diagnoseBaseUrl } from './baseUrl.js';

/**
 * The HTTP plumbing every provider adapter shares: one attempt, a hard
 * timeout, and a single place where an unhappy response becomes one of
 * Cynth's own error codes.
 *
 * Uses the runtime's built-in fetch — Milestone 9 adds no vendor SDKs, so
 * the server's dependency list is unchanged.
 */

export interface ProviderResponse {
  status: number;
  ok: boolean;
  /** Parsed JSON body, or null if the provider sent something that wasn't JSON. */
  json: Record<string, unknown> | null;
  /** Raw body text, kept only for error reporting when JSON parsing fails. */
  rawText: string;
  /** The response's declared content type, so an unparseable body can say what it actually was. */
  contentType: string | null;
  /** The URL that produced this response, so an error can name it. Never carries a credential — keys travel in headers. */
  url: string;
}

/**
 * Normalizes a configured base_url or falls back to the adapter default,
 * refusing one that is wrong in a way Cynth can name.
 *
 * The refusal quotes the corrected value rather than applying it: a provider
 * may legitimately sit behind a proxy whose URL Cynth has no business
 * rewriting. See baseUrl.ts for the failure this guards against.
 */
export function resolveBaseUrl(baseUrl: string | null, providerType: string): string {
  const diagnosis = diagnoseBaseUrl(baseUrl, providerType);
  if (diagnosis.ok && diagnosis.resolved) return diagnosis.resolved;

  throw new GenerationError(
    'invalid_configuration',
    diagnosis.suggestion
      ? `${diagnosis.problem} Set the Base URL to ${diagnosis.suggestion} in AI Provider settings.`
      : `${diagnosis.problem} Update it in AI Provider settings.`,
  );
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<ProviderResponse> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // Deliberately does not include the thrown error's text: it can echo
    // request details, and it never tells the user anything actionable.
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GenerationError(
        'timeout',
        `The provider did not respond within ${Math.round(timeoutMs / 1000)} seconds. Nothing was saved — you can try again.`,
      );
    }
    throw new GenerationError(
      'network_error',
      'Cynth could not reach the provider. Check your internet connection and the provider Base URL, then try again.',
    );
  }

  return readResponse(response, url);
}

/** Reads a fetch Response into Cynth's own shape. Shared so POST and GET report an unreadable body identically. */
async function readResponse(response: Response, url: string): Promise<ProviderResponse> {
  const rawText = await response.text().catch(() => '');
  let json: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>;
  } catch {
    json = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    json,
    rawText,
    contentType: response.headers.get('content-type'),
    url,
  };
}

/**
 * Pulls the human-readable part out of a provider error body. OpenAI,
 * OpenRouter, and Anthropic all use `{ error: { message } }`, so one reader
 * covers all three; anything else falls back to the raw body.
 */
function extractProviderMessage(response: ProviderResponse): string {
  const error = response.json?.error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof response.json?.message === 'string' && response.json.message.trim()) {
    return response.json.message as string;
  }
  return response.rawText || 'No details were returned.';
}

/**
 * Turns a failed provider response into a Cynth error. The provider's own
 * wording is kept — it is often the only thing that explains *why* (an
 * unknown model id, an exhausted quota) — but it is redacted and truncated
 * first, and no headers or credentials are ever included.
 */
export function throwForFailedResponse(response: ProviderResponse, apiKey: string): never {
  const detail = truncateForDisplay(redactSecrets(extractProviderMessage(response), [apiKey]));

  if (response.status === 401 || response.status === 403) {
    throw new GenerationError(
      'authentication_failed',
      `The provider rejected Cynth's API key. Check the key in AI Provider settings. Provider said: ${detail}`,
    );
  }
  if (response.status === 404) {
    throw new GenerationError(
      'model_not_found',
      `The provider does not recognise the configured model. Check the model name in AI Provider settings. Provider said: ${detail}`,
    );
  }
  if (response.status === 429) {
    throw new GenerationError(
      'rate_limited',
      `The provider is rate-limiting or has run out of quota. Wait a moment and try again. Provider said: ${detail}`,
    );
  }
  if (response.status >= 500) {
    throw new GenerationError(
      'provider_error',
      `The provider reported a server error (HTTP ${response.status}). Nothing was saved — you can try again. Provider said: ${detail}`,
    );
  }

  throw new GenerationError(
    'provider_error',
    `The provider rejected the request (HTTP ${response.status}). Provider said: ${detail}`,
  );
}

/**
 * A 200 that isn't JSON at all — malformed rather than an empty article.
 *
 * The message names what came back and from where, because "could not read
 * the response" on its own is unactionable: it reads as a provider fault when
 * the usual cause is a Base URL pointing at a website instead of an API root,
 * which answers 200 with a perfectly valid HTML page. See baseUrl.ts.
 */
export function throwForUnparsableBody(response?: ProviderResponse): never {
  if (!response) {
    throw new GenerationError(
      'provider_error',
      'The provider returned a response Cynth could not read. Nothing was saved — you can try again.',
    );
  }

  const what = describeUnparsableBody(response.contentType, response.rawText);
  const isWebPage = what === 'an HTML web page';

  throw new GenerationError(
    'provider_error',
    isWebPage
      ? `${response.url} returned ${what} instead of data. The provider Base URL is almost certainly pointing at the ` +
        `website rather than the API endpoint — check it in AI Provider settings.`
      : `${response.url} returned ${what}. Cynth could not read it, so nothing was saved.`,
  );
}

/** Reads a numeric usage field, keeping "not reported" distinct from zero. Token counts are never invented. */
export function readTokenCount(source: unknown, key: string): number | null {
  if (!source || typeof source !== 'object') return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A GET returning JSON, for provider metadata endpoints (model catalogues).
 * Shares postJson's timeout and error vocabulary; generates nothing.
 */
export async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ProviderResponse> {
  let response: Response;

  try {
    response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GenerationError('timeout', `The provider did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw new GenerationError('network_error', 'Cynth could not reach the provider to read its model catalogue.');
  }

  const result = await readResponse(response, url);

  if (!result.ok) throwForFailedResponse(result, headers.authorization ?? '');
  if (!result.json) throwForUnparsableBody(result);

  return result;
}
