/**
 * Recognising an Amazon product URL, and getting the ASIN out of it.
 *
 * This is the only part of Cynth that knows what an Amazon URL looks like, and
 * it deliberately knows nothing else about Amazon. It answers two questions —
 * "is this Amazon?" and "which item?" — and everything downstream is generic.
 *
 * The marketplace list is data, and it is the same list the Creators API's own
 * `x-marketplace` header takes. Adding a marketplace is one row here.
 */

/**
 * Amazon marketplaces, keyed by the host Cynth will see in a URL.
 *
 * `marketplace` is the value the Creators API expects; `region` selects the
 * OAuth token endpoint, which differs by region rather than by marketplace.
 * Taken from the Creators API regional-endpoints table.
 */
export interface AmazonMarketplace {
  host: string;
  /** The `x-marketplace` / `marketplace` value the API expects. */
  marketplace: string;
  region: 'NA' | 'EU' | 'FE';
  countryCode: string;
}

export const AMAZON_MARKETPLACES: readonly AmazonMarketplace[] = [
  // North America
  { host: 'amazon.com', marketplace: 'www.amazon.com', region: 'NA', countryCode: 'US' },
  { host: 'amazon.ca', marketplace: 'www.amazon.ca', region: 'NA', countryCode: 'CA' },
  { host: 'amazon.com.mx', marketplace: 'www.amazon.com.mx', region: 'NA', countryCode: 'MX' },
  { host: 'amazon.com.br', marketplace: 'www.amazon.com.br', region: 'NA', countryCode: 'BR' },
  // Europe
  { host: 'amazon.co.uk', marketplace: 'www.amazon.co.uk', region: 'EU', countryCode: 'UK' },
  { host: 'amazon.de', marketplace: 'www.amazon.de', region: 'EU', countryCode: 'DE' },
  { host: 'amazon.fr', marketplace: 'www.amazon.fr', region: 'EU', countryCode: 'FR' },
  { host: 'amazon.it', marketplace: 'www.amazon.it', region: 'EU', countryCode: 'IT' },
  { host: 'amazon.es', marketplace: 'www.amazon.es', region: 'EU', countryCode: 'ES' },
  { host: 'amazon.nl', marketplace: 'www.amazon.nl', region: 'EU', countryCode: 'NL' },
  { host: 'amazon.com.be', marketplace: 'www.amazon.com.be', region: 'EU', countryCode: 'BE' },
  { host: 'amazon.eg', marketplace: 'www.amazon.eg', region: 'EU', countryCode: 'EG' },
  { host: 'amazon.in', marketplace: 'www.amazon.in', region: 'EU', countryCode: 'IN' },
  { host: 'amazon.ie', marketplace: 'www.amazon.ie', region: 'EU', countryCode: 'IE' },
  { host: 'amazon.pl', marketplace: 'www.amazon.pl', region: 'EU', countryCode: 'PL' },
  { host: 'amazon.sa', marketplace: 'www.amazon.sa', region: 'EU', countryCode: 'SA' },
  { host: 'amazon.se', marketplace: 'www.amazon.se', region: 'EU', countryCode: 'SE' },
  { host: 'amazon.com.tr', marketplace: 'www.amazon.com.tr', region: 'EU', countryCode: 'TR' },
  { host: 'amazon.ae', marketplace: 'www.amazon.ae', region: 'EU', countryCode: 'AE' },
  // Far East
  { host: 'amazon.co.jp', marketplace: 'www.amazon.co.jp', region: 'FE', countryCode: 'JP' },
  { host: 'amazon.sg', marketplace: 'www.amazon.sg', region: 'FE', countryCode: 'SG' },
  { host: 'amazon.com.au', marketplace: 'www.amazon.com.au', region: 'FE', countryCode: 'AU' },
];

/**
 * Amazon's own link shorteners.
 *
 * These carry no ASIN in the URL, so an affiliate short link has to be
 * resolved before the API can be asked about it. Listed separately from the
 * marketplaces because they are not marketplaces: nothing reads product data
 * from them.
 */
export const AMAZON_SHORTENER_HOSTS: readonly string[] = ['amzn.to', 'amzn.eu', 'a.co', 'amzn.asia'];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The marketplace a URL belongs to, or null when the URL is not an Amazon storefront. */
export function marketplaceForUrl(url: string): AmazonMarketplace | null {
  const host = hostOf(url);
  if (!host) return null;
  return (
    AMAZON_MARKETPLACES.find((entry) => host === entry.host || host.endsWith(`.${entry.host}`)) ?? null
  );
}

export function isAmazonShortener(url: string): boolean {
  const host = hostOf(url);
  return host !== null && AMAZON_SHORTENER_HOSTS.includes(host);
}

/** Whether a URL is Amazon at all — a storefront or one of Amazon's shorteners. */
export function isAmazonUrl(url: string): boolean {
  return marketplaceForUrl(url) !== null || isAmazonShortener(url);
}

/**
 * An ASIN is 10 characters: either an ISBN-10 (all digits, or 9 digits and a
 * trailing X) or a B-prefixed alphanumeric code. Matching loosely would let a
 * path segment like "Ergonomic-" through, so the shape is checked.
 */
const ASIN_PATTERN = /^(?:B[0-9A-Z]{9}|[0-9]{9}[0-9X])$/;

/**
 * The paths Amazon uses to identify an item.
 *
 * Ordered by how specific they are. `/dp/` and `/gp/product/` are the canonical
 * product paths; the rest appear in real affiliate links often enough to be
 * worth reading.
 */
const ASIN_PATH_PATTERNS: RegExp[] = [
  /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/gp\/offer-listing\/([A-Z0-9]{10})(?:[/?]|$)/i,
];

/**
 * Extracts the ASIN from an Amazon URL, or null when the URL does not name one.
 *
 * Null is a real answer: a storefront search page, a category page or a short
 * link all legitimately carry no ASIN, and the caller handles that rather than
 * this function guessing one.
 */
export function asinFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  for (const pattern of ASIN_PATH_PATTERNS) {
    const match = pattern.exec(pathAndQuery);
    if (match) {
      const candidate = match[1].toUpperCase();
      if (ASIN_PATTERN.test(candidate)) return candidate;
    }
  }

  // Some link formats carry it as a query parameter instead of a path segment.
  for (const key of ['asin', 'ASIN', 'creativeASIN', 'creative_asin']) {
    const value = parsed.searchParams.get(key);
    if (value && ASIN_PATTERN.test(value.toUpperCase())) return value.toUpperCase();
  }

  return null;
}

/** Whether a string is a well-formed ASIN, for a value the user typed by hand. */
export function isValidAsin(value: string): boolean {
  return ASIN_PATTERN.test(value.trim().toUpperCase());
}
