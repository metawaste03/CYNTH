import { getSetting, setSetting } from '../../../shared/settings/settings.repository.js';
import { deleteSecret, hasSecret, setSecret } from '../../../shared/secrets/secretStore.js';
import { AMAZON_MARKETPLACES } from './amazonUrl.js';

/**
 * Amazon Creators API configuration.
 *
 * Follows the credential rule the rest of Cynth already follows, without
 * inventing a second one: the two secret values live in the gitignored
 * .env.local via the secret store and NEVER touch SQLite, and the database
 * holds only non-secret configuration plus the env var names. `hasCredentials`
 * is the only thing any route is allowed to say about them.
 *
 * The partner tag is deliberately NOT a secret. It is published in every
 * affiliate link on the site, so treating it as one would be theatre — and it
 * needs to be visible and editable in the UI.
 */

/** Fixed names rather than generated ones: there is exactly one Amazon account per Cynth install. */
export const AMAZON_CLIENT_ID_ENV_VAR = 'CYNTH_AMAZON_CREATORS_CLIENT_ID';
export const AMAZON_CLIENT_SECRET_ENV_VAR = 'CYNTH_AMAZON_CREATORS_CLIENT_SECRET';

const SETTING_PARTNER_TAG = 'amazon.creators.partnerTag';
const SETTING_MARKETPLACE = 'amazon.creators.marketplace';
const SETTING_CREDENTIAL_VERSION = 'amazon.creators.credentialVersion';

/**
 * The credential version Amazon issued, which selects the OAuth token host.
 *
 * From the Creators API regional-endpoints table. The version is a property of
 * the credentials, not of the URL being looked up, so it is configured once
 * rather than derived per request.
 */
export const CREDENTIAL_VERSIONS = [
  { version: '3.1', region: 'NA', tokenHost: 'api.amazon.com', label: 'North America (US, CA, MX, BR)' },
  { version: '3.2', region: 'EU', tokenHost: 'api.amazon.co.uk', label: 'Europe (UK, DE, FR, IT, ES, IN, and others)' },
  { version: '3.3', region: 'FE', tokenHost: 'api.amazon.co.jp', label: 'Far East (JP, SG, AU)' },
] as const;

export type CredentialVersion = (typeof CREDENTIAL_VERSIONS)[number]['version'];

export interface AmazonConfig {
  /** The Associates tag, e.g. "everyfivedays-20". Public by nature. */
  partnerTag: string | null;
  /** Default marketplace, used when a URL does not name one. */
  marketplace: string;
  credentialVersion: CredentialVersion;
  /** Whether both secrets are actually set. The only fact exposed about them. */
  hasCredentials: boolean;
  /** Whether the integration can run right now: credentials AND a partner tag. */
  isConfigured: boolean;
}

function readCredentialVersion(): CredentialVersion {
  const stored = getSetting(SETTING_CREDENTIAL_VERSION);
  const match = CREDENTIAL_VERSIONS.find((entry) => entry.version === stored);
  return (match?.version ?? '3.1') as CredentialVersion;
}

export function getAmazonConfig(): AmazonConfig {
  const partnerTag = getSetting(SETTING_PARTNER_TAG);
  const hasCredentials =
    hasSecret(AMAZON_CLIENT_ID_ENV_VAR) && hasSecret(AMAZON_CLIENT_SECRET_ENV_VAR);

  return {
    partnerTag,
    marketplace: getSetting(SETTING_MARKETPLACE) ?? 'www.amazon.com',
    credentialVersion: readCredentialVersion(),
    hasCredentials,
    // A partner tag is required by the API itself, so credentials alone are
    // not enough to call it. Reported as one answer so the UI never says
    // "configured" about something that would fail.
    isConfigured: hasCredentials && Boolean(partnerTag?.trim()),
  };
}

/** The token host for the configured credential version. */
export function tokenHostFor(version: CredentialVersion): string {
  return CREDENTIAL_VERSIONS.find((entry) => entry.version === version)?.tokenHost ?? 'api.amazon.com';
}

export interface AmazonConfigInput {
  partnerTag?: string | null;
  marketplace?: string;
  credentialVersion?: string;
  /** undefined leaves it untouched, '' clears it, any value sets it — the store's three-way contract. */
  clientId?: string;
  clientSecret?: string;
}

export function updateAmazonConfig(input: AmazonConfigInput): { errors: string[]; config?: AmazonConfig } {
  const errors: string[] = [];

  if (input.credentialVersion !== undefined) {
    if (!CREDENTIAL_VERSIONS.some((entry) => entry.version === input.credentialVersion)) {
      errors.push(
        `credentialVersion must be one of: ${CREDENTIAL_VERSIONS.map((entry) => entry.version).join(', ')}.`,
      );
    }
  }

  if (input.marketplace !== undefined) {
    if (!AMAZON_MARKETPLACES.some((entry) => entry.marketplace === input.marketplace)) {
      errors.push('marketplace must be one of the supported Amazon marketplaces.');
    }
  }

  // Amazon tags are lowercase alphanumeric with hyphens, ending in a numeric
  // suffix. Checked loosely — a wrong-looking tag is refused, but Cynth does
  // not claim to know every valid form.
  if (input.partnerTag !== undefined && input.partnerTag !== null && input.partnerTag.trim()) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,48}$/.test(input.partnerTag.trim())) {
      errors.push('partnerTag looks wrong — it should be your Associates tag, e.g. yoursite-20.');
    }
  }

  if (errors.length) return { errors };

  if (input.partnerTag !== undefined) {
    setSetting(SETTING_PARTNER_TAG, input.partnerTag?.trim() ?? '');
  }
  if (input.marketplace !== undefined) setSetting(SETTING_MARKETPLACE, input.marketplace);
  if (input.credentialVersion !== undefined) setSetting(SETTING_CREDENTIAL_VERSION, input.credentialVersion);

  // The three-way contract, applied to fixed env var names.
  if (input.clientId !== undefined) {
    if (input.clientId === '') deleteSecret(AMAZON_CLIENT_ID_ENV_VAR);
    else setSecret(AMAZON_CLIENT_ID_ENV_VAR, input.clientId);
  }
  if (input.clientSecret !== undefined) {
    if (input.clientSecret === '') deleteSecret(AMAZON_CLIENT_SECRET_ENV_VAR);
    else setSecret(AMAZON_CLIENT_SECRET_ENV_VAR, input.clientSecret);
  }

  return { errors: [], config: getAmazonConfig() };
}

/** The credential values, read from process.env only at the moment of use. Never returned by a route. */
export function readAmazonCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env[AMAZON_CLIENT_ID_ENV_VAR];
  const clientSecret = process.env[AMAZON_CLIENT_SECRET_ENV_VAR];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
