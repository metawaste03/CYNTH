/**
 * THE CURRENCY THE PUBLICATION WRITES IN.
 *
 * Found in the copy, not in a failure: one article priced an entire buyer's
 * guide in pounds — "$300–$600" in today's database, "£300–£600" before this
 * — 68 times including the headline, for a publication whose readers are in
 * the United States. Nothing had ever told the writer where its readers live.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cynth-market-'));
// CYNTH_DB_DIR, not CYNTH_DB_PATH. The wrong name is silently ignored,
// so the test runs against the REAL database and writes to it.
process.env.CYNTH_DB_DIR = scratch;

const dbModule = await import('../src/shared/database/index.js');
dbModule.initializeDatabase();

const settings = await import('../src/shared/settings/settings.repository.js');
const market = await import('../src/features/generation/publicationMarket.service.js');

test('MARKET: the default is the United States, in dollars', () => {
  const described = market.describePublicationMarket();

  assert.match(described, /Readers are in the United States/);
  assert.match(described, /US dollars \(\$\)/);
  // The title matters as much as the body — the article that prompted this
  // carried its currency in the headline.
  assert.match(described, /including in the title/i);
});

test('MARKET: it is a setting, so another market needs no code change', () => {
  settings.setSetting(market.PUBLICATION_MARKET_KEY, 'the United Kingdom');
  settings.setSetting(market.PUBLICATION_CURRENCY_KEY, 'pounds sterling (£)');

  const described = market.describePublicationMarket();
  assert.match(described, /Readers are in the United Kingdom/);
  assert.match(described, /pounds sterling/);

  settings.setSetting(market.PUBLICATION_MARKET_KEY, '');
  settings.setSetting(market.PUBLICATION_CURRENCY_KEY, '');
  assert.match(market.describePublicationMarket(), /United States/, 'blank falls back rather than emptying the rule');
});

test('MARKET: a product sold elsewhere is named, not silently converted', () => {
  // The failure mode on the other side: a model that has been told "always
  // dollars" will happily relabel a £40 UK-only product as $40.
  const described = market.describePublicationMarket();

  assert.match(described, /sold only outside/i);
  assert.match(described, /never convert silently/i);
});
