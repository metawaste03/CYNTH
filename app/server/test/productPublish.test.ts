/**
 * "Publish products to EveryFiveDays" — the guards around the real commands.
 * Nothing here contacts the site: the repository path points nowhere.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.CYNTH_EFD_REPO = path.join(os.tmpdir(), `no-efd-repo-${process.pid}`);
const { publishProducts, isPublishing } = await import('../src/features/products/productPublish.service.js');

test('PUBLISH: a missing EveryFiveDays repository is reported, and nothing runs', async () => {
  const result = await publishProducts();
  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 0, 'no command was started');
  assert.match(result.summary, /repository was not found/);
  assert.equal(isPublishing(), false, 'the lock is released');
});
