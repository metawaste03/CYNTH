/**
 * Search demand — what people searched for, filed under the area it belongs to.
 *
 * What must hold:
 *   1. A Search Console export is read as Search Console writes it.
 *   2. A search is filed under the right area, and one an article already
 *      answers is marked as answered rather than offered as a new subject.
 *   3. Importing a period twice does not double its figures.
 *   4. An editor's filing survives a later import.
 *   5. Topic research is told which searches are unanswered, and an area with
 *      nothing recorded is told that too, rather than left to invent demand.
 *
 * NO PROVIDER IS CONTACTED. Nothing here calls a model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-demand-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const content = await import('../src/features/content/content.repository.js');
const demand = await import('../src/features/search-demand/searchDemand.service.js');

dbModule.initializeDatabase();
const db = dbModule.getDatabase();

const project = content.getDefaultProject()!;
const sleep = content.createTheme(project.id, { name: 'Sleep & Recovery', description: 'Sleep.' });
const workspace = content.createTheme(project.id, { name: 'Productive Workspaces', description: 'Desks.' });
const pets = content.createTheme(project.id, { name: 'Smart Pet Care', description: 'Dogs and cats.' });

function article(themeId: number, title: string, primaryKeyword: string, url: string | null): number {
  const id = Number(
    db
      .prepare(`INSERT INTO articles (title, status, content, theme_id, project_id) VALUES (?, 'published', 'Body.', ?, ?)`)
      .run(title, themeId, project.id).lastInsertRowid,
  );
  db.prepare('INSERT INTO keywords (article_id, primary_keyword) VALUES (?, ?)').run(id, primaryKeyword);
  if (url) {
    const connectionId =
      (db.prepare('SELECT id FROM cms_connections LIMIT 1').get() as { id: number } | undefined)?.id ??
      Number(
        db
          .prepare(`INSERT INTO cms_connections (name, connector_type, base_url) VALUES ('Live', 'wordpress', 'https://example.test')`)
          .run().lastInsertRowid,
      );
    db.prepare(
      `INSERT INTO article_cms_links (article_id, connection_id, external_id, external_status, external_url)
       VALUES (?, ?, ?, 'publish', ?)`,
    ).run(id, connectionId, String(id), url);
  }
  return id;
}

const caffeineId = article(
  sleep.id,
  'How Long Before Bed Should You Stop Drinking Coffee?',
  'caffeine before bed',
  'https://example.test/stop-drinking-coffee-before-bed/',
);
const deskId = article(workspace.id, 'The Correct Desk Height', 'correct desk height', 'https://example.test/correct-desk-height/');

/** Exactly the header Search Console writes into Queries.csv. */
const QUERIES_CSV = [
  'Top queries,Clicks,Impressions,CTR,Position',
  'how many hours before sleep should you stop drinking caffeine,0,31,0%,86.4',
  'desk height too high,1,12,8.33%,80.5',
  '"magnesium glycinate, sleep",0,9,0%,54',
  'dog dental chews,0,4,0%,61',
  'mouth taping evidence,0,6,0%,70',
  'python tutorial,0,2,0%,90',
].join('\r\n');

test('PARSE: reads the file Search Console exports, quoted cells and percentages included', () => {
  const parsed = demand.parseSearchConsoleCsv(`﻿${QUERIES_CSV}`);
  assert.ok(!('error' in parsed), JSON.stringify(parsed));
  const { rows } = parsed as { rows: demand.ParsedSearchRow[] };

  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], {
    query: 'how many hours before sleep should you stop drinking caffeine',
    pageUrl: '',
    clicks: 0,
    impressions: 31,
    position: 86.4,
  });
  assert.equal(rows[2].query, 'magnesium glycinate, sleep', 'a comma inside quotes stays inside the query');
});

test('PARSE: a file with pages and no queries is refused, saying which file to use', () => {
  const parsed = demand.parseSearchConsoleCsv('Top pages,Clicks,Impressions,CTR,Position\nhttps://example.test/,1,2,50%,3');
  assert.ok('error' in parsed);
  assert.match((parsed as { error: string }).error, /Queries/);
});

test('FILING: each search lands in its area, and an answered one names the article', () => {
  const parsed = demand.parseSearchConsoleCsv(QUERIES_CSV) as { rows: demand.ParsedSearchRow[]; skipped: number };
  const summary = demand.importSearchQueries(parsed.rows, { period: 'Last 28 days' });

  assert.equal(summary.added, 6);
  assert.equal(summary.unfiled, 2, 'mouth taping and the off-topic search match nothing yet');

  const byQuery = new Map(demand.listSearchQueries().map((row) => [row.query, row]));

  const caffeine = byQuery.get('how many hours before sleep should you stop drinking caffeine')!;
  assert.equal(caffeine.themeId, sleep.id);

  const desk = byQuery.get('desk height too high')!;
  assert.equal(desk.themeId, workspace.id);
  assert.equal(desk.themeSource, 'match');

  // No article, but the area's declared scope names dental chews.
  const dental = byQuery.get('dog dental chews')!;
  assert.equal(dental.themeId, pets.id, 'filed from the area scope when no article matches');
  assert.equal(dental.articleId, null, 'and nothing answers it yet');

  // Magnesium for sleep is in the sleep area's scope, though no article covers it.
  const magnesium = byQuery.get('magnesium glycinate, sleep')!;
  assert.equal(magnesium.themeId, sleep.id);
  assert.equal(magnesium.articleId, null);

  assert.equal(byQuery.get('python tutorial')!.themeId, null, 'an unrelated search is filed nowhere');
});

test('FILING: the page Google showed decides the area outright', () => {
  demand.importSearchQueries([
    { query: 'if your desk is set too high what is likely to result', pageUrl: 'https://example.test/correct-desk-height', clicks: 0, impressions: 7, position: 80 },
  ]);
  const row = demand.listSearchQueries().find((entry) => entry.query.startsWith('if your desk'))!;
  assert.equal(row.themeSource, 'page');
  assert.equal(row.articleId, deskId, 'a trailing slash does not stop the page being recognised');
  assert.equal(row.articleTitle, 'The Correct Desk Height');
});

test('SNAPSHOT: importing the same period again replaces the figures instead of adding to them', () => {
  const before = demand.listSearchQueries().length;
  const summary = demand.importSearchQueries([
    { query: 'desk height too high', pageUrl: '', clicks: 3, impressions: 40, position: 22.1 },
  ]);
  assert.equal(summary.added, 0);
  assert.equal(summary.updated, 1);
  assert.equal(demand.listSearchQueries().length, before);

  const row = demand.findRecordedSearch('Desk Height  Too High')!;
  assert.equal(row.impressions, 40);
  assert.equal(row.clicks, 3);
});

test('MANUAL: an editor filing a search is not undone by the next import', () => {
  const taping = demand.findRecordedSearch('mouth taping evidence')!;
  assert.equal(taping.themeId, null);

  demand.fileSearchQuery(taping.id, sleep.id);
  demand.importSearchQueries([{ query: 'mouth taping evidence', pageUrl: '', clicks: 0, impressions: 15, position: 50 }]);

  const after = demand.findRecordedSearch('mouth taping evidence')!;
  assert.equal(after.themeId, sleep.id);
  assert.equal(after.themeSource, 'manual');
  assert.equal(after.impressions, 15, 'the figures still update');
});

test('RESEARCH: the area is told what is unanswered, and what already has an article', () => {
  // A search worded like the caffeine article's own subject is answered by it.
  demand.importSearchQueries([{ query: 'caffeine before bed', pageUrl: '', clicks: 0, impressions: 20, position: 90 }]);
  assert.equal(demand.findRecordedSearch('caffeine before bed')!.articleId, caffeineId);

  const block = demand.buildSearchDemandBlock(sleep.id);
  assert.match(block, /WHAT SEARCHERS ASKED GOOGLE/);
  assert.match(block, /Last 28 days/);

  const unansweredAt = block.indexOf('matched to no article');
  const answeredAt = block.indexOf('Searches an existing article already answers');
  assert.ok(unansweredAt > 0 && answeredAt > unansweredAt, block);

  const magnesiumAt = block.indexOf('"magnesium glycinate, sleep"');
  const caffeineAt = block.indexOf('"caffeine before bed"');
  assert.ok(magnesiumAt > unansweredAt && magnesiumAt < answeredAt, 'the unanswered search is offered as a subject');
  assert.ok(caffeineAt > answeredAt, 'the answered one is listed as already written');
  assert.match(block, /How Long Before Bed Should You Stop Drinking Coffee\?/);
  assert.match(block, /answers_query/);

  // Another area's searches never leak in.
  assert.doesNotMatch(block, /desk height/);
});

test('RESEARCH: an area with nothing recorded says so, and demand must be labelled as inferred', () => {
  const empty = content.createTheme(project.id, { name: 'Fitness Technology', description: 'Wearables.' });
  const block = demand.buildSearchDemandBlock(empty.id);
  assert.match(block, /no searches for this area yet/i);
  assert.match(block, /inferred, not measured/);
  assert.match(block, /answers_query/);
});

test('KEYWORDS: the answered search carries its recorded figures, or says it is inferred', () => {
  assert.match(demand.describeAnsweredSearch('desk height too high'), /40 impressions, 3 clicks, position 22/);
  assert.match(demand.describeAnsweredSearch('why do i wake up at 3am'), /inferred/);
  assert.equal(demand.describeAnsweredSearch(undefined), '', 'research from before search demand adds nothing');
});

test.after(() => {
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
