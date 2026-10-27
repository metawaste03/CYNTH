import { getAmazonConfig, readAmazonCredentials, tokenHostFor } from './amazonConfig.js';
import type { CredentialVersion } from './amazonConfig.js';

/**
 * THE AMAZON CREATORS API CLIENT.
 *
 * The Creators API is Amazon's successor to the Product Advertising API and
 * the sanctioned way to obtain Amazon product data. Cynth uses it instead of
 * reading Amazon product pages, because Amazon publishes no usable product
 * metadata in its HTML (see Milestone 18) and because this is the route Amazon
 * provides for exactly this purpose.
 *
 * Specification this implements, from Amazon's Creators API documentation:
 *
 *   Auth      OAuth 2.0 client_credentials, scope `creatorsapi::default`,
 *             POSTed as JSON to a region-specific token host. Tokens last
 *             3600s and are cached in-process.
 *   Endpoint  POST https://creatorsapi.amazon/catalog/v1/getItems
 *   Headers   Authorization: Bearer <token>, Content-Type: application/json,
 *             x-marketplace: <marketplace>
 *   Body      { itemIds, itemIdType, marketplace, partnerTag, resources }
 *   Casing    Request and response fields are lowerCamelCase (PA-API's
 *             PascalCase names converted).
 *
 * Two things this client never does: it never sees or touches an affiliate
 * URL, and it never falls back to reading a page. A failure here is reported
 * as a failure.
 */

const API_BASE = 'https://creatorsapi.amazon';
const GET_ITEMS_PATH = '/catalog/v1/getItems';
const OAUTH_SCOPE = 'creatorsapi::default';
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * What Cynth asks for.
 *
 * Chosen to match the product record's own fields and nothing more: a title, a
 * brand, features, an image, category, and the structured product/technical
 * detail that makes a placement decision possible. Prices are deliberately NOT
 * requested — Cynth never publishes one (it goes stale immediately), so asking
 * for it would be collecting data with no use.
 */
export const GET_ITEMS_RESOURCES: readonly string[] = [
  'itemInfo.title',
  'itemInfo.byLineInfo',
  'itemInfo.features',
  'itemInfo.productInfo',
  'itemInfo.technicalInfo',
  'itemInfo.classifications',
  'images.primary.large',
  'browseNodeInfo.browseNodes',
];

export class CreatorsApiError extends Error {
  code: string;
  /** What the user can do about it. Every failure here names a next step. */
  remedy: string | null;
  /** HTTP status, when the failure came from a response rather than the transport. */
  status: number | null;

  constructor(code: string, message: string, remedy: string | null = null, status: number | null = null) {
    super(message);
    this.code = code;
    this.remedy = remedy;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ token */

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * One cached token per credential version, in-process.
 *
 * Amazon issues tokens valid for an hour; re-authenticating per request would
 * be a request Cynth does not need to make. Refreshed a minute early so a
 * token cannot expire between the check and the call.
 */
const tokenCache = new Map<CredentialVersion, CachedToken>();
const TOKEN_SAFETY_MARGIN_MS = 60_000;

/** Clears the cache, so rotating credentials takes effect without a restart. */
export function clearTokenCache(): void {
  tokenCache.clear();
}

async function getAccessToken(version: CredentialVersion): Promise<string> {
  const cached = tokenCache.get(version);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const credentials = readAmazonCredentials();
  if (!credentials) {
    throw new CreatorsApiError(
      'amazon_not_configured',
      'No Amazon Creators API credentials are configured.',
      'Add your Creators API credential ID and secret under Settings → Amazon Creators API.',
    );
  }

  const tokenUrl = `https://${tokenHostFor(version)}/auth/o2/token`;

  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        scope: OAUTH_SCOPE,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new CreatorsApiError(
      'amazon_network_error',
      `Could not reach Amazon's token service: ${error instanceof Error ? error.message : 'request failed'}.`,
      'Check your connection and try again.',
    );
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    // Amazon's OAuth errors are actionable, so they are quoted rather than
    // flattened into "authentication failed".
    const description =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof body.error === 'string'
          ? body.error
          : `HTTP ${response.status}`;

    throw new CreatorsApiError(
      'amazon_auth_failed',
      `Amazon refused the Creators API credentials: ${description}`,
      response.status === 401 || response.status === 400
        ? 'Check the credential ID and secret under Settings → Amazon Creators API, and that the credential version matches the region they were issued for.'
        : 'Try again shortly.',
      response.status,
    );
  }

  const accessToken = typeof body.access_token === 'string' ? body.access_token : null;
  if (!accessToken) {
    throw new CreatorsApiError(
      'amazon_auth_failed',
      'Amazon returned a token response Cynth could not read.',
      'Try again; if it persists, re-generate the credentials in Associates Central.',
    );
  }

  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  tokenCache.set(version, {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000 - TOKEN_SAFETY_MARGIN_MS,
  });

  return accessToken;
}

/* ---------------------------------------------------------------- getItems */

/** The raw response, kept as-is so the mapper can decide what it understood. */
export type CreatorsApiItem = Record<string, unknown>;

export interface GetItemsResult {
  items: CreatorsApiItem[];
  /** Per-item errors Amazon reported, e.g. an ASIN that does not exist in this marketplace. */
  errors: { code: string; message: string }[];
}

/**
 * Fetches one or more items by ASIN.
 *
 * Takes a list because the API does, and because an article with twelve
 * products should cost twelve products' worth of one request rather than
 * twelve requests. There is no cap here beyond Amazon's own.
 */
export async function getItems(asins: string[], options: { marketplace?: string } = {}): Promise<GetItemsResult> {
  const config = getAmazonConfig();

  if (!config.hasCredentials) {
    throw new CreatorsApiError(
      'amazon_not_configured',
      'No Amazon Creators API credentials are configured.',
      'Add your Creators API credential ID and secret under Settings → Amazon Creators API.',
    );
  }
  if (!config.partnerTag?.trim()) {
    throw new CreatorsApiError(
      'amazon_not_configured',
      'No Amazon Associates partner tag is configured.',
      'Add your Associates tag (for example yoursite-20) under Settings → Amazon Creators API.',
    );
  }
  if (!asins.length) {
    throw new CreatorsApiError('amazon_no_items', 'No ASINs were supplied.');
  }

  const marketplace = options.marketplace ?? config.marketplace;
  const token = await getAccessToken(config.credentialVersion);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${GET_ITEMS_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-marketplace': marketplace,
      },
      body: JSON.stringify({
        itemIds: asins,
        itemIdType: 'ASIN',
        marketplace,
        partnerTag: config.partnerTag.trim(),
        resources: GET_ITEMS_RESOURCES,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new CreatorsApiError(
      'amazon_network_error',
      `Could not reach the Amazon Creators API: ${error instanceof Error ? error.message : 'request failed'}.`,
      'Check your connection and try again.',
    );
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    // A 401 here means the token was rejected rather than never issued —
    // dropping it forces a fresh one on the next attempt.
    if (response.status === 401) clearTokenCache();

    const reported = readErrors(body);
    const detail = reported.length ? reported.map((e) => `${e.code}: ${e.message}`).join('; ') : `HTTP ${response.status}`;

    // A reason-specific remedy where one exists, because the generic
    // status-based advice can send the user to re-check settings that Amazon
    // has already accepted.
    const reasonRemedy = reported.map((e) => remedyForReason(e.code)).find((advice) => advice !== null) ?? null;

    throw new CreatorsApiError(
      // Eligibility is not an authentication failure — the credentials worked.
      // Giving it its own code keeps "your key is wrong" and "your account is
      // not eligible yet" from being reported as the same problem.
      reported.some((e) => /AssociateNotEligible/i.test(e.code))
        ? 'amazon_not_eligible'
        : response.status === 401 || response.status === 403
          ? 'amazon_auth_failed'
          : 'amazon_request_failed',
      `The Amazon Creators API refused the request — ${detail}`,
      reasonRemedy ?? remedyForStatus(response.status),
      response.status,
    );
  }

  return { items: readItems(body), errors: readErrors(body) };
}

function remedyForStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'Check the credentials and the partner tag under Settings → Amazon Creators API. Creators API access also requires at least 10 qualifying sales in the last 30 days, and Amazon revokes it if that lapses.';
  }
  if (status === 429) return 'Amazon is rate-limiting the request. Wait a moment and try again.';
  if (status >= 500) return 'Amazon reported a server error. Try again shortly.';
  return 'Check the ASIN and the configured marketplace.';
}

/**
 * Reads the item list defensively.
 *
 * The documented shape is `itemsResult.items`, and Amazon's own migration
 * notes say response keys are lowerCamelCase — but this is the one place
 * Cynth touches a third-party response shape, so it accepts the PascalCase
 * spelling too rather than returning nothing if a field is capitalised.
 */
function readItems(body: Record<string, unknown>): CreatorsApiItem[] {
  const container =
    (body.itemsResult as Record<string, unknown> | undefined) ??
    (body.ItemsResult as Record<string, unknown> | undefined);
  const items = container?.items ?? container?.Items;
  return Array.isArray(items) ? (items as CreatorsApiItem[]) : [];
}

/**
 * Reads whatever Amazon said went wrong.
 *
 * TWO shapes, both seen in practice:
 *
 *   - a per-item list, `errors: [{ code, message }]`, for problems with
 *     individual ASINs;
 *   - a single top-level fault, `{ message, reason, type }`, for problems with
 *     the request or the account. This is what a 403 returns, and reading only
 *     the list form meant an eligibility refusal surfaced as a bare
 *     "HTTP 403" with Amazon's actual explanation discarded.
 *
 * The single-fault shape is checked too, so the reason always reaches the user.
 */
function readErrors(body: Record<string, unknown>): { code: string; message: string }[] {
  const raw = body.errors ?? body.Errors;

  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .map((entry) => ({
        code: String(entry.code ?? entry.Code ?? 'unknown'),
        message: String(entry.message ?? entry.Message ?? 'No message supplied.'),
      }));
  }

  // The single top-level fault. `reason` is the machine-readable part
  // (e.g. AssociateNotEligible); `type` is the fallback when it is absent.
  const message = body.message ?? body.Message;
  if (typeof message === 'string' && message.trim()) {
    const reason = body.reason ?? body.type ?? body.__type;
    return [{ code: typeof reason === 'string' ? reason : 'unknown', message: message.trim() }];
  }

  return [];
}

/**
 * Advice for the specific reasons Amazon gives, where a generic HTTP-status
 * remedy would send the user to check something that is already correct.
 *
 * `AssociateNotEligible` is the one that matters most: the credentials are
 * valid and the request is well-formed, so telling the user to re-check them
 * would waste their time. Nothing about Cynth's configuration can fix it.
 */
function remedyForReason(reason: string): string | null {
  if (/AssociateNotEligible/i.test(reason)) {
    return (
      'Your credentials and the request are correct — Amazon is refusing on account eligibility. ' +
      'The Creators API requires at least 10 qualifying sales in the trailing 30 days on this Associates account, ' +
      'and access is withheld until that threshold is met (and revoked if it lapses later). ' +
      'Nothing in Cynth can change this. Check the status in Associates Central, and in the meantime enter Amazon products by hand — ' +
      'the affiliate link, a title and a short description are enough for Cynth to research and place them.'
    );
  }
  if (/InvalidPartnerTag|InvalidAssociate/i.test(reason)) {
    return 'The partner tag was rejected for this marketplace. Check it matches the Associates account and store under Settings → Amazon Creators API.';
  }
  if (/InvalidParameterValue|InvalidResource/i.test(reason)) {
    return 'Amazon rejected a request parameter. This is a Cynth bug rather than a configuration problem — report the reason above.';
  }
  return null;
}

/**
 * A minimal live call, to prove the credentials work.
 *
 * Mirrors the model Test button from Milestone 15: the smallest request that
 * proves auth, the partner tag and the endpoint are all correct, with the
 * response discarded. Costs nothing — the Creators API is not metered per call
 * the way a model is.
 */
export async function testConnection(
  asin = 'B0BLXHWPLP',
): Promise<{ ok: true; itemCount: number; errors: { code: string; message: string }[] }> {
  const result = await getItems([asin]);
  return { ok: true, itemCount: result.items.length, errors: result.errors };
}
