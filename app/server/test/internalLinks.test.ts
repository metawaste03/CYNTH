/**
 * TURNING AN APPROVED INTERNAL LINK INTO AN ACTUAL LINK.
 *
 * Reported plainly: the Opportunities panel offers internal links between
 * related articles, and approving one did nothing. The evidence was ten
 * approved links across six articles, and zero `href`s in those six bodies.
 *
 * The two things these tests hold down are the two ways this feature could do
 * harm rather than nothing: linking to a page a reader cannot open, and
 * letting a "link pass" quietly rewrite a finished article.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cynth-links-'));
// CYNTH_DB_DIR, not CYNTH_DB_PATH. The wrong name is silently ignored, so the
// test runs against the REAL database and writes to it.
process.env.CYNTH_DB_DIR = scratch;

const dbModule = await import('../src/shared/database/index.js');
dbModule.initializeDatabase();
const db = dbModule.getDatabase();

const stages = await import('../src/features/pipeline/stages/generationStages.service.js');
const links = await import('../src/features/seo/internalLinks.service.js');

const ARTICLE = {
  title: 'Desk Lighting for Eye Strain',
  excerpt: 'An excerpt.',
  seoTitle: '',
  metaDescription: '',
  sections: [
    { key: 'hero', heading: 'Hero', body: 'Glare is the usual culprit at a desk.' },
    { key: 'body', heading: 'What to change first', body: 'A laptop at eye level fixes more than a new lamp. [[product:23]]' },
  ],
  faq: [{ question: 'Does colour temperature matter?', answer: 'Less than placement does.' }],
  sources: [],
} as never;

/* ---------------------------------------------------------------- prompt --- */

test('LINK PROMPT: the anchor must be words the article already contains', () => {
  const prompt = stages.buildInternalLinkPrompt(
    ARTICLE,
    [
      {
        targetTitle: 'How to Make a Laptop Workspace Ergonomic',
        url: 'https://everyfivedays.com/how-to-make-a-laptop-workspace-ergonomic/',
        anchor: 'How to Make a Laptop Workspace Ergonomic',
        reason: 'Both cover desk setup.',
      },
    ],
    '',
  );

  // The rule that stops a link arriving with an unreviewed sentence attached.
  assert.match(prompt, /Do NOT write any new sentence/);
  assert.match(prompt, /ALREADY in the article body/);
  assert.match(prompt, /never inside an existing link/);
  assert.match(prompt, /Preserve every \[\[product:<id>\]\] marker/);

  // The suggestion travels, but explicitly as a suggestion: the stored anchor
  // is usually the target's own title, which is not in the source prose.
  assert.match(prompt, /use it only if those words are in the body/);

  assert.match(prompt, /https:\/\/everyfivedays\.com\/how-to-make-a-laptop-workspace-ergonomic\//);
  assert.match(prompt, /leave that link out rather than inventing somewhere for it/);
});

test('LINK PROMPT: every link goes in ONE specification', () => {
  const prompt = stages.buildInternalLinkPrompt(
    ARTICLE,
    [
      { targetTitle: 'First', url: 'https://everyfivedays.com/first/', anchor: null, reason: null },
      { targetTitle: 'Second', url: 'https://everyfivedays.com/second/', anchor: null, reason: null },
    ],
    '',
  );

  assert.match(prompt, /1\. First/);
  assert.match(prompt, /2\. Second/);
});

/* ------------------------------------------------------- URL resolution --- */

function seedArticle(id: number, title: string): void {
  db.prepare('INSERT INTO articles (id, title, status) VALUES (?, ?, ?)').run(id, title, 'draft');
}

function seedConnection(id: number, name: string, baseUrl: string, isDefault: number): void {
  db.prepare(
    `INSERT INTO cms_connections (id, name, connector_type, base_url, auth_method, is_active, is_default)
     VALUES (?, ?, 'wordpress', ?, 'application_password', 1, ?)`,
  ).run(id, name, baseUrl, isDefault);
}

function seedPush(articleId: number, connectionId: number, externalId: string, status: string, url: string, pushedAt: string): void {
  db.prepare(
    `INSERT INTO article_cms_links (article_id, connection_id, external_id, external_status, external_url, last_pushed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(articleId, connectionId, externalId, status, url, pushedAt);
}

test('URL: a draft target is refused, because its ?p= permalink 404s for a reader', () => {
  seedArticle(901, 'A draft on the site');
  seedConnection(801, 'Live', 'https://everyfivedays.com', 0);
  seedPush(901, 801, '334', 'draft', 'https://everyfivedays.com/?p=334', '2026-09-20 10:00:00');

  assert.equal(links.resolvePublicUrl(901), null);
});

test('URL: a published target resolves to the permalink the SITE gave us', () => {
  seedArticle(902, 'A published article');
  seedPush(902, 801, '344', 'publish', 'https://everyfivedays.com/how-to-make-a-laptop-workspace-ergonomic/', '2026-09-21 10:00:00');

  assert.equal(
    links.resolvePublicUrl(902),
    'https://everyfivedays.com/how-to-make-a-laptop-workspace-ergonomic/',
  );
});

test('URL: the DEFAULT connection is ignored — here it is a dead local install', () => {
  // The real configuration that makes this matter: the default connection is
  // `http://everyfivedays.local`, and the live site is not the default. Code
  // that reached for is_default would link every article to a dead host.
  seedConnection(802, 'Local', 'http://everyfivedays.local', 1);
  seedArticle(903, 'Pushed to both');
  seedPush(903, 802, '310', 'publish', 'http://everyfivedays.local/are-sleep-trackers-accurate/', '2026-09-28 10:00:00');
  seedPush(903, 801, '338', 'publish', 'https://everyfivedays.com/are-sleep-trackers-accurate/', '2026-09-22 10:00:00');

  // https wins over the more recent http push.
  assert.equal(links.resolvePublicUrl(903), 'https://everyfivedays.com/are-sleep-trackers-accurate/');
});

test('URL: an article that was never pushed has no link target at all', () => {
  seedArticle(904, 'Never pushed');
  assert.equal(links.resolvePublicUrl(904), null);
});

/* ----------------------------------------------------------- the refusal --- */

test('APPLY: no approved link is an explicit refusal, not a silent no-op', async () => {
  seedArticle(905, 'Nothing approved');
  db.prepare("UPDATE articles SET structured_content = ? WHERE id = ?").run(JSON.stringify(ARTICLE), 905);

  await assert.rejects(
    () => links.applyApprovedInternalLinks(905),
    /No approved internal link is waiting/,
  );
});

test('APPLY: an article with no body cannot be linked from', async () => {
  seedArticle(906, 'No content');
  await assert.rejects(() => links.applyApprovedInternalLinks(906), /no generated content/);
});

test('APPLY: an approved link to an unpublished target is HELD, and spends nothing', async () => {
  seedArticle(907, 'The source');
  db.prepare('UPDATE articles SET structured_content = ? WHERE id = ?').run(JSON.stringify(ARTICLE), 907);
  db.prepare(
    `INSERT INTO seo_internal_links (source_article_id, target_article_id, anchor_suggestion, reason, origin, status)
     VALUES (?, ?, ?, ?, 'ai', 'approved')`,
  ).run(907, 901, 'A draft on the site', 'Related.');

  // No provider is configured in this scratch database, so reaching a model at
  // all would throw. Returning cleanly proves the held path never gets there.
  const result = await links.applyApprovedInternalLinks(907);

  assert.equal(result.inserted.length, 0);
  assert.equal(result.held.length, 1);
  assert.match(result.held[0].reason, /not published on the live site yet/);
  assert.equal(result.model, null, 'no model call, so no spend');
  assert.equal(result.articleChanged, false);
});

test('APPLY: a link already in the body is recorded as inserted, not written twice', async () => {
  const url = 'https://everyfivedays.com/how-to-make-a-laptop-workspace-ergonomic/';
  const linked = {
    ...(ARTICLE as Record<string, unknown>),
    sections: [
      { key: 'hero', heading: 'Hero', body: 'Glare is the usual culprit at a desk.' },
      {
        key: 'body',
        heading: 'What to change first',
        body: `A [laptop at eye level](${url}) fixes more than a new lamp. [[product:23]]`,
      },
    ],
  };

  seedArticle(908, 'Already linked');
  db.prepare('UPDATE articles SET structured_content = ? WHERE id = ?').run(JSON.stringify(linked), 908);
  const info = db
    .prepare(
      `INSERT INTO seo_internal_links (source_article_id, target_article_id, anchor_suggestion, reason, origin, status)
       VALUES (?, ?, ?, ?, 'ai', 'approved')`,
    )
    .run(908, 902, 'laptop at eye level', 'Related.');

  const result = await links.applyApprovedInternalLinks(908);

  assert.equal(result.alreadyPresent.length, 1);
  assert.equal(result.inserted.length, 0);
  assert.equal(result.model, null, 'already linked costs nothing');

  const row = db
    .prepare('SELECT status FROM seo_internal_links WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as { status: string };
  assert.equal(row.status, 'inserted', 'the row now matches the article');
});
