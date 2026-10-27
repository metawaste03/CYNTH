/**
 * WHICH SHOP A LINK GOES TO — the preview's copy of the rule.
 *
 * The preview card said "Check price" on every product, unconditionally,
 * while the published card names the retailer. A preview that behaves
 * differently from the thing it previews is worse than no preview: it teaches
 * the editor the wrong expectation about what readers will see.
 *
 * Deliberately a small duplicate of the server's `vendor.service.ts` rather
 * than a shared package. It answers one question from one string, the two
 * builds do not share a module boundary today, and the cost of them drifting
 * is a label in a preview — never a wrong link, which comes from the URL
 * either way. The server's copy is the one that reaches readers.
 */

const NAMES: Record<string, string> = {
  bestbuy: 'Best Buy',
  ebay: 'eBay',
  aliexpress: 'AliExpress',
  bhphotovideo: 'B&H Photo',
  johnlewis: 'John Lewis',
};

const SHORT_DOMAINS: Record<string, string> = {
  'amzn.to': 'Amazon',
  'amzn.eu': 'Amazon',
  'a.co': 'Amazon',
};

/** Hosts that identify no retailer: a shortener may go anywhere, a network is not a shop. */
const OPAQUE = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'ow.ly',
  'buff.ly',
  'geni.us',
  'shareasale.com',
  'awin1.com',
  'anrdoezrs.net',
  'dpbolvw.net',
  'tkqlhce.com',
  'jdoqocy.com',
  'kqzyfj.com',
  'linksynergy.com',
  'rstyle.me',
]);

/** The shop an affiliate link names, or null when its host says nothing. */
export function vendorNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  let host: string;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  if (!host || OPAQUE.has(host) || /^[\d.]+$/.test(host)) return null;
  if (SHORT_DOMAINS[host]) return SHORT_DOMAINS[host];

  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;

  let index = labels.length - 2;
  if (index > 0 && labels[index].length <= 3 && labels[labels.length - 1].length <= 3) index -= 1;

  const name = labels[index];
  if (!name || !/^[a-z]{2,}$/.test(name)) return null;

  return NAMES[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** What the button should read for a given link. Falls back to the neutral wording. */
export function shopLabel(url: string | null | undefined): string {
  const name = vendorNameFromUrl(url);
  return name ? `Shop on ${name}` : 'Check price';
}
