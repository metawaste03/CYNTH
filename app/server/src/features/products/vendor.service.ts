/**
 * WHICH SHOP A LINK GOES TO.
 *
 * The bug this exists for: every product card on EveryFiveDays read "Check
 * price" instead of "Shop on Amazon". Nothing was broken in the site, which
 * maps `vendor="amazon"` to the right label and falls back to a neutral one
 * for a shop it cannot name. Cynth simply never sent a vendor — the
 * `products.vendor` column existed, the card renderer read it, and no code
 * anywhere had ever written a value into it. Every row was NULL.
 *
 * DERIVED, NEVER GUESSED. The vendor comes from the host of the affiliate URL
 * the editor supplied, which is the one authoritative fact about where a
 * reader is going. A host that does not identify a retailer returns null, and
 * the card carries no vendor at all — the site then says "Check price", which
 * is the honest answer. Naming a shop we cannot identify would be worse than
 * naming none.
 *
 * THE AFFILIATE URL IS READ, NOT TOUCHED. This module parses; it never
 * rewrites, canonicalises or appends to the URL, which is emitted verbatim.
 */

/**
 * Retailers whose display name cannot be derived from their domain.
 *
 * Deliberately short. It exists for the cases where title-casing the domain
 * gets the name wrong — "Bestbuy" for Best Buy, "Ebay" for eBay — and for
 * official short domains that carry no readable name at all. Everything else
 * is handled by the generic path below, so adding a retailer is usually
 * nothing: a new domain works without an entry here.
 */
const KNOWN_RETAILERS: Record<string, { slug: string; label: string }> = {
  // Amazon's own shortener. A link through it is an Amazon link; that is a
  // fact about the host, not an inference.
  'amzn.to': { slug: 'amazon', label: 'Amazon' },
  'amzn.eu': { slug: 'amazon', label: 'Amazon' },
  'a.co': { slug: 'amazon', label: 'Amazon' },
  amazon: { slug: 'amazon', label: 'Amazon' },
  bestbuy: { slug: 'bestbuy', label: 'Best Buy' },
  ebay: { slug: 'ebay', label: 'eBay' },
  aliexpress: { slug: 'aliexpress', label: 'AliExpress' },
  bhphotovideo: { slug: 'bhphotovideo', label: 'B&H Photo' },
  newegg: { slug: 'newegg', label: 'Newegg' },
  etsy: { slug: 'etsy', label: 'Etsy' },
  walmart: { slug: 'walmart', label: 'Walmart' },
  argos: { slug: 'argos', label: 'Argos' },
  currys: { slug: 'currys', label: 'Currys' },
  johnlewis: { slug: 'johnlewis', label: 'John Lewis' },
  chewy: { slug: 'chewy', label: 'Chewy' },
  petco: { slug: 'petco', label: 'Petco' },
  target: { slug: 'target', label: 'Target' },
};

/**
 * Link shorteners that identify no retailer.
 *
 * A `bit.ly` link may go anywhere, so naming a shop from one would be
 * inventing a fact. These resolve to null rather than to a title-cased
 * nonsense name.
 */
const OPAQUE_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'ow.ly',
  'buff.ly',
  'rb.gy',
  'rebrand.ly',
  'shorturl.at',
  'linktr.ee',
  'geni.us',
  'go.magik.ly',
  'shareasale.com',
  'awin1.com',
  'anrdoezrs.net',
  'dpbolvw.net',
  'tkqlhce.com',
  'jdoqocy.com',
  'kqzyfj.com',
  'linksynergy.com',
  'click.linksynergy.com',
  'rstyle.me',
  'howl.link',
]);

export interface DerivedVendor {
  /** Lowercase token the site's vendor map is keyed by. */
  slug: string;
  /** How the retailer's name is written, for "Shop on ___". */
  label: string;
}

/** Title-cases a bare domain label, for a retailer with no entry above. */
function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The shop an affiliate URL points at, or null when the host does not say.
 *
 * Null is a real answer and the common safe one: a shortener, an unparseable
 * string, an IP address, or a marketplace Cynth cannot name all produce it,
 * and the card is then rendered without a vendor rather than with a wrong one.
 */
export function deriveVendor(url: string | null | undefined): DerivedVendor | null {
  if (!url) return null;

  let host: string;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  if (!host || OPAQUE_HOSTS.has(host)) return null;
  // An IP address names nothing.
  if (/^[\d.]+$/.test(host) || host.includes(':')) return null;

  // Official short domains are matched whole, before any label splitting —
  // "amzn.to" has no registrable name to read.
  const whole = KNOWN_RETAILERS[host];
  if (whole) return { ...whole };

  /**
   * The name label, which is the one before the public suffix.
   *
   * Taken from the end rather than the start so that `smile.amazon.co.uk` and
   * `www.amazon.com` both give "amazon". Two-part suffixes (`co.uk`,
   * `com.au`) are handled by skipping a short second-from-last label, which
   * is imprecise in the abstract and correct for every retail domain in
   * practice.
   */
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;

  let index = labels.length - 2;
  if (index > 0 && labels[index].length <= 3 && labels[labels.length - 1].length <= 3) {
    index -= 1;
  }

  const name = labels[index];
  if (!name || name.length < 2) return null;

  const known = KNOWN_RETAILERS[name];
  if (known) return { ...known };

  // An unrecognised retailer still gets named, because the host is the
  // destination and saying where a reader is going is the point. Only a
  // clean, readable label qualifies — anything with digits or hyphens is
  // likelier to be infrastructure than a shop front.
  if (!/^[a-z]+$/.test(name)) return null;

  return { slug: name, label: titleCase(name) };
}

/** The stored vendor if there is one, otherwise whatever the link says. */
export function resolveVendor(stored: string | null | undefined, url: string | null | undefined): DerivedVendor | null {
  const bare = (stored ?? '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\..*$/, '')
    .replace(/[^a-z0-9_-]/g, '')
    .trim();

  if (bare) {
    const known = KNOWN_RETAILERS[bare];
    return known ? { ...known } : { slug: bare, label: titleCase(bare) };
  }

  return deriveVendor(url);
}
