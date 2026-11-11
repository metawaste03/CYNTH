import { getAmazonConfig } from './amazonConfig.js';
import { asinFromUrl, isAmazonShortener, marketplaceForUrl } from './amazonUrl.js';
import { CreatorsApiError, getItems } from './creatorsApi.client.js';
import { hasUsableAmazonData, mapAmazonItem } from './amazonProduct.mapper.js';
import type { MappedAmazonProduct } from './amazonProduct.mapper.js';

/**
 * The Amazon product path: affiliate URL in, structured product data out,
 * entirely through the Creators API.
 *
 * There is no scraper here and no fallback to one. If the API is not
 * configured, or the call fails, this reports that — Cynth does not read an
 * Amazon product page instead, because Amazon publishes an API for this and
 * because a silent downgrade to scraping is exactly the behaviour that would
 * make the API integration pointless.
 *
 * The affiliate URL is READ here and never written. This module extracts an
 * ASIN from it and passes only that ASIN to Amazon. The URL itself does not
 * leave the caller.
 */

const SHORTENER_TIMEOUT_MS = 15_000;

export class AmazonResolutionError extends Error {
  code: string;
  remedy: string | null;

  constructor(code: string, message: string, remedy: string | null = null) {
    super(message);
    this.code = code;
    this.remedy = remedy;
  }
}

/**
 * Resolves an Amazon short link far enough to read the ASIN out of it.
 *
 * `amzn.to` links carry no ASIN, and they are what an Associates dashboard
 * actually hands you — so without this the common case cannot be looked up at
 * all. This follows the redirect and reads the destination URL. It does NOT
 * read the destination page: the response body is discarded, and the only
 * thing taken from the request is the final URL.
 *
 * That distinction matters. This is identifier resolution, not content
 * retrieval, which is why it does not go through the Web Source system — there
 * is no page data involved.
 */
async function resolveShortLink(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': 'CynthBot/1.0 (+editorial research)', accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(SHORTENER_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AmazonResolutionError(
      'shortlink_unresolved',
      `Could not resolve the Amazon short link: ${error instanceof Error ? error.message : 'request failed'}.`,
      'Paste the full Amazon product URL instead — the one containing /dp/ and the ASIN.',
    );
  }

  // Only the final URL is used. The body is never read.
  const finalUrl = response.url || url;
  if (!marketplaceForUrl(finalUrl)) {
    throw new AmazonResolutionError(
      'shortlink_unresolved',
      `The short link resolved to ${finalUrl}, which is not an Amazon product URL.`,
      'Paste the full Amazon product URL instead.',
    );
  }
  return finalUrl;
}

export interface AmazonResolution {
  asin: string;
  marketplace: string;
  /** The URL the ASIN was read from, after any short-link resolution. Never published. */
  resolvedFrom: string;
}

/**
 * Works out which Amazon item a URL refers to.
 *
 * Deliberately separate from fetching it, so the UI can tell the user "that
 * link does not name a product" without any Amazon API call being made.
 */
export async function resolveAmazonItem(url: string): Promise<AmazonResolution> {
  let target = url;

  if (isAmazonShortener(url)) {
    target = await resolveShortLink(url);
  }

  const marketplace = marketplaceForUrl(target);
  if (!marketplace) {
    throw new AmazonResolutionError('not_amazon', `${url} is not an Amazon URL.`);
  }

  const asin = asinFromUrl(target);
  if (!asin) {
    throw new AmazonResolutionError(
      'no_asin',
      `${target} does not name a specific product — Cynth could not find an ASIN in it.`,
      'Use the product page URL, which contains /dp/ followed by the 10-character ASIN.',
    );
  }

  return { asin, marketplace: marketplace.marketplace, resolvedFrom: target };
}

export interface AmazonProductResult {
  asin: string;
  marketplace: string;
  resolvedFrom: string;
  product: MappedAmazonProduct;
  /** Anything Amazon reported that did not stop the lookup. */
  warnings: string[];
}

/**
 * The whole Amazon path for one URL: identify the item, ask the Creators API
 * about it, and map the response into Cynth's shape.
 *
 * Throws rather than degrading. A caller that wanted a page read instead can
 * ask the generic retriever for one — but nothing here decides that on the
 * caller's behalf.
 */
export async function retrieveAmazonProduct(url: string): Promise<AmazonProductResult> {
  const config = getAmazonConfig();
  if (!config.isConfigured) {
    throw new AmazonResolutionError(
      'amazon_not_configured',
      config.hasCredentials
        ? 'The Amazon Creators API has credentials but no Associates partner tag, so Cynth cannot request product data.'
        : 'The Amazon Creators API is not configured, so Cynth cannot look up Amazon products.',
      'Set it up under Settings → Amazon Creators API. Cynth will not read Amazon product pages instead — Amazon publishes an API for this, and its product pages carry no usable product data.',
    );
  }

  const resolution = await resolveAmazonItem(url);

  const result = await getItems([resolution.asin], { marketplace: resolution.marketplace });

  const warnings = result.errors.map((error) => `${error.code}: ${error.message}`);

  const raw = result.items[0];
  if (!raw) {
    throw new CreatorsApiError(
      'amazon_item_not_found',
      `The Amazon Creators API returned no item for ASIN ${resolution.asin} in ${resolution.marketplace}.` +
        (warnings.length ? ` Amazon reported: ${warnings.join('; ')}` : ''),
      'Check that the ASIN exists in the configured marketplace — an ASIN valid on amazon.com may not exist on another storefront.',
    );
  }

  const product = mapAmazonItem(raw);
  if (!hasUsableAmazonData(product)) {
    throw new CreatorsApiError(
      'amazon_item_empty',
      `The Amazon Creators API returned item ${resolution.asin}, but with no usable product fields (found: ${product.foundVia.join(', ')}).`,
      'The item may be unavailable in this marketplace. Enter the product details by hand.',
    );
  }

  return { asin: resolution.asin, marketplace: resolution.marketplace, resolvedFrom: resolution.resolvedFrom, product, warnings };
}
