/**
 * IS AN AREA COVERING WHAT ITS BRIEF SAYS IT COVERS?
 *
 * Smart Pet Care's brief says "DOGS AND CATS BOTH. The back catalogue skews
 * heavily to cats and to devices; correct for that rather than continuing it."
 * The instruction was in the one place topic research reads, and nothing could
 * say whether it was working. It was not: seven of eleven products in the area
 * were cat-specific, five of them litter boxes.
 *
 * The first version of the report judged on article counts alone and said "no
 * clear skew" over that library, because the two articles happened to be one
 * each. These tests exist so that cannot come back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cynth-balance-'));
// CYNTH_DB_DIR, not CYNTH_DB_PATH. The wrong name is silently ignored, so the
// test runs against the REAL database and writes to it.
process.env.CYNTH_DB_DIR = scratch;

const dbModule = await import('../src/shared/database/index.js');
dbModule.initializeDatabase();
const db = dbModule.getDatabase();

const balance = await import('../src/features/articles/areaBalance.service.js');

/**
 * The SEEDED theme, not a new one.
 *
 * The schema already creates the five areas, so inserting another "Smart Pet
 * Care" made a duplicate — and the service resolved the name to the seeded one
 * while the fixtures hung off the new one, so every article count came back 0
 * while the products (keyed by category NAME) counted correctly. The split
 * result is what gave it away.
 */
const themeId = (db.prepare("SELECT id FROM themes WHERE name = 'Smart Pet Care' ORDER BY id LIMIT 1").get() as {
  id: number;
}).id;

function article(title: string, content: string): void {
  db.prepare("INSERT INTO articles (title, status, theme_id, content) VALUES (?, 'draft', ?, ?)").run(
    title,
    themeId,
    content,
  );
}

function product(title: string, blurb: string): void {
  db.prepare(
    "INSERT INTO products (title, category, short_description, is_active, status) VALUES (?, 'Smart Pet Care', ?, 1, 'active')",
  ).run(title, blurb);
}

test('BALANCE: an area that declares no facets is not measured', () => {
  assert.equal(balance.getAreaBalance('Sleep & Recovery'), null);
  assert.equal(balance.buildBalanceBlock('Sleep & Recovery'), '');
  assert.equal(balance.buildBalanceBlock(null), '');
});

test('BALANCE: dominance decides the focus, not mere presence', () => {
  // The article that prompted all this: a litter-box guide with seventy
  // mentions of cats and none of dogs.
  article('Automatic Litter Box Buyer’s Guide', 'cats cats litter box cats kitten feline cats litter tray');
  // A dog article that mentions cats once, to say the advice differs. Counting
  // that as cat coverage would make the measure useless.
  article('Dog Dental Care Without the Gimmicks', 'dogs dog puppy canine dogs dog teeth — unlike a cat.');

  const result = balance.getAreaBalance('Smart Pet Care')!;
  const byTitle = Object.fromEntries(result.articles.map((a) => [a.title, a.focus]));

  assert.equal(byTitle['Automatic Litter Box Buyer’s Guide'], 'cats');
  assert.equal(byTitle['Dog Dental Care Without the Gimmicks'], 'dogs', 'one aside does not flip the focus');
});

test('BALANCE: a single passing mention is not coverage of anything', () => {
  article('Choosing a Vet You Can Actually Reach', 'Ask about out-of-hours cover. One dog owner we spoke to waited.');

  const result = balance.getAreaBalance('Smart Pet Care')!;
  const entry = result.articles.find((a) => a.title.startsWith('Choosing a Vet'))!;
  assert.equal(entry.focus, 'both or neither', 'below the threshold is neutral, not a lean');
});

test('BALANCE: the product library is measured too — the skew lived there first', () => {
  for (const name of [
    'Cat Litter Box A',
    'Cat Litter Box B',
    'Cat Litter Pan C',
    'Cat Treats D',
    'Cat Treats E',
    'Automatic Cat Feeder F',
    'Cat Litter G',
  ]) {
    product(name, 'For cats. A cat product for a cat.');
  }
  product('Dog GPS Fence', 'For dogs. A dog product for a dog.');
  product('Pet Tag', 'A QR tag for any animal.');

  const result = balance.getAreaBalance('Smart Pet Care')!;
  const cats = result.products.filter((p) => p.focus === 'cats').length;
  const dogs = result.products.filter((p) => p.focus === 'dogs').length;

  assert.equal(cats, 7);
  assert.equal(dogs, 1);
  assert.ok(
    result.products.some((p) => p.focus === 'both or neither'),
    'a product that names no species is neither, not silently counted as one',
  );
});

test('BALANCE: the prompt block states counts, and names products as well as articles', () => {
  const block = balance.buildBalanceBlock('Smart Pet Care');

  assert.match(block, /HOW THIS AREA IS CURRENTLY BALANCED/);
  assert.match(block, /Articles \(3\)/);
  assert.match(block, /Products in the library \(9\): 1 dogs, 7 cats/);
  // It must not present a word count as a judgement.
  assert.match(block, /keyword tallies, not judgements/);
  assert.match(block, /prefer a subject that serves it/);
});
