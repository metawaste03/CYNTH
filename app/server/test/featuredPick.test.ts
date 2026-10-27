/**
 * THE EDITOR'S PICK FLAG.
 *
 * What it replaces: fifteen product cards hardcoded into the site's category
 * template — five groups of three, one group per area, all fifteen rendered on
 * every category page. None carried an id, so none resolved against the
 * registry: no image, no affiliate link, no button.
 *
 * The flag lives in Cynth rather than in WordPress because the decision is
 * editorial and made while looking at the product — and because a flag held
 * only on the site would be overwritten by the next registry push.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cynth-pick-'));
// CYNTH_DB_DIR, not CYNTH_DB_PATH. The wrong name is silently ignored,
// so the test runs against the REAL database and writes to it.
process.env.CYNTH_DB_DIR = scratch;

const dbModule = await import('../src/shared/database/index.js');
dbModule.initializeDatabase();

const products = await import('../src/features/products/products.repository.js');
const validation = await import('../src/features/products/products.validation.js');

test('PICK: a product is not a pick until somebody says so', () => {
  const product = products.createProduct({ title: 'Litter Box', affiliateLink: 'https://amzn.to/x' });
  assert.equal(product.isFeaturedPick, false);
});

test('PICK: ticking and unticking both stick', () => {
  const product = products.createProduct({ title: 'GPS Collar', affiliateLink: 'https://amzn.to/y' });

  products.updateProduct(product.id, { title: 'GPS Collar', isFeaturedPick: true });
  assert.equal(products.getProductById(product.id)!.isFeaturedPick, true);

  // The weekly loop is untick one, tick another — so unticking has to work as
  // reliably as ticking. A flag that only ever goes on is a flag that fills up.
  products.updateProduct(product.id, { title: 'GPS Collar', isFeaturedPick: false });
  assert.equal(products.getProductById(product.id)!.isFeaturedPick, false);
});

test('PICK: a save that does not mention the flag leaves it alone', () => {
  /**
   * The trap this avoids: any other form or script that saves a product
   * without sending the checkbox would silently unpick it, and the picks row
   * would empty itself over time with nobody having decided anything.
   */
  const product = products.createProduct({ title: 'Automatic Feeder', affiliateLink: 'https://amzn.to/z' });
  products.updateProduct(product.id, { title: 'Automatic Feeder', isFeaturedPick: true });

  products.updateProduct(product.id, { title: 'Automatic Feeder v2' });

  const after = products.getProductById(product.id)!;
  assert.equal(after.title, 'Automatic Feeder v2', 'the edit landed');
  assert.equal(after.isFeaturedPick, true, 'and the pick survived it');
});

test('PICK: it can be set at creation', () => {
  const product = products.createProduct({
    title: 'Cat Camera',
    affiliateLink: 'https://amzn.to/c',
    isFeaturedPick: true,
  });
  assert.equal(product.isFeaturedPick, true);
});

test('PICK: only a real boolean counts as a decision', () => {
  // Anything else is "not mentioned", which the update treats as unchanged —
  // so a stray string from a form cannot flip a pick on or off.
  assert.equal(validation.validateProductInput({ title: 'X', isFeaturedPick: true }).value!.isFeaturedPick, true);
  assert.equal(validation.validateProductInput({ title: 'X', isFeaturedPick: false }).value!.isFeaturedPick, false);
  assert.equal(validation.validateProductInput({ title: 'X', isFeaturedPick: 'yes' }).value!.isFeaturedPick, undefined);
  assert.equal(validation.validateProductInput({ title: 'X' }).value!.isFeaturedPick, undefined);
});

test('PICK: there is no cap, because three was a layout decision', () => {
  /**
   * The original three came from the build spec — "the picks rows put three
   * cards side by side at roughly 370px each" — not from any SEO rule. The
   * row it feeds now scrolls past three rather than wrapping, so nothing here
   * needs to refuse a fourth.
   */
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map(
    (suffix) =>
      products.createProduct({
        title: `Pet thing ${suffix}`,
        category: 'Smart Pet Care',
        affiliateLink: `https://amzn.to/${suffix}`,
        isFeaturedPick: true,
      }).id,
  );

  const picked = ids
    .map((id) => products.getProductById(id)!)
    .filter((product) => product.isFeaturedPick && product.category === 'Smart Pet Care');

  assert.equal(picked.length, 6, 'six picks in one category is allowed');
});
