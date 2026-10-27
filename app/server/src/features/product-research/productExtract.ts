/**
 * STRUCTURED METADATA EXTRACTION — not page scraping.
 *
 * This reads only what a page publishes ABOUT ITSELF for machines to read:
 * schema.org `Product` in JSON-LD, OpenGraph tags, and the standard meta
 * description. It never returns page copy, never walks the DOM for prose, and
 * never returns the body text of the retrieved document.
 *
 * That distinction is the point of the feature. A product's name, image,
 * brand and price are facts the retailer publishes in a machine-readable
 * block precisely so that other systems can use them. The marketing copy on
 * the page is not, and Cynth does not take it: what reaches an article is
 * written by the author, informed by these fields.
 *
 * It is also why nothing here is vendor-specific. There is no Amazon parser,
 * no CSS selector for any retailer, and no per-site branch — JSON-LD and
 * OpenGraph are the same everywhere, so a Shopify store, a manufacturer's own
 * site and a marketplace all extract through the same code.
 */

export interface ExtractedProduct {
  title: string | null;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  /** Feature/specification strings the page published, deduplicated. */
  features: string[];
  price: string | null;
  currency: string | null;
  /** e.g. 'InStock'. Recorded, never presented in an article — it goes stale immediately. */
  availability: string | null;
  sku: string | null;
  category: string | null;
  /** Which mechanisms actually produced a value, so a thin result is visibly thin. */
  foundVia: string[];
}

const EMPTY: ExtractedProduct = {
  title: null,
  brand: null,
  description: null,
  imageUrl: null,
  features: [],
  price: null,
  currency: null,
  availability: null,
  sku: null,
  category: null,
  foundVia: [],
};

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    '#39': "'",
raquo: '»',
    laquo: '«',
  };

  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z0-9#]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

/** Collapses whitespace and trims. Returns null for anything empty, so a blank tag never becomes a blank field. */
function clean(value: unknown, maxLength = 2000): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

/** Reads a possibly-nested schema.org value: a string, a {name}/{value} object, or the first of a list. */
function schemaValue(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string' || typeof input === 'number') return clean(input);
  if (Array.isArray(input)) {
    for (const entry of input) {
      const found = schemaValue(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof input === 'object') {
    const record = input as Record<string, unknown>;
    return schemaValue(record.name ?? record.value ?? record.url ?? record['@id'] ?? null);
  }
  return null;
}

/** Every JSON-LD block on the page, parsed. Malformed blocks are skipped rather than failing the extraction. */
function readJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    try {
      // Some sites emit HTML comments or CDATA wrappers inside the block.
      const raw = match[1].replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
      blocks.push(JSON.parse(raw));
    } catch {
      // A page with one broken block usually has other good ones.
    }
  }

  return blocks;
}

/** Flattens @graph containers and arrays so a Product nested anywhere is still found. */
function flattenNodes(input: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || input === null || typeof input !== 'object') return [];
  if (Array.isArray(input)) return input.flatMap((entry) => flattenNodes(entry, depth + 1));

  const node = input as Record<string, unknown>;
  const nested = Array.isArray(node['@graph']) ? flattenNodes(node['@graph'], depth + 1) : [];
  return [node, ...nested];
}

function isProductNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === 'string' && /product|itempage/i.test(t));
}

function readProductJsonLd(html: string, into: ExtractedProduct): void {
  const nodes = readJsonLdBlocks(html).flatMap((block) => flattenNodes(block));
  const product = nodes.find(isProductNode);
  if (!product) return;

  into.foundVia.push('json-ld');
  into.title ??= clean(product.name, 300);
  into.brand ??= schemaValue(product.brand);
  into.description ??= clean(product.description);
  into.sku ??= clean(product.sku ?? product.mpn ?? product.gtin13, 100);
  into.category ??= schemaValue(product.category);

  const image = product.image;
  into.imageUrl ??= typeof image === 'string' ? clean(image, 1000) : schemaValue(image);

  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  if (offers && typeof offers === 'object') {
    const offer = offers as Record<string, unknown>;
    into.price ??= clean(offer.price, 40);
    into.currency ??= clean(offer.priceCurrency, 10);
    into.availability ??= schemaValue(offer.availability);
  }

  // additionalProperty is schema.org's own place for specifications.
  const additional = product.additionalProperty;
  if (Array.isArray(additional)) {
    for (const entry of additional) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const name = clean(record.name, 120);
      const value = clean(record.value, 200);
      if (name && value) into.features.push(`${name}: ${value}`);
      else if (name) into.features.push(name);
    }
  }
}

/** One meta tag's content, matched on either attribute order. */
function readMeta(html: string, attribute: 'property' | 'name', key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+${attribute}=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attribute}=["']${escaped}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) {
      const value = clean(match[1]);
      if (value) return value;
    }
  }
  return null;
}

/**
 * Whether an OpenGraph block is describing the SITE rather than the product.
 *
 * Some large retailers publish a fixed, site-level OpenGraph block on every
 * page: og:title, og:description and og:sitename all read "Acme", and og:image
 * is the company logo. Amazon is the case that exposed this — a product page
 * there yields og:title "Amazon" and a share-icon logo.
 *
 * Accepting that produces a product called "Amazon" illustrated with the
 * Amazon logo, which is worse than extracting nothing because it looks like it
 * worked. So a block that matches the site's own name is treated as absent,
 * and extraction falls through to the document title, which on those same
 * pages is the real product name.
 *
 * Deliberately generic: it compares the tags to each other and to the host,
 * and names no retailer.
 */
function isSiteLevelOpenGraph(html: string, pageUrl: string): boolean {
  const title = readMeta(html, 'property', 'og:title');
  if (!title) return false;

  const siteName =
    readMeta(html, 'property', 'og:site_name') ?? readMeta(html, 'property', 'og:sitename') ?? null;
  const description = readMeta(html, 'property', 'og:description');

  const normalise = (value: string | null) => value?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? null;
  const normalisedTitle = normalise(title);

  // The title is literally the site's name.
  if (normalisedTitle && normalise(siteName) === normalisedTitle) return true;

  // The title and the description are the same short string — a placeholder,
  // not a description of anything.
  if (normalisedTitle && normalise(description) === normalisedTitle && title.length < 40) return true;

  // The title is the bare registrable name from the host, e.g. "Amazon" on
  // amazon.com. A real product title is not its own domain.
  try {
    const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
    const registrable = host.split('.')[0];
    if (normalisedTitle && normalisedTitle === registrable.replace(/[^a-z0-9]/g, '')) return true;
  } catch {
    // A URL we cannot parse tells us nothing either way.
  }

  return false;
}

function readOpenGraph(html: string, into: ExtractedProduct, pageUrl: string): void {
  const before = { ...into };

  // A site-level block is skipped entirely rather than partially trusted: its
  // image and description are placeholders too, not just its title.
  if (isSiteLevelOpenGraph(html, pageUrl)) {
    into.foundVia.push('opengraph-site-level-ignored');
  } else {
    into.title ??= readMeta(html, 'property', 'og:title');
    into.description ??= readMeta(html, 'property', 'og:description');
    into.imageUrl ??= readMeta(html, 'property', 'og:image');
  }
  into.brand ??= readMeta(html, 'property', 'product:brand') ?? readMeta(html, 'property', 'og:brand');
  into.price ??= readMeta(html, 'property', 'product:price:amount');
  into.currency ??= readMeta(html, 'property', 'product:price:currency');
  into.availability ??= readMeta(html, 'property', 'product:availability');

  if (
    before.title !== into.title ||
    before.description !== into.description ||
    before.imageUrl !== into.imageUrl ||
    before.brand !== into.brand
  ) {
    into.foundVia.push('opengraph');
  }
}

/**
 * Last resort: the document title and meta description.
 *
 * Standard head metadata, published for search engines. Still not page copy —
 * this reads two tags, not the body.
 */
/**
 * Strips the site-name suffix retailers append to the document title.
 *
 * "2022 Echo Dot 5th Gen Smart Speaker | Charcoal | Amazon" is a real product
 * title with a trailing brand stamp. Only the last segment is removed, and
 * only when it matches the host, so a title that genuinely contains a pipe
 * keeps its content.
 */
function stripSiteSuffix(title: string, pageUrl: string): string {
  let host: string;
  try {
    host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '').split('.')[0];
  } catch {
    return title;
  }

  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const parts = title.split(/\s+[|–—-]\s+/);
  if (parts.length < 2) return title;

  const last = parts[parts.length - 1];
  if (normalise(last) === normalise(host)) {
    const remainder = parts.slice(0, -1).join(' | ').trim();
    if (remainder) return remainder;
  }
  return title;
}

function readHeadFallback(html: string, into: ExtractedProduct, pageUrl: string): void {
  const before = { ...into };

  if (!into.title) {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const raw = match ? clean(match[1], 300) : null;
    if (raw) into.title = stripSiteSuffix(raw, pageUrl);
  }
  into.description ??= readMeta(html, 'name', 'description');

  if (before.title !== into.title || before.description !== into.description) {
    into.foundVia.push('head-metadata');
  }
}

/** Resolves a protocol-relative or root-relative image URL against the page it came from. */
function absoluteImageUrl(imageUrl: string | null, pageUrl: string): string | null {
  if (!imageUrl) return null;
  try {
    const resolved = new URL(imageUrl, pageUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The vendor a URL belongs to, as data.
 *
 * The registrable-ish name from the host, so amazon.co.uk and amazon.com are
 * both 'amazon' and a Shopify store is its own name. Recorded for display and
 * grouping only — no code branches on the value.
 */
export function vendorFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const parts = host.split('.');
    if (parts.length < 2) return host || null;

    // Handle second-level public suffixes (co.uk, com.au) by stepping back one
    // more label when the second-to-last part is itself a generic.
    const generic = new Set(['co', 'com', 'net', 'org', 'gov', 'ac']);
    const index = generic.has(parts[parts.length - 2]) && parts.length >= 3 ? parts.length - 3 : parts.length - 2;
    return parts[index] ?? host;
  } catch {
    return null;
  }
}

/**
 * Extracts a product's published metadata from a retrieved page.
 *
 * Precedence is deliberate: JSON-LD first because it is the retailer's own
 * structured statement, then OpenGraph, then head metadata. Every field is
 * filled at most once, by the most authoritative source that had it.
 *
 * Returns a mostly-empty result rather than throwing when a page publishes
 * nothing — `foundVia` then says so, and the caller reports that the page
 * carried no product metadata rather than inventing fields.
 */
export function extractProductMetadata(html: string, pageUrl: string): ExtractedProduct {
  const result: ExtractedProduct = { ...EMPTY, features: [], foundVia: [] };

  readProductJsonLd(html, result);
  readOpenGraph(html, result, pageUrl);
  readHeadFallback(html, result, pageUrl);

  result.imageUrl = absoluteImageUrl(result.imageUrl, pageUrl);

  // Deduplicate, drop anything too short to be a specification, and cap the
  // list: a page with 200 attributes is not 200 useful features.
  const seen = new Set<string>();
  result.features = result.features
    .map((feature) => feature.replace(/\s+/g, ' ').trim())
    .filter((feature) => feature.length > 2 && feature.length <= 200)
    .filter((feature) => {
      const key = feature.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  return result;
}

/**
 * Titles that mean "this is not a product page".
 *
 * A title exists on an error page too, so requiring one is not enough — that
 * is how a 404 once became a product called "Page Not Found". Matched on the
 * whole title, not a substring, so a genuine product called "Error Code Reader"
 * is unaffected.
 */
const NON_PRODUCT_TITLES = [
  /^page not found$/i,
  /^not found$/i,
  /^404\b/i,
  /^error$/i,
  /^access denied$/i,
  /^robot check$/i,
  /^are you a (human|robot)\??$/i,
  /^sorry[!.,]?\s*(something went wrong)?$/i,
  /^service unavailable$/i,
];

/** Phrases a bot-wall or interstitial uses about itself. Reported, never worked around. */
const BOT_WALL_MARKERS = [
  /to discuss automated access/i,
  /enter the characters you see below/i,
  /type the characters you see in this image/i,
  /verify you are a human/i,
  /unusual traffic from your computer/i,
];

/** True when a retrieved page is an error, a bot-wall or an interstitial rather than a product. */
export function looksLikeNonProductPage(extracted: ExtractedProduct, html: string): string | null {
  const title = extracted.title?.trim() ?? '';
  if (title && NON_PRODUCT_TITLES.some((pattern) => pattern.test(title))) {
    return `the page is titled "${title}"`;
  }
  // Checked against a bounded slice: a bot-wall says so early, and scanning a
  // 900KB product page for these phrases would invite false positives.
  const head = html.slice(0, 20_000);
  if (BOT_WALL_MARKERS.some((pattern) => pattern.test(head))) {
    return 'the page is an automated-access check rather than a product page';
  }
  return null;
}

/**
 * True when the extraction found enough to be worth storing.
 *
 * A title alone is not enough. It must also be accompanied by SOMETHING else
 * the page published about the product — a description, an image, a brand, a
 * feature or an identifier. A page that yields only a title has told us its
 * name and nothing more, which is not research.
 */
export function hasUsableMetadata(extracted: ExtractedProduct): boolean {
  if (!extracted.title?.trim()) return false;
  return Boolean(
    extracted.description ||
      extracted.imageUrl ||
      extracted.brand ||
      extracted.sku ||
      extracted.features.length ||
      extracted.price,
  );
}
