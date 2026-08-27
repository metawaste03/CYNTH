import { redactSecrets, truncateForDisplay } from '../generation/generation.errors.js';

/**
 * Every way a CMS operation can fail, expressed once in Cynth's own
 * vocabulary rather than any CMS's.
 *
 * Modelled on generation.errors.ts deliberately: the two subsystems have the
 * same shape of problem (configuration, credentials, transport, remote
 * refusal) and should not develop two different ways of describing it.
 *
 * Nothing here may carry a credential — see redactSecrets(), reused from the
 * generation layer so there is exactly one redaction implementation.
 */

export type CmsErrorCode =
  // Configuration problems — the user fixes these in WordPress settings.
  | 'connection_not_configured'
  | 'missing_credentials'
  | 'unsupported_connector'
  | 'invalid_configuration'
  | 'connection_inactive'
  // Reported by the CMS itself.
  | 'authentication_failed'
  | 'authorization_failed'
  | 'not_found'
  | 'rate_limited'
  | 'cms_error'
  // Transport.
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  // Cynth's own refusals. None is a CMS failure; each is Cynth declining to
  // do something the user has not clearly asked for.
  | 'article_not_generated'
  | 'already_pushed'
  | 'not_pushed_yet'
  | 'remote_post_missing'
  | 'remote_post_published'
  | 'push_in_progress';

const HTTP_STATUS_BY_CODE: Record<CmsErrorCode, number> = {
  connection_not_configured: 409,
  missing_credentials: 409,
  unsupported_connector: 409,
  invalid_configuration: 409,
  connection_inactive: 409,
  article_not_generated: 409,
  already_pushed: 409,
  not_pushed_yet: 409,
  remote_post_missing: 409,
  remote_post_published: 409,
  push_in_progress: 409,
  authentication_failed: 502,
  authorization_failed: 502,
  not_found: 502,
  rate_limited: 429,
  cms_error: 502,
  timeout: 504,
  network_error: 502,
  invalid_response: 502,
};

/** Whether repeating the identical request could plausibly succeed without the user changing something first. */
const RETRYABLE_CODES: ReadonlySet<CmsErrorCode> = new Set<CmsErrorCode>([
  'rate_limited',
  'cms_error',
  'timeout',
  'network_error',
  'invalid_response',
  'push_in_progress',
]);

export class CmsError extends Error {
  readonly code: CmsErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(code: CmsErrorCode, message: string) {
    super(message);
    this.name = 'CmsError';
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export function isCmsError(value: unknown): value is CmsError {
  return value instanceof CmsError;
}

/**
 * Makes a CMS's own wording safe to show and store: credentials removed,
 * whitespace collapsed, length capped.
 *
 * Basic-auth credentials are the risk here rather than bearer tokens, so the
 * username is redacted alongside the secret — a CMS that echoes "invalid
 * login for <user>" would otherwise put half the credential in the UI and in
 * the push history.
 */
export function sanitizeCmsMessage(text: string, secrets: (string | null | undefined)[]): string {
  const redacted = redactSecrets(text, secrets)
    // WordPress application passwords are five groups of four characters.
    .replace(/\b(?:[A-Za-z0-9]{4}\s){5}[A-Za-z0-9]{4}\b/g, '[REDACTED]')
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, 'Basic [REDACTED]');

  return truncateForDisplay(redacted);
}
