/**
 * Link targets — what a new article may link to, decided before it is written.
 *
 * What must hold:
 *   1. Only an article the live site has published is offered, with the
 *      address the site gave it.
 *   2. The same area and shared subject matter rank first; an unrelated
 *      article is not offered at all.
 *   3. The writer is told to use the addresses exactly and compose none.
 *   4. A link to the site that matches no published article is caught.
 *
 * NO PROVIDER IS CONTACTED. Nothing here calls a model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-linktargets-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const content = await import('../src/features/content/content.repository.js');
const targets = await import('../src/features/seo/linkTargets.service.js');
const internalLinks = await import('../src/features/seo/internalLinks.service.js');

dbModule.initializeDatabase();
const db = dbModule.getDatabase();

const project = content.getDefaultProject()!;
const sleep = content.createTheme(project.id, { name: 'Sleep & Recovery', description: 'Sleep.' });
const focus = content.createTheme(project.id, { name: 'Cognitive Performance', description: 'Focus.' });
const pets = content.createTheme(project.id, { name: 'Smart Pet Care', description: 'Dogs and cats.' });

const connectionId = Number(
  db
    .prepare(`INSERT INTO cms_connections (name, connector_type, base_url) VALUES ('Live', 'wordpress', 'https://example.test')`)
    .run().lastInsertRowid,
);

function article(themeId: number, title: string, keyword: string, link: { status: string; url: string } | null): number {
  const id = Number(
    db
      .prepare(`INSERT INTO articles (title, status, content, theme_id, project_id, topic) VALUES (?, 'published', 'Body.', ?, ?, ?)`)
      .run(title, themeId, project.id, keyword).lastInsertRowid,
  );
  db.prepare('INSERT INTO keywords (article_id, primary_keyword) VALUES (?, ?)').run(id, keyword);
  if (link) {
    db.prepare(
      `INSERT INTO article_cms_links (article_id, connection_id, external_id, external_status, external_url)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, connectionId, String(id), link.status, link.url);
  }
  return id;
}

const caffeine = article(sleep.id, 'How Long Before Bed Should You Stop Drinking Coffee?', 'caffeine cut-off before sleep', {
  status: 'publish',
  url: 'https://example.test/stop-coffee-before-bed/',
});
const alcohol = article(sleep.id, 'Alcohol and Sleep', 'alcohol and sleep quality', {
  status: 'publish',
  url: 'https://example.test/alcohol-and-sleep/',
});
const fatigue = article(focus.id, 'Afternoon Mental Fatigue', 'afternoon fatigue caffeine sleep', {
  status: 'publish',
  url: 'https://example.test/afternoon-mental-fatigue/',
});
const draftOnSite = article(sleep.id, 'Magnesium for Sleep', 'magnesium sleep', {
  status: 'draft',
  url: 'https://example.test/?p=340',
});
const neverPushed = article(sleep.id, 'Bedroom Temperature for Sleep', 'bedroom temperature sleep', null);
const litter = article(pets.id, 'Automatic Litter Box Buyer’s Guide', 'automatic litter box', {
  status: 'publish',
  url: 'https://example.test/automatic-litter-box/',
});

const writing = article(sleep.id, 'Why Do I Wake Up at 3am?', 'waking at 3am', null);

test('OFFERED: only articles the live site has published, with the address it gave them', () => {
  const offered = targets.listLinkTargets(writing, sleep.id, 'waking at 3am sleep caffeine alcohol');
  const ids = offered.map((target) => target.articleId);

  assert.ok(ids.includes(caffeine) && ids.includes(alcohol));
  assert.ok(!ids.includes(draftOnSite), 'a draft on the site answers 404 to a reader');
  assert.ok(!ids.includes(neverPushed), 'an article never pushed has no address at all');
  assert.ok(!ids.includes(writing), 'an article does not link to itself');

  assert.equal(offered.find((target) => target.articleId === alcohol)!.url, 'https://example.test/alcohol-and-sleep/');
});

test('RANKED: shared subject crosses areas, and an unrelated article is not offered', () => {
  const offered = targets.listLinkTargets(writing, sleep.id, 'waking at 3am sleep caffeine alcohol');
  const ids = offered.map((target) => target.articleId);

  assert.ok(ids.includes(fatigue), 'another area is offered when the subject overlaps');
  assert.ok(!ids.includes(litter), 'nothing connects a litter box to waking at 3am');
});

test('WRITER: told to use the addresses exactly, compose none, and keep links out of headings', () => {
  const block = targets.describeLinkTargets(targets.listLinkTargets(writing, sleep.id, 'waking at 3am sleep caffeine alcohol'));
  assert.match(block, /ARTICLES ALREADY PUBLISHED ON THIS SITE/);
  assert.match(block, /between 3 and 5/);
  assert.match(block, /https:\/\/example\.test\/alcohol-and-sleep\//);
  assert.match(block, /never compose an address/i);
  assert.match(block, /heading/);

  assert.equal(targets.describeLinkTargets([]), '', 'nothing published means nothing is said');
  assert.equal(targets.describeLinkTargets(undefined), '', 'a brief from before this existed adds nothing');
});

test('AUDIT: a composed address on the site is caught; published ones and other sites are not', () => {
  const audit = targets.auditInternalLinks([
    'https://example.test/alcohol-and-sleep',
    'https://example.test/stop-coffee-before-bed/#faq',
    'https://example.test/alcohol-and-sleep/',
    'https://example.test/best-sleep-supplements/',
    'https://pubmed.ncbi.nlm.nih.gov/12345/',
    '/relative-path',
  ]);

  assert.equal(audit.internal, 2, 'two distinct published articles, however the address was written');
  assert.deepEqual(audit.unknown, ['https://example.test/best-sleep-supplements/']);
});

test('SHARED: the link pass and the writer agree on what a reader can open', () => {
  assert.equal(internalLinks.resolvePublicUrl(alcohol), targets.resolvePublicUrl(alcohol));
  assert.equal(internalLinks.resolvePublicUrl(draftOnSite), null);
});

test.after(() => {
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
