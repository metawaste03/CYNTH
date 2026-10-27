import { createProduct, getProductById } from '../products/products.repository.js';
import type { ProductDetailDto } from '../products/products.repository.js';
import { getRetriever } from '../web-intelligence/retrievers/index.js';
import { getWebSourceByDomain, normaliseDomain, recordRetrieval } from '../web-intelligence/webSources.repository.js';
import { extractProductMetadata, hasUsableMetadata, looksLikeNonProductPage, vendorFromUrl } from './productExtract.js';
import type { ExtractedProduct } from './productExtract.js';
import { applyResearchFields, fillEmptyProductFields, recordResearch, setResearchStatus } from './productResearch.repository.js';
import { storeRemoteProductImage } from './productImage.service.js';
import { isAmazonUrl } from './amazon/amazonUrl.js';
import { AmazonResolutionError, resolveAmazonItem, retrieveAmazonProduct } from './amazon/amazonRetrieval.service.js';
import { getAmazonConfig } from './amazon/amazonConfig.js';
import { CreatorsApiError } from './amazon/creatorsApi.client.js';

/**
 * URL IN, PRODUCT OUT — the retrieval half of product research.
 *
 * The affiliate link the user supplied is the one thing this file treats as
 * sacred. It is stored once, on creation, exactly as given. Nothing here
 * normalises it, strips its parameters, canonicalises it, or derives a
 * replacement from the page that was read. The page's own URL is stored
 * separately as `source_url` precisely so the two can never be confused.
 *
 * Everything else is subordinate to the authorisation model that already
 * existed: this asks the retriever registry for a retriever, asks it for
 * permission, and does nothing at all if either answer is no.
 */

export class ProductRetrievalError extends Error {
  code: string;
  /** What the user can actually do about it. Every refusal here has a next step. */
  remedy: string | null;

  constructor(code: string, message: string, remedy: string | null = null) {
    super(message);
    this.code = code;
    this.remedy = remedy;
  }
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

/** Accepts only an absolute http(s) URL. A link that is about to be published must be a link. */
export function parseProductUrl(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ProductRetrievalError('invalid_url', `${label} is required.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ProductRetrievalError('invalid_url', `${label} must be a full URL, including https://.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProductRetrievalError('invalid_url', `${label} must be an http or https URL.`);
  }
  return raw.trim();
}

export interface RetrievalPreflight {
  url: string;
  host: string;
  /** Whether a retriever exists at all. */
  canRetrieve: boolean;
  /** Whether the host is on the authorised source list. */
  sourceConfigured: boolean;
  sourceId: number | null;
  sourceName: string | null;
  permitted: boolean;
  reason: string;
  remedy: string | null;
  /** Which subsystem would handle this URL: the generic web retriever, or Amazon's official API. */
  source: 'web' | 'amazon_creators_api';
}

/**
 * Whether Cynth may read this URL — answered without making any request to
 * the page itself. (It may read robots.txt, which is the file published to be
 * read for exactly this question.)
 *
 * Exposed as its own step so the UI can tell the user what is missing BEFORE
 * they paste three URLs and get three refusals.
 */
export async function preflightUrl(url: string): Promise<RetrievalPreflight> {
  const host = hostOf(url);
  const retriever = getRetriever('http');

  const base: RetrievalPreflight = {
    url,
    host,
    canRetrieve: retriever !== null,
    sourceConfigured: false,
    sourceId: null,
    sourceName: null,
    permitted: false,
    reason: '',
    remedy: null,
    source: 'web',
  };

  /**
   * Amazon answers about the API, not about the Web Source list.
   *
   * Reporting "amazon.com is not on the authorised source list" for an Amazon
   * URL would send the user to configure the wrong thing — Cynth will not read
   * Amazon pages even if that source is authorised.
   */
  if (isAmazonUrl(url)) {
    const config = getAmazonConfig();
    const amazonBase = { ...base, source: 'amazon_creators_api' as const, canRetrieve: true };

    if (!config.isConfigured) {
      return {
        ...amazonBase,
        reason: config.hasCredentials
          ? 'The Amazon Creators API has credentials but no Associates partner tag.'
          : 'The Amazon Creators API is not configured.',
        remedy:
          'Set it up under Settings → Amazon Creators API. Cynth uses Amazon\'s official product API and will not read Amazon product pages instead.',
      };
    }

    // Resolves the ASIN — and a short link, if that is what was pasted — so a
    // link that names no product is caught before any API call is made.
    try {
      const resolution = await resolveAmazonItem(url);
      return {
        ...amazonBase,
        sourceConfigured: true,
        permitted: true,
        reason: `Amazon item ${resolution.asin} in ${resolution.marketplace}, via the Creators API.`,
      };
    } catch (error) {
      const resolutionError = error instanceof AmazonResolutionError ? error : null;
      return {
        ...amazonBase,
        sourceConfigured: true,
        reason: resolutionError?.message ?? 'Cynth could not identify an Amazon product from that URL.',
        remedy: resolutionError?.remedy ?? 'Use the product page URL containing /dp/ and the ASIN.',
      };
    }
  }

  if (!retriever) {
    return { ...base, reason: 'Cynth has no web retriever registered.', remedy: null };
  }

  const source = getWebSourceByDomain(normaliseDomain(host));
  if (!source) {
    return {
      ...base,
      reason: `${host} is not on the authorised source list.`,
      remedy: `Add ${host} under Web Sources and turn on "crawl permitted" if you want Cynth to read pages there. Until then you can enter this product's details by hand.`,
    };
  }

  const permission = await retriever.isPermitted(source, url);
  return {
    ...base,
    sourceConfigured: true,
    sourceId: source.id,
    sourceName: source.name,
    permitted: permission.permitted,
    reason: permission.reason,
    remedy: permission.permitted
      ? null
      : 'Enter this product\'s details by hand instead — the affiliate link and a short description are enough for Cynth to place it.',
  };
}

export interface RetrieveProductInput {
  /** The page to read for research. */
  url: string;
  /** The user's link, stored verbatim. Defaults to the page URL when they are the same. */
  affiliateUrl?: string | null;
  /** Attach the research to an existing product instead of creating one. */
  productId?: number | null;
  editorialNote?: string | null;
}

export interface RetrieveProductResult {
  product: ProductDetailDto;
  extracted: ExtractedProduct;
  /** The web_retrievals row proving the fetch. Null on the Amazon path, where nothing was crawled. */
  retrievalId: number | null;
  researchId: number;
  /** True when a product row was created rather than updated. */
  created: boolean;
  warnings: string[];
}

/**
 * The Amazon path: identify the item, ask the Creators API, store the result.
 *
 * Produces exactly the same RetrieveProductResult the web path produces, so
 * nothing downstream — the product record, the research step, placement, the
 * card — knows or cares which source a product came from. The only difference
 * visible in the data is `product_research.extraction_method`, which records
 * `creators_api` so a field's provenance stays answerable.
 */
async function retrieveViaCreatorsApi(
  pageUrl: string,
  affiliateUrl: string,
  input: RetrieveProductInput,
): Promise<RetrieveProductResult> {
  let amazon: Awaited<ReturnType<typeof retrieveAmazonProduct>>;
  try {
    amazon = await retrieveAmazonProduct(pageUrl);
  } catch (error) {
    if (input.productId) setResearchStatus(input.productId, 'failed');

    // Both Amazon error types already carry a code and a remedy; they are
    // translated rather than flattened, so the UI keeps the actionable part.
    if (error instanceof AmazonResolutionError || error instanceof CreatorsApiError) {
      throw new ProductRetrievalError(error.code, error.message, error.remedy);
    }
    throw new ProductRetrievalError(
      'amazon_lookup_failed',
      `The Amazon lookup failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
      'Enter this product by hand instead.',
    );
  }

  const extracted = amazon.product;
  const warnings = [...amazon.warnings];
  if (!extracted.imageUrl) warnings.push('The Creators API returned no image for this item.');
  if (!extracted.features.length) warnings.push('The Creators API returned no features for this item.');

  let product: ProductDetailDto;
  let created = false;

  if (input.productId) {
    const existing = getProductById(input.productId);
    if (!existing) throw new ProductRetrievalError('product_not_found', 'Product not found.');
    fillEmptyProductFields(existing.id, {
      title: extracted.title,
      brand: extracted.brand,
      description: extracted.description,
      category: extracted.category,
    });
    product = getProductById(existing.id)!;
  } else {
    product = createProduct({
      title: extracted.title!,
      brand: extracted.brand ?? undefined,
      category: extracted.category ?? undefined,
      description: extracted.description ?? undefined,
      // THE USER'S LINK, VERBATIM. The Creators API supplies product data and
      // never a URL; nothing Amazon returned is used as a link.
      affiliateLink: affiliateUrl,
      notes: input.editorialNote ?? undefined,
    });
    created = true;
  }

  applyResearchFields(product.id, {
    // The Amazon page the ASIN was read from — recorded for provenance, never
    // published. The affiliate link above remains the only link.
    sourceUrl: amazon.resolvedFrom,
    vendor: 'amazon',
    sourceImageUrl: extracted.imageUrl,
    keyFeatures: extracted.features,
    researchStatus: 'retrieved',
  });

  if (extracted.imageUrl && !product.images.length) {
    const stored = await storeRemoteProductImage(product.id, extracted.imageUrl);
    if (stored.error) warnings.push(`The product image could not be stored locally: ${stored.error}`);
  }

  const research = recordResearch({
    productId: product.id,
    // No web_retrievals row: nothing was crawled. The provenance here is the
    // API call, and recording a retrieval that never happened would be false.
    retrievalId: null,
    sourceUrl: amazon.resolvedFrom,
    extractionMethod: 'creators_api',
    extracted,
    keyFeatures: extracted.features,
    notes: `Amazon Creators API, ASIN ${amazon.asin}, marketplace ${amazon.marketplace}.`,
  });

  return {
    product: getProductById(product.id)!,
    extracted,
    retrievalId: null,
    researchId: research.id,
    created,
    warnings,
  };
}

/**
 * Reads one product page and turns its published metadata into a product.
 *
 * The sequence is fixed and every step can refuse:
 *   permission -> fetch -> record the retrieval -> extract metadata ->
 *   create or update the product -> record the research pass.
 *
 * No model is called here. This step is free, deterministic, and produces
 * facts the page published about itself. Interpreting them is a separate,
 * optional, paid step in productUnderstanding.service.ts.
 */
export async function retrieveProduct(input: RetrieveProductInput): Promise<RetrieveProductResult> {
  const pageUrl = parseProductUrl(input.url, 'The product URL');
  // The link the user will publish. Kept exactly as supplied.
  const affiliateUrl = input.affiliateUrl?.trim()
    ? parseProductUrl(input.affiliateUrl, 'The affiliate URL')
    : pageUrl;

  /**
   * THE SOURCE ROUTER (Milestone 19).
   *
   *   Amazon URLs      -> the Creators API, Amazon's official product-data
   *                       service.
   *   Everything else  -> the generic Web Source retriever.
   *
   * Amazon is a specialised integration rather than a special case of the
   * generic one, because Amazon publishes an API for exactly this and its
   * product pages publish nothing usable. Crucially there is NO fallback
   * between the two: an Amazon URL whose API lookup fails is reported as
   * failed, never quietly read as a page.
   */
  if (isAmazonUrl(pageUrl)) {
    return retrieveViaCreatorsApi(pageUrl, affiliateUrl, input);
  }

  const retriever = getRetriever('http');
  if (!retriever) {
    throw new ProductRetrievalError('no_retriever', 'Cynth has no web retriever registered.');
  }

  const source = getWebSourceByDomain(normaliseDomain(hostOf(pageUrl)));
  if (!source) {
    throw new ProductRetrievalError(
      'source_not_authorised',
      `${hostOf(pageUrl)} is not on the authorised source list, so Cynth will not read it.`,
      `Add ${hostOf(pageUrl)} under Web Sources with crawl permission, or enter this product by hand.`,
    );
  }

  const permission = await retriever.isPermitted(source, pageUrl);
  if (!permission.permitted) {
    throw new ProductRetrievalError('retrieval_not_permitted', permission.reason, 'Enter this product by hand instead.');
  }

  let fetched: Awaited<ReturnType<typeof retriever.fetch>>;
  try {
    fetched = await retriever.fetch(source, pageUrl);
  } catch (error) {
    throw new ProductRetrievalError(
      'retrieval_failed',
      `Could not read ${pageUrl}: ${error instanceof Error ? error.message : 'the request failed'}.`,
      'Enter this product by hand instead.',
    );
  }

  // Provenance first, so a fetch that happened is recorded even when the
  // checks below reject what it returned.
  const retrieval = recordRetrieval({ ...fetched.retrieval, webSourceId: source.id });
  // The URL actually read, after any redirects. Everything below describes
  // that page, not the one originally asked for.
  const readUrl = fetched.retrieval.url;

  /**
   * A non-2xx response is not a product page.
   *
   * This used to be a warning, and the result was a product called "Page Not
   * Found" created from a 404. An error response is a refusal.
   */
  const status = fetched.retrieval.httpStatus;
  if (status !== null && (status < 200 || status >= 300)) {
    if (input.productId) setResearchStatus(input.productId, 'failed');
    throw new ProductRetrievalError(
      'retrieval_failed',
      `${readUrl} answered HTTP ${status}, so there is no product page to read.`,
      status === 404
        ? 'Check the URL — the product may have been removed, or the link may be region-specific.'
        : 'Try again later, or enter this product by hand.',
    );
  }

  const warnings: string[] = [];
  const extracted = extractProductMetadata(fetched.content, readUrl);

  const nonProduct = looksLikeNonProductPage(extracted, fetched.content);
  if (nonProduct) {
    if (input.productId) setResearchStatus(input.productId, 'failed');
    throw new ProductRetrievalError(
      'not_a_product_page',
      `${readUrl} answered, but ${nonProduct}.`,
      'Check the URL, or enter this product by hand.',
    );
  }

  if (!hasUsableMetadata(extracted)) {
    if (input.productId) setResearchStatus(input.productId, 'failed');
    // Says which mechanisms were tried and what each found, because "it did
    // not work" is not actionable and the reason differs by retailer.
    const attempted = extracted.foundVia.length ? extracted.foundVia.join(', ') : 'none';
    const ignoredSiteLevel = extracted.foundVia.includes('opengraph-site-level-ignored');
    throw new ProductRetrievalError(
      'no_product_metadata',
      `${readUrl} was read, but it publishes no usable product metadata (mechanisms found: ${attempted}).` +
        (ignoredSiteLevel
          ? ' Its OpenGraph tags describe the site rather than the product, so Cynth ignored them rather than creating a product named after the retailer.'
          : ''),
      'Enter the product title and description by hand — your affiliate link is already usable on its own.',
    );
  }

  if (!extracted.imageUrl) warnings.push('The page published no product image.');
  if (!extracted.features.length) warnings.push('The page published no structured feature list.');

  // Create or update. An existing product keeps everything the user typed.
  let product: ProductDetailDto;
  let created = false;

  if (input.productId) {
    const existing = getProductById(input.productId);
    if (!existing) throw new ProductRetrievalError('product_not_found', 'Product not found.');
    fillEmptyProductFields(existing.id, {
      title: extracted.title,
      brand: extracted.brand,
      description: extracted.description,
      category: extracted.category,
    });
    product = getProductById(existing.id)!;
  } else {
    product = createProduct({
      title: extracted.title!,
      brand: extracted.brand ?? undefined,
      category: extracted.category ?? undefined,
      description: extracted.description ?? undefined,
      // THE USER'S LINK, VERBATIM. Written once, here, and never rewritten.
      affiliateLink: affiliateUrl,
      notes: input.editorialNote ?? undefined,
    });
    created = true;
  }

  applyResearchFields(product.id, {
    sourceUrl: readUrl,
    vendor: vendorFromUrl(readUrl),
    sourceImageUrl: extracted.imageUrl,
    keyFeatures: extracted.features,
    // 'retrieved', not 'researched': the page's facts are in, but nothing has
    // yet worked out what the product is FOR.
    researchStatus: 'retrieved',
  });

  // A durable local copy of the product image, so a published article does not
  // depend on a retailer's CDN keeping that asset at that URL. Best-effort:
  // failing to store the image must not fail the retrieval, since the rest of
  // the research is still good.
  if (extracted.imageUrl && !product.images.length) {
    const stored = await storeRemoteProductImage(product.id, extracted.imageUrl);
    if (stored.error) warnings.push(`The product image could not be stored locally: ${stored.error}`);
  }

  const research = recordResearch({
    productId: product.id,
    retrievalId: retrieval.id,
    sourceUrl: readUrl,
    extractionMethod: 'structured_metadata',
    extracted,
    keyFeatures: extracted.features,
    notes: permission.reason,
  });

  return {
    product: getProductById(product.id)!,
    extracted,
    retrievalId: retrieval.id,
    researchId: research.id,
    created,
    warnings,
  };
}
