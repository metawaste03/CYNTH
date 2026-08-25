/**
 * Every way generation can fail, expressed once, in Cynth's own vocabulary
 * rather than any provider's. Adapters translate provider failures into
 * these; routes translate these into HTTP responses; the UI shows the
 * message as-is.
 *
 * Nothing here may carry an API key, an authorization header, or a raw
 * provider payload — see redactSecrets() below.
 */

export type GenerationErrorCode =
  // Configuration problems — the user must fix these in AI Provider settings.
  | 'provider_not_configured'
  | 'missing_api_key'
  | 'missing_model'
  | 'unsupported_provider'
  | 'invalid_configuration'
  // Problems reported by the provider itself.
  | 'authentication_failed'
  | 'model_not_found'
  | 'rate_limited'
  | 'provider_error'
  // Transport / response problems.
  | 'timeout'
  | 'network_error'
  | 'empty_response'
  // Cynth's own guard against a duplicate request.
  | 'generation_in_progress';

const HTTP_STATUS_BY_CODE: Record<GenerationErrorCode, number> = {
  provider_not_configured: 409,
  missing_api_key: 409,
  missing_model: 409,
  unsupported_provider: 409,
  invalid_configuration: 409,
  generation_in_progress: 409,
  authentication_failed: 502,
  model_not_found: 502,
  rate_limited: 429,
  provider_error: 502,
  timeout: 504,
  network_error: 502,
  empty_response: 502,
};

/**
 * Whether retrying the exact same request could plausibly succeed without the
 * user changing anything first. A configuration error is not retryable; a
 * rate limit or a network blip is. Cynth never acts on this by itself — it
 * only tells the UI whether to offer a Retry button.
 */
const RETRYABLE_CODES: ReadonlySet<GenerationErrorCode> = new Set<GenerationErrorCode>([
  'rate_limited',
  'provider_error',
  'timeout',
  'network_error',
  'empty_response',
  'generation_in_progress',
]);

export class GenerationError extends Error {
  readonly code: GenerationErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(code: GenerationErrorCode, message: string) {
    super(message);
    this.name = 'GenerationError';
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export function isGenerationError(value: unknown): value is GenerationError {
  return value instanceof GenerationError;
}

/**
 * Last line of defence before any provider-supplied text is stored or
 * returned: removes the literal secret values Cynth knows about, plus
 * anything shaped like a bearer token, in case a provider echoes the key
 * back inside its own error message.
 */
export function redactSecrets(text: string, secrets: (string | null | undefined)[] = []): string {
  let output = text;

  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;

    output = output.split(secret).join('[REDACTED]');

    // Providers sometimes quote the key back partially masked — OpenAI
    // answers a bad key with "Incorrect API key provided: sk-abcdef***…1234",
    // which still exposes its opening characters. Anything that begins with
    // the key's own prefix is redacted whole.
    const prefix = secret.slice(0, 6).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`${prefix}[A-Za-z0-9*._-]*`, 'g'), '[REDACTED]');
  }

  return output
    .replace(/\b(sk|rk|or)-[A-Za-z0-9._-]{8,}/g, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [REDACTED]');
}

/** Keeps a provider's own wording useful without letting it flood the UI or the history log. */
export function truncateForDisplay(text: string, maxLength = 400): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}
