import type { ArticleProductContext } from '../generation/generationContext.service.js';

/**
 * The product card (Milestone 17; re-cut as a shortcode, 2026-09-08).
 *
 * Assembled entirely from stored records. Nothing a model wrote reaches this
 * function: the author decided WHERE a card goes by writing a marker, and
 * everything the card carries — image, title, brand, and above all the link —
 * comes from the product row.
 *
 * THE AFFILIATE URL IS EMITTED VERBATIM. It is the string the user supplied,
 * escaped for the destination's syntax and otherwise untouched: no parameters
 * added, none removed, no canonicalisation, no tag of Cynth's own. A product
 * with no affiliate link renders as a card without a link rather than a card
 * pointing somewhere else.
 *
 * WHY A SHORTCODE RATHER THAN HTML. This used to emit the card's markup
 * directly, which meant the class contract existed twice — here, and again in
 * the site's own Elementor template — with nothing keeping the two in step.
 * Emitting `[efd_product]` moves the markup to a single renderer on the site,
 * puts `wp_kses` between generated content and the published page, and lets an
 * editor add a badge by typing an attribute instead of hand-editing markup in
 * a Custom HTML block. It is also what the Milestone 13 report recommended:
 * the shortcode is the schema boundary.
 *
 * Cynth still does not know what an EveryFiveDays card looks like. It supplies
 * fields; the site decides the design.
 *
 * WHAT THIS DELIBERATELY DOES NOT SEND. `keyFeatures` is not on the card. Those
 * bullets exist so the writer can use them in the prose, which is where a
 * reader actually needs them — a card repeating four specifications is a spec
 * sheet, not a recommendation.
 */

/**
 * Makes a value safe to sit inside a double-quoted shortcode attribute.
 *
 * WordPress's shortcode parser is a regular expression, not a parser: a `"`
 * ends the attribute, and a `[` or `]` ends the shortcode. Any of the three
 * inside a value silently produces mangled output rather than an error, so
 * they are removed rather than escaped. Newlines go too — an attribute value
 * spanning lines does not survive the parse.
 */
function attr(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\[\]"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Makes a value safe to sit as a shortcode's enclosed content.
 *
 * Only the brackets matter here — quotes and apostrophes are fine in enclosed
 * content, which is exactly why the summary is passed that way: real prose
 * keeps its punctuation.
 */
function enclosed(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Only http(s) URLs are passed on.
 *
 * The same rule articleMarkup.ts applies to links in prose: a stored value
 * that is not a web URL is dropped rather than emitted, so nothing can put a
 * `javascript:` target into a published post. The site's renderer checks this
 * again — neither side trusts the other, because they ship separately.
 */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The retailer slug the site uses to label the button.
 *
 * Normalised to a bare lowercase token because `products.vendor` is derived
 * from a URL host and may arrive as `amazon`, `Amazon`, or `www.amazon.com`.
 * An unrecognised value is still passed through: the site keeps its own vendor
 * map, and a vendor Cynth has never heard of should reach it rather than be
 * silently dropped here.
 */
function vendorSlug(vendor: string | null): string {
  if (!vendor) return '';
  const bare = vendor
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\..*$/, '')
    .replace(/[^a-z0-9_-]/g, '');
  return bare;
}

export function renderProductCard(product: ArticleProductContext): string {
  const href = safeUrl(product.affiliateUrl);
  const image = safeUrl(product.imageUrl);

  // What the product is FOR, which is the one line a reader actually needs at
  // the point the author reached for it.
  const blurb = product.useCase ?? product.description;

  const parts: string[] = [`id="${product.productId}"`];

  const title = attr(product.title);
  if (title) parts.push(`title="${title}"`);

  const brand = attr(product.brand);
  if (brand) parts.push(`brand="${brand}"`);

  const vendor = vendorSlug(product.vendor);
  if (vendor) parts.push(`vendor="${vendor}"`);

  if (image) parts.push(`image="${attr(image)}"`);
  if (href) parts.push(`url="${attr(href)}"`);

  const summary = enclosed(blurb);

  // No `badge` attribute. "Author's pick" is an editorial judgement about a
  // placement, not a fact about a product, and Cynth holds no such field —
  // inventing one here would be Cynth deciding what the editors rate.
  return `[efd_product ${parts.join(' ')}]${summary}[/efd_product]`;
}
