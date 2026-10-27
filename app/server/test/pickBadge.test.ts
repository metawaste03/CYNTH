/**
 * Pick badges: the label on a product's card in EveryFiveDays' editors'
 * review section (Editor's Pick, Best Value, Upgrade Pick).
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-badge-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const products = await import('../src/features/products/products.repository.js');
const { validateProductInput, PICK_BADGES } = await import('../src/features/products/products.validation.js');

dbModule.initializeDatabase();

test.after(() => {
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

function save(body: Record<string, unknown>, id?: number) {
  const { errors, value } = validateProductInput(body);
  assert.deepEqual(errors, []);
  return id === undefined ? products.createProduct(value!) : products.updateProduct(id, value!)!;
}

test('BADGE: a pick is saved with its badge', () => {
  const p = save({ title: 'Badged Lamp', isFeaturedPick: true, pickBadge: 'best-value' });
  assert.equal(p.isFeaturedPick, true);
  assert.equal(p.pickBadge, 'best-value');
});

test('BADGE: an edit that does not send a badge leaves it alone', () => {
  const p = save({ title: 'Kept Badge', isFeaturedPick: true, pickBadge: 'editors-pick' });
  const edited = save({ title: 'Kept Badge, renamed' }, p.id);
  assert.equal(edited.title, 'Kept Badge, renamed');
  assert.equal(edited.pickBadge, 'editors-pick', 'a partial save must not strip the badge');
});

test('BADGE: choosing "No badge" really clears it', () => {
  const p = save({ title: 'Cleared Badge', isFeaturedPick: true, pickBadge: 'upgrade-pick' });
  assert.equal(save({ title: 'Cleared Badge', pickBadge: null }, p.id).pickBadge, null);

  const q = save({ title: 'Cleared With Empty', isFeaturedPick: true, pickBadge: 'upgrade-pick' });
  assert.equal(save({ title: 'Cleared With Empty', pickBadge: '' }, q.id).pickBadge, null);
});

test('BADGE: an unknown badge is refused, not stored', () => {
  const { errors } = validateProductInput({ title: 'Bad Badge', pickBadge: 'top-rated' });
  assert.ok(errors.some((e) => /pickBadge must be one of/.test(e)));
});

test('BADGE: the three labels readers see', () => {
  assert.deepEqual(Object.keys(PICK_BADGES), ['editors-pick', 'best-value', 'upgrade-pick']);
});
