import { getConnector } from './connectors/index.js';

export interface CmsConnectionInput {
  name: string;
  connectorType: string;
  description: string | null;
  /** The site root, e.g. http://everyfivedays.local. Never defaulted — the user states where their site is. */
  baseUrl: string;
  authMethod: string;
  username: string | null;
  /**
   * undefined = leave the stored credential untouched; '' = clear it; any
   * other string = set or rotate it. Never read back from the API.
   */
  credential: string | undefined;
}

interface ValidationResult<T> {
  errors: string[];
  value?: T;
}

/**
 * A site URL Cynth is willing to talk to.
 *
 * Deliberately permissive about the host: the same connection must work for
 * `http://everyfivedays.local` today and a live HTTPS domain later, so
 * nothing here assumes localhost, a port, or a scheme beyond http/https.
 * What it does reject is a URL with a path, query or fragment — those are
 * pages, not site roots, and silently trimming them would hide a typo that
 * produces confusing 404s much later.
 */
function validateBaseUrl(raw: string, errors: string[]): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    errors.push('Site URL is required.');
    return '';
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    errors.push('Site URL must be a full address, for example http://everyfivedays.local');
    return trimmed;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    errors.push('Site URL must start with http:// or https://');
  }
  if (parsed.search || parsed.hash) {
    errors.push('Site URL must be the site address only, with no query string or fragment.');
  }
  if (parsed.pathname && parsed.pathname !== '/') {
    errors.push(
      'Site URL must be the site root, with no path. Cynth adds /wp-json itself, so enter http://example.com rather than http://example.com/wp-json',
    );
  }

  return trimmed;
}

export function validateCmsConnectionInput(body: unknown): ValidationResult<CmsConnectionInput> {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { errors: ['Request body must be an object.'] };
  }
  const input = body as Record<string, unknown>;

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.push('Connection Name is required.');

  const connectorType = typeof input.connectorType === 'string' ? input.connectorType.trim().toLowerCase() : '';
  if (!connectorType) {
    errors.push('CMS type is required.');
  }

  const connector = connectorType ? getConnector(connectorType) : null;
  if (connectorType && !connector) {
    errors.push(`Cynth has no connector for CMS type "${connectorType}".`);
  }

  const baseUrl = validateBaseUrl(typeof input.baseUrl === 'string' ? input.baseUrl : '', errors);

  const authMethod =
    typeof input.authMethod === 'string' && input.authMethod.trim()
      ? input.authMethod.trim()
      : (connector?.authMethods[0] ?? 'application_password');

  if (connector && !connector.authMethods.includes(authMethod)) {
    errors.push(`${connector.label} does not support the authentication method "${authMethod}".`);
  }

  if (input.username !== undefined && input.username !== null && typeof input.username !== 'string') {
    errors.push('username must be text.');
  }
  if (input.description !== undefined && input.description !== null && typeof input.description !== 'string') {
    errors.push('description must be text.');
  }
  if (input.credential !== undefined && typeof input.credential !== 'string') {
    errors.push('credential must be text.');
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    value: {
      name,
      connectorType,
      description: (input.description as string | undefined)?.trim() || null,
      baseUrl,
      authMethod,
      username: (input.username as string | undefined)?.trim() || null,
      credential: input.credential as string | undefined,
    },
  };
}
