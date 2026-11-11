/**
 * NAMING THE SHOP A PRODUCT LINK GOES TO.
 *
 * Reported as: every product card on the live site reads "Check price"
 * instead of "Shop on Amazon".
 *
 * Nothing was wrong on the site. Its shortcode maps `vendor="amazon"` to
 * "Shop on Amazon" and falls back to a neutral label for a shop it cannot
 * name — correct behaviour in both directions. Cynth simply never sent a
 * vendor: the `products.vendor` column existed, the card renderer read it,
 * and no code had ever written a value into it. All 22 rows were NULL.
 *
 * These tests pin both halves: the retailer is READ from the affiliate URL,
 * and a URL that identifies no retailer produces nothing rather than a guess.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { deriveVendor, resolveVendor } = await import('../src/features/products/vendor.service.js');
const { renderProductCard } = await import('../src/features/cms/productCard.js');

/* ----------------------------------------------------------- deriving --- */

test('VENDOR: the retailer is read from the affiliate link', () => {
  // The real links in the library, in the shapes they actually arrived in.
  assert.deepEqual(deriveVendor('https://amzn.to/3SBe7Ah'), { slug: 'amazon', label: 'Amazon' });
  assert.deepEqual(deriveVendor('https://www.amazon.com/dp/B0GRJVBPH3?niid=nl_cl_lst_a_1_1'), {
    slug: 'amazon',
    label: 'Amazon',
  });
  assert.deepEqual(deriveVendor('https://amazon.co.uk/dp/B01'), { slug: 'amazon', label: 'Amazon' });
  assert.deepEqual(deriveVendor('https://smile.amazon.com/dp/B01'), { slug: 'amazon', label: 'Amazon' });
});

test('VENDOR: a retailer nobody has listed is still named correctly', () => {
  // The requirement is "later, when I add other companies, it should say the
  // exact platform". That has to work without anybody editing a list first,
  // so the name comes from the domain.
  assert.deepEqual(deriveVendor('https://www.argos.co.uk/product/1234'), { slug: 'argos', label: 'Argos' });
  assert.deepEqual(deriveVendor('https://www.chewy.com/dp/999'), { slug: 'chewy', label: 'Chewy' });
  assert.deepEqual(deriveVendor('https://zooplus.co.uk/shop/x'), { slug: 'zooplus', label: 'Zooplus' });
});

test('VENDOR: the names a domain gets wrong are corrected', () => {
  // "Bestbuy" and "Ebay" are what title-casing a domain produces, and both
  // are wrong on a button a reader reads.
  assert.equal(deriveVendor('https://www.bestbuy.com/site/x')?.label, 'Best Buy');
  assert.equal(deriveVendor('https://www.ebay.co.uk/itm/1')?.label, 'eBay');
  assert.equal(deriveVendor('https://www.aliexpress.com/item/1.html')?.label, 'AliExpress');
});

test('VENDOR: a link that identifies no shop names none', () => {
  // The important half. A wrong shop name on an affiliate button is worse
  // than a neutral one, so everything ambiguous returns null and the site
  // falls back to "Check price" — which is the honest answer.
  assert.equal(deriveVendor('https://bit.ly/3xYz'), null, 'a shortener could go anywhere');
  assert.equal(deriveVendor('https://tinyurl.com/abc'), null);
  assert.equal(deriveVendor('https://www.awin1.com/cread.php?awinmid=1'), null, 'an affiliate network is not a shop');
  assert.equal(deriveVendor('https://192.168.0.4/thing'), null, 'an IP names nothing');
  assert.equal(deriveVendor('javascript:alert(1)'), null, 'not a web URL at all');
  assert.equal(deriveVendor('not a url'), null);
  assert.equal(deriveVendor(null), null);
  assert.equal(deriveVendor(''), null);
});

test('VENDOR: a stored value wins over the link, so an editor can correct it', () => {
  assert.deepEqual(resolveVendor('amazon', 'https://www.argos.co.uk/x'), { slug: 'amazon', label: 'Amazon' });
  assert.deepEqual(resolveVendor('  Amazon  ', null), { slug: 'amazon', label: 'Amazon' });
  // Tolerates the shapes a vendor column collects over time.
  assert.deepEqual(resolveVendor('www.amazon.com', null), { slug: 'amazon', label: 'Amazon' });
  // Blank falls through to the link, which is the whole point of the fix.
  assert.deepEqual(resolveVendor(null, 'https://amzn.to/3SBe7Ah'), { slug: 'amazon', label: 'Amazon' });
  assert.deepEqual(resolveVendor('', 'https://amzn.to/3SBe7Ah'), { slug: 'amazon', label: 'Amazon' });
});

/* -------------------------------------------------------------- card --- */

function card(overrides: Record<string, unknown> = {}) {
  return renderProductCard({
    productId: 7,
    title: 'A Thing',
    brand: 'Maker',
    vendor: null,
    affiliateUrl: 'https://amzn.to/3SBe7Ah',
    imageUrl: null,
    useCase: 'Doing the thing',
    shortDescription: null,
    description: null,
    ...overrides,
  } as never);
}

test('CARD: the shortcode names the shop, in the slug and in the wording', () => {
  const html = card();

  // The slug, which the site's own map is keyed by — a match there brings the
  // retailer's styling, which Cynth cannot supply.
  assert.match(html, /vendor="amazon"/);
  // And the exact wording, so a shop the site has never heard of is still
  // named on the button rather than falling back to "Check price".
  assert.match(html, /cta="Shop on Amazon"/);
});

test('CARD: a product whose link names no shop carries no vendor at all', () => {
  const html = card({ affiliateUrl: 'https://bit.ly/3xYz' });

  assert.doesNotMatch(html, /vendor=/);
  assert.doesNotMatch(html, /cta=/);
  // The link itself still goes out untouched — it is the editor's, verbatim.
  assert.match(html, /url="https:\/\/bit\.ly\/3xYz"/);
});

test('CARD: a product with no link at all still renders', () => {
  const html = card({ affiliateUrl: null });

  assert.doesNotMatch(html, /vendor=/);
  assert.doesNotMatch(html, /url=/);
  assert.match(html, /\[efd_product /);
});

test('CARD: the affiliate URL is emitted exactly as supplied', () => {
  // The standing rule, restated here because this change reads the URL and a
  // future edit could be tempted to normalise what it parses.
  const url = 'https://www.amazon.com/dp/B0GRJVBPH3?niid=nl_cl_lst_a_1_1&nrid=4MHQXN1';
  assert.ok(card({ affiliateUrl: url }).includes(`url="${url}"`));
});
