import type { ExtractedProduct } from '../productExtract.js';
import type { CreatorsApiItem } from './creatorsApi.client.js';

/**
 * Creators API response -> Cynth's ExtractedProduct.
 *
 * Maps onto the SAME shape the generic web extractor produces, which is the
 * point: everything downstream — the product record, the research prompt, the
 * placement rules, the card — already consumes `ExtractedProduct` and does not
 * need to know that this one came from an API rather than a page.
 *
 * Every read is defensive. Amazon returns only the resources that exist for a
 * given item, so any field may legitimately be missing, and a missing field is
 * recorded as absent rather than substituted. `foundVia` names what was
 * actually present, so a thin result is visibly thin.
 *
 * Field names follow the Creators API's lowerCamelCase, with the PA-API
 * PascalCase spelling accepted as an alternative — this is the boundary with a
 * third-party response, so it tolerates both rather than silently returning
 * nothing.
 */

/** Reads a key in either casing. */
function pick(source: unknown, ...keys: string[]): unknown {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
    const capitalised = key.charAt(0).toUpperCase() + key.slice(1);
    if (record[capitalised] !== undefined) return record[capitalised];
  }
  return undefined;
}

/** The `{ displayValue }` wrapper Amazon puts around most scalar values. */
function displayValue(source: unknown): string | null {
  const value = pick(source, 'displayValue');
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  // Some fields are a bare string rather than a wrapper.
  if (typeof source === 'string' && source.trim()) return source.trim();
  return null;
}

function displayValues(source: unknown): string[] {
  const values = pick(source, 'displayValues');
  if (!Array.isArray(values)) return [];
  return values
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Flattens the structured detail blocks into readable "Label: value" strings.
 *
 * `productInfo` and `technicalInfo` are objects of named measurements
 * (itemDimensions, unitCount, and so on), each wrapped in a displayValue and
 * sometimes a unit. They are genuinely useful specifications, so they are
 * turned into the same flat feature strings the web extractor produces from
 * schema.org `additionalProperty`.
 */
function readDetailBlock(block: unknown, into: string[]): void {
  if (!block || typeof block !== 'object') return;

  for (const [key, raw] of Object.entries(block as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;

    const label = key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase())
      .trim();

    const value = displayValue(raw);
    const unit = pick(raw, 'unit');

    if (value) {
      into.push(unit && typeof unit === 'string' ? `${label}: ${value} ${unit}` : `${label}: ${value}`);
      continue;
    }

    // One level of nesting: itemDimensions -> { height, length, width }.
    for (const [childKey, childRaw] of Object.entries(raw as Record<string, unknown>)) {
      const childValue = displayValue(childRaw);
      if (!childValue) continue;
      const childUnit = pick(childRaw, 'unit');
      const childLabel = childKey.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
      into.push(
        childUnit && typeof childUnit === 'string'
          ? `${label} ${childLabel}: ${childValue} ${childUnit}`
          : `${label} ${childLabel}: ${childValue}`,
      );
    }
  }
}

/** The deepest browse node, which is the most specific category Amazon gives. */
function readCategory(item: CreatorsApiItem): string | null {
  const browseNodeInfo = pick(item, 'browseNodeInfo');
  const nodes = pick(browseNodeInfo, 'browseNodes');
  if (!Array.isArray(nodes) || !nodes.length) return null;

  const first = nodes[0];
  const name = pick(first, 'displayName', 'contextFreeName');
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function readImage(item: CreatorsApiItem): string | null {
  const images = pick(item, 'images');
  const primary = pick(images, 'primary');

  // Largest first: the card scales down, and an upscaled thumbnail looks worse
  // than a downscaled original.
  for (const size of ['large', 'medium', 'small']) {
    const url = pick(pick(primary, size), 'url');
    if (typeof url === 'string' && url.startsWith('http')) return url;
  }
  return null;
}

export interface MappedAmazonProduct extends ExtractedProduct {
  asin: string | null;
}

/**
 * Maps one item. Returns a result whose `foundVia` says which resources
 * actually came back, so a caller can tell "Amazon returned little" from
 * "Cynth failed to read it".
 */
export function mapAmazonItem(item: CreatorsApiItem): MappedAmazonProduct {
  const itemInfo = pick(item, 'itemInfo');
  const foundVia: string[] = ['creators-api'];

  const title = displayValue(pick(itemInfo, 'title'));
  if (title) foundVia.push('itemInfo.title');

  const byLineInfo = pick(itemInfo, 'byLineInfo');
  const brand = displayValue(pick(byLineInfo, 'brand')) ?? displayValue(pick(byLineInfo, 'manufacturer'));
  if (brand) foundVia.push('itemInfo.byLineInfo');

  const features = displayValues(pick(itemInfo, 'features'));
  if (features.length) foundVia.push('itemInfo.features');

  const specifications: string[] = [];
  readDetailBlock(pick(itemInfo, 'productInfo'), specifications);
  readDetailBlock(pick(itemInfo, 'technicalInfo'), specifications);
  if (specifications.length) foundVia.push('itemInfo.productInfo/technicalInfo');

  const imageUrl = readImage(item);
  if (imageUrl) foundVia.push('images.primary');

  const category = readCategory(item);
  if (category) foundVia.push('browseNodeInfo');

  const asinRaw = pick(item, 'asin');
  const asin = typeof asinRaw === 'string' ? asinRaw : null;

  // Features first — they are what the product says about itself — then the
  // measured specifications. Deduplicated and capped exactly as the web
  // extractor does, so both sources produce comparable records.
  const seen = new Set<string>();
  const combined = [...features, ...specifications]
    .filter((entry) => entry.length > 2 && entry.length <= 200)
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  return {
    asin,
    title,
    brand,
    // The API has no single description field. Amazon's features ARE the
    // description, so nothing is synthesised here: the description stays null
    // and the research step works from the features instead.
    description: null,
    imageUrl,
    features: combined,
    price: null,
    currency: null,
    availability: null,
    sku: asin,
    category,
    foundVia,
  };
}

/** True when the API returned enough to be worth storing. Mirrors hasUsableMetadata for the web path. */
export function hasUsableAmazonData(mapped: MappedAmazonProduct): boolean {
  if (!mapped.title?.trim()) return false;
  return Boolean(mapped.brand || mapped.imageUrl || mapped.features.length || mapped.category);
}
