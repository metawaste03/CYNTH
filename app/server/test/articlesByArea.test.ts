/**
 * THE CATALOGUE, GROUPED BY THEMATIC AREA.
 *
 * The Dashboard's Articles card reported one total and went nowhere. This is
 * what it now opens: what exists per area, how long it is, and where it stands.
 *
 * Two things these tests hold down, both of which were wrong in the first
 * version: the SEO score has to come from the status vocabulary the analysis
 * service actually writes, and "on the site" has to mean the live site rather
 * than whichever CMS row happened to come back first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cynth-byarea-'));
// CYNTH_DB_DIR, not CYNTH_DB_PATH. The wrong name is silently ignored, so the
// test runs against the REAL database and writes to it.
process.env.CYNTH_DB_DIR = scratch;

const dbModule = await import('../src/shared/database/index.js');
dbModule.initializeDatabase();
const db = dbModule.getDatabase();

const byArea = await import('../src/features/articles/articlesByArea.service.js');
const { fingerprintOf } = await import('../src/features/seo/seoAnalysis.service.js');

const themeId = (db.prepare("SELECT id FROM themes WHERE name = 'Smart Pet Care' ORDER BY id LIMIT 1").get() as {
  id: number;
}).id;

function article(title: string, content: string | null, theme: number | null = themeId): number {
  return Number(
    db
      .prepare("INSERT INTO articles (title, status, theme_id, content, generated_title) VALUES (?, 'draft', ?, ?, NULL)")
      .run(title, theme, content).lastInsertRowid,
  );
}

function connection(name: string, baseUrl: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO cms_connections (name, connector_type, base_url, auth_method, is_active, is_default)
         VALUES (?, 'wordpress', ?, 'application_password', 1, 0)`,
      )
      .run(name, baseUrl).lastInsertRowid,
  );
}

function link(articleId: number, connectionId: number, status: string, url: string, pushedAt: string): void {
  db.prepare(
    `INSERT INTO article_cms_links (article_id, connection_id, external_id, external_status, external_url, last_pushed_at)
     VALUES (?, ?, '1', ?, ?, ?)`,
  ).run(articleId, connectionId, status, url, pushedAt);
}

function analysis(articleId: number, score: number, status: string, fingerprint: string): void {
  db.prepare(
    `INSERT INTO seo_analysis_runs (article_id, mode, status, score, content_fingerprint, created_at)
     VALUES (?, 'full', ?, ?, ?, datetime('now'))`,
  ).run(articleId, status, score, fingerprint);
}

const localId = connection('Local', 'http://everyfivedays.local');
const liveId = connection('Live', 'https://everyfivedays.com');

test('BY AREA: articles are grouped under their thematic area, with counts', () => {
  const a = article('A Dog Article', 'one two three four five');
  article('A Cat Article', 'one two three');
  link(a, liveId, 'publish', 'https://everyfivedays.com/a/', '2026-10-01 10:00:00');

  const result = byArea.listArticlesByArea();
  const pet = result.areas.find((area) => area.themeName === 'Smart Pet Care')!;

  assert.equal(pet.total, 2);
  assert.equal(pet.live, 1, 'live counts only what is published on the site');
  assert.equal(pet.notPushed, 1);
  assert.equal(pet.words, 8, 'five words plus three');
});

test('BY AREA: the word count matches the one the Drafts list shows', () => {
  // Both derive it; a different derivation would make the same article read
  // two different lengths on two screens.
  const id = article('Counting Test', '  spaced   out \n\n words here  ');
  const result = byArea.listArticlesByArea();
  const row = result.areas.flatMap((a) => a.articles).find((x) => x.id === id)!;

  assert.equal(row.wordCount, 4);
});

test('BY AREA: an article with no body is listed, but counts no words', () => {
  const id = article('Commissioned, Never Written', null);
  const result = byArea.listArticlesByArea();
  const row = result.areas.flatMap((a) => a.articles).find((x) => x.id === id)!;

  assert.equal(row.hasContent, false);
  assert.equal(row.wordCount, 0, 'an intention is not work');
});

test('BY AREA: "on the site" means the LIVE site, not whichever row came first', () => {
  const id = article('Pushed To Both', 'body text here');
  // The local push is the more recent one, and would win on date alone.
  link(id, liveId, 'publish', 'https://everyfivedays.com/both/', '2026-09-01 10:00:00');
  link(id, localId, 'draft', 'http://everyfivedays.local/?p=9', '2026-10-02 10:00:00');

  const result = byArea.listArticlesByArea();
  const row = result.areas.flatMap((a) => a.articles).find((x) => x.id === id)!;

  assert.equal(row.cmsStatus, 'publish');
  assert.equal(row.externalUrl, 'https://everyfivedays.com/both/');
});

test('BY AREA: the SEO score is read from the statuses the analysis actually writes', () => {
  const content = 'measured body';
  const id = article('Scored', content);
  // 'success' and 'partial' — NOT 'succeeded', which was the first guess and
  // left every score on the page showing as a dash.
  analysis(id, 91, 'success', fingerprintOf('Scored', null, content));

  const partialId = article('Partially Scored', content);
  analysis(partialId, 74, 'partial', fingerprintOf('Partially Scored', null, content));

  const rows = byArea.listArticlesByArea().areas.flatMap((a) => a.articles);
  assert.equal(rows.find((x) => x.id === id)!.seoScore, 91);
  assert.equal(
    rows.find((x) => x.id === partialId)!.seoScore,
    74,
    'a partial run still produced a real deterministic score',
  );
});

test('BY AREA: a score measured against a body that has since changed is marked stale', () => {
  const id = article('Edited After Analysis', 'the body as analysed');
  analysis(id, 88, 'success', fingerprintOf('Edited After Analysis', null, 'the body as analysed'));

  let row = byArea.listArticlesByArea().areas.flatMap((a) => a.articles).find((x) => x.id === id)!;
  assert.equal(row.seoStale, false);

  db.prepare('UPDATE articles SET content = ? WHERE id = ?').run('the body, after an edit', id);

  row = byArea.listArticlesByArea().areas.flatMap((a) => a.articles).find((x) => x.id === id)!;
  assert.equal(row.seoStale, true, 'the score now describes an article that no longer exists');
  assert.equal(row.seoScore, 88, 'the number is still shown — labelled, not hidden');
});

test('BY AREA: articles with no area are grouped last, as a loose end', () => {
  article('No Area At All', 'orphan body', null);

  const areas = byArea.listArticlesByArea().areas;
  assert.equal(areas[areas.length - 1].themeName, 'No thematic area');
  assert.equal(areas[areas.length - 1].themeId, null);
});
