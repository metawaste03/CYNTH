/**
 * Linking older, published articles to a new one.
 *
 * What must hold:
 *   1. The live post is changed by exactly one link, and nothing else in it
 *      moves: not an existing link, not a heading, not a word.
 *   2. Only the post body is sent: no status, slug, title or author, so a
 *      published post cannot be unpublished or moved.
 *   3. Words that are not there as plain text change nothing.
 *   4. Nothing is read or spent before the cost is confirmed, and nothing at
 *      all happens for an article that is not yet live.
 *   5. A post that already links to the new article is left alone.
 *
 * NO REAL SITE OR PROVIDER IS CONTACTED. Both are stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-inbound-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const secrets = await import('../src/shared/secrets/secretStore.js');
const content = await import('../src/features/content/content.repository.js');
const connections = await import('../src/features/cms/cmsConnections.repository.js');
const roles = await import('../src/features/pipeline/roleRegistry.repository.js');
const settings = await import('../src/shared/settings/settings.repository.js');
const inbound = await import('../src/features/cms/inboundLinks.service.js');

dbModule.initializeDatabase();
const db = dbModule.getDatabase();

const SITE = 'https://wp.test';
const NEW_URL = `${SITE}/why-you-wake-at-3am/`;

const OLD_BODY = [
  '<h2>Waking at 3am is common</h2>',
  '<p>A cool bedroom helps most people fall asleep faster, and the effect is larger than most gadgets manage on their own account.</p>',
  '<p>Many readers ask about waking at 3am and whether room temperature is the cause, which it sometimes is and sometimes is not at all.</p>',
  '<p>We covered <a href="https://wp.test/other/">waking at 3am in winter</a> before, and the advice there about bedding still holds up well today.</p>',
  '[efd_product id="7"]',
].join('\n');

/* ------------------------------------------------------------ fake site */

const posts = new Map<string, string>([
  ['101', OLD_BODY],
  ['102', `<p>Short.</p>\n<p>This one already points readers to <a href="${NEW_URL}">the 3am guide</a> in its second paragraph, so it needs nothing more.</p>`],
  ['103', '<p>An article about standing desks and nothing else, written at enough length to count as a real paragraph for the test.</p>\n<p>Second paragraph, still about desks and monitor arms and cable trays, with no mention of the night at all anywhere.</p>'],
]);
const wpWrites: { id: string; body: any }[] = [];
let modelCalls = 0;
let modelReply = '{"paragraph": 2, "anchor": "waking at 3am"}';

globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  const url = String(input);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (url.startsWith(SITE)) {
    const id = url.match(/\/posts\/(\d+)/)?.[1] ?? '';
    if (!posts.has(id)) return json({ code: 'rest_post_invalid_id', message: 'Invalid post ID.' }, 404);
    if ((init.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init.body));
      wpWrites.push({ id, body });
      posts.set(id, body.content);
    }
    return json({ id: Number(id), status: 'publish', link: `${SITE}/post-${id}/`, title: { rendered: 'T' }, content: { raw: posts.get(id) } });
  }

  modelCalls += 1;
  return json({ choices: [{ message: { content: modelReply } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
}) as typeof fetch;

/* -------------------------------------------------------------- fixtures */

secrets.setSecret('CYNTH_INBOUND_KEY', 'not-a-real-credential');
const providerId = Number(
  db
    .prepare(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
       VALUES ('Stub', 'openrouter', 'https://stub.test/api/v1', 'CYNTH_INBOUND_KEY', 1)`,
    )
    .run().lastInsertRowid,
);
const paidModel = Number(
  db
    .prepare(
      `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free, cost_tier)
       VALUES (?, 'stub/paid', 1, 0.000001, 0.000002, 0, 'low')`,
    )
    .run(providerId).lastInsertRowid,
);
db.prepare(`INSERT INTO ai_model_capabilities (model_id, purpose, is_default_for_purpose) VALUES (?, 'article_generation', 1)`).run(paidModel);
for (const env of ['development', 'production'] as const) {
  roles.setRoleAssignment('article_writer', env, { primaryModelId: paidModel, fallbackModelId: null });
}
settings.setSetting('generation.mode', 'production');

const connection = connections.createConnection({
  name: 'Fake live site',
  connectorType: 'wordpress',
  description: null,
  baseUrl: SITE,
  authMethod: 'application_password',
  username: 'editor',
  credential: 'abcd efgh ijkl mnop',
} as never);

const project = content.getDefaultProject()!;
const sleep = content.createTheme(project.id, { name: 'Sleep & Recovery', description: 'Sleep.' });

function article(title: string, keyword: string, externalId: string | null, url: string | null, status = 'publish'): number {
  const id = Number(
    db
      .prepare(`INSERT INTO articles (title, status, content, theme_id, project_id) VALUES (?, 'published', 'Body.', ?, ?)`)
      .run(title, sleep.id, project.id).lastInsertRowid,
  );
  db.prepare('INSERT INTO keywords (article_id, primary_keyword) VALUES (?, ?)').run(id, keyword);
  if (externalId) {
    db.prepare(
      `INSERT INTO article_cms_links (article_id, connection_id, external_id, external_status, external_url)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, connection.id, externalId, status, url);
  }
  return id;
}

const older = article('Bedroom Temperature and Waking at Night', 'bedroom temperature waking night', '101', `${SITE}/bedroom-temperature/`);
const linkedAlready = article('Waking at Night: A Sleep Checklist', 'waking night sleep checklist', '102', `${SITE}/sleep-checklist/`);
const fresh = article('Why You Wake at 3am Every Night', 'wake at 3am night', '200', NEW_URL);
const draft = article('Night Waking Draft', 'waking night', '201', `${SITE}/?p=201`, 'draft');

/* ----------------------------------------------------------------- pure */

test('WRAP: one link is added and every other character survives', () => {
  const paragraphs = inbound.listParagraphs(OLD_BODY);
  assert.equal(paragraphs.length, 3);

  const revised = inbound.wrapAnchor(OLD_BODY, paragraphs[1], 'waking at 3am', NEW_URL)!;
  const link = `<a href="${NEW_URL}">waking at 3am</a>`;
  assert.ok(revised.includes(`ask about ${link} and whether`));
  assert.equal(revised.replace(link, 'waking at 3am'), OLD_BODY);
});

test('WRAP: words inside an existing link, a heading, or part of a longer word are refused', () => {
  const paragraphs = inbound.listParagraphs(OLD_BODY);
  // Paragraph 3 only has the phrase inside its existing link.
  assert.equal(inbound.wrapAnchor(OLD_BODY, paragraphs[2], 'waking at 3am in winter', NEW_URL), null);
  // Not what the paragraph says.
  assert.equal(inbound.wrapAnchor(OLD_BODY, paragraphs[0], 'waking at 3am', NEW_URL), null);
  // "cool bed" would cut "bedroom" in half.
  assert.equal(inbound.wrapAnchor(OLD_BODY, paragraphs[0], 'cool bed', NEW_URL), null);
  // The heading is never offered as a paragraph at all.
  assert.ok(!paragraphs.some((paragraph) => paragraph.text.startsWith('Waking at 3am is common')));
});

test('CHOICE: an answer outside the rules is no answer', () => {
  assert.deepEqual(inbound.parseAnchorChoice('{"paragraph": 2, "anchor": "waking at 3am"}', 3), { paragraph: 1, anchor: 'waking at 3am' });
  assert.equal(inbound.parseAnchorChoice('{"paragraph": null, "anchor": null}', 3), null);
  assert.equal(inbound.parseAnchorChoice('{"paragraph": 1, "anchor": "a cool bedroom"}', 3), null, 'never the first paragraph');
  assert.equal(inbound.parseAnchorChoice('{"paragraph": 9, "anchor": "waking at 3am"}', 3), null);
  assert.equal(inbound.parseAnchorChoice('{"paragraph": 2, "anchor": "here"}', 3), null);
  assert.equal(inbound.parseAnchorChoice('I could not decide.', 3), null);
});

/* ----------------------------------------------------------------- flow */

test('SPEND: nothing is read or spent until the cost is confirmed', async () => {
  await assert.rejects(inbound.linkOlderArticlesTo(fresh, { modelId: paidModel }), (error: any) => error.code === 'cost_confirmation_required');
  assert.equal(modelCalls, 0);
  assert.equal(wpWrites.length, 0);
});

test('NOT LIVE: an unpublished article gets no inbound links', async () => {
  await assert.rejects(inbound.linkOlderArticlesTo(draft, { confirmedCost: true, modelId: paidModel }), /not published on the live site/);
  assert.equal(wpWrites.length, 0);
});

test('LINK: the older live post gains one link, and only its body is sent', async () => {
  const result = await inbound.linkOlderArticlesTo(fresh, { confirmedCost: true, modelId: paidModel });

  assert.deepEqual(result.linked.map((entry) => entry.articleId), [older]);
  assert.deepEqual(result.alreadyLinked.map((entry) => entry.articleId), [linkedAlready]);
  assert.equal(result.url, NEW_URL);

  // One write, to the right post, carrying the body and nothing else.
  assert.equal(wpWrites.length, 1);
  assert.equal(wpWrites[0].id, '101');
  assert.deepEqual(Object.keys(wpWrites[0].body), ['content']);

  const link = `<a href="${NEW_URL}">waking at 3am</a>`;
  assert.equal(posts.get('101')!.replace(link, 'waking at 3am'), OLD_BODY);

  // The already-linking post cost nothing.
  assert.equal(modelCalls, 1);

  const recorded = db
    .prepare(`SELECT status, anchor_suggestion FROM seo_internal_links WHERE source_article_id = ? AND target_article_id = ?`)
    .get(older, fresh) as { status: string; anchor_suggestion: string };
  assert.equal(recorded.status, 'inserted');
  assert.equal(recorded.anchor_suggestion, 'waking at 3am');

  const history = db.prepare(`SELECT operation, status FROM cms_push_history WHERE article_id = ?`).all(older) as any[];
  assert.deepEqual(history.map((row) => [row.operation, row.status]), [['inbound_link', 'success']]);
});

test('AGAIN: a second run finds the link there and changes nothing', async () => {
  const before = posts.get('101');
  const result = await inbound.linkOlderArticlesTo(fresh, { confirmedCost: true, modelId: paidModel });
  assert.equal(result.linked.length, 0);
  assert.equal(result.alreadyLinked.length, 2);
  assert.equal(posts.get('101'), before);
  assert.equal(wpWrites.length, 1);
});

test('NO FIT: words the post does not contain leave it untouched', async () => {
  const desks = article('Waking Night Desk Notes', 'night waking desk', '103', `${SITE}/desk-notes/`);
  const target = article('Night Waking and Magnesium', 'night waking magnesium', '300', `${SITE}/magnesium/`);
  const before = posts.get('103');
  modelReply = '{"paragraph": 2, "anchor": "magnesium before bed"}';

  const result = await inbound.linkOlderArticlesTo(target, { confirmedCost: true, modelId: paidModel, limit: 5 });
  const skipped = result.skipped.find((entry) => entry.articleId === desks)!;
  assert.match(skipped.reason, /Nothing was changed/);
  assert.equal(posts.get('103'), before);
  assert.ok(!result.linked.some((entry) => entry.articleId === desks));
});
