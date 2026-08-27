/**
 * WordPress connection, Article -> Draft mapping, and the push lifecycle.
 *
 * NO REAL WORDPRESS SITE IS EVER CONTACTED and nothing is ever published:
 * the CMS is a local mock on 127.0.0.1, the credential is a literal test
 * string, and the mock asserts for itself that every write it receives asks
 * for a draft.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';

/* ------------------------------------------------------------------ setup */

const SCRATCH = path.join(os.tmpdir(), `cynth-wp-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;

const dbModule = await import('../src/shared/database/index.js');
const articlesRepo = await import('../src/features/articles/articles.repository.js');
const connections = await import('../src/features/cms/cmsConnections.repository.js');
const links = await import('../src/features/cms/cmsLinks.repository.js');
const publish = await import('../src/features/cms/cmsPublish.service.js');
const { articleBodyToHtml } = await import('../src/features/cms/articleMarkup.js');
const { wordpressConnector } = await import('../src/features/cms/connectors/wordpressConnector.js');
const secrets = await import('../src/shared/secrets/secretStore.js');

/* -------------------------------------------------------- mock WordPress */

const TEST_USERNAME = 'cynth-test';
const TEST_APP_PASSWORD = 'abcd efgh ijkl mnop qrst uvwx';
const EXPECTED_AUTH = `Basic ${Buffer.from(`${TEST_USERNAME}:${TEST_APP_PASSWORD.replace(/\s+/g, '')}`).toString('base64')}`;

interface MockPost {
  id: number;
  status: string;
  title: string;
  content: string;
  slug: string;
  author?: number;
  excerpt?: string;
}

/** Mock server state, resettable between tests. */
const state = {
  posts: new Map<number, MockPost>(),
  nextId: 100,
  /** Every write body the mock received, so tests can assert on what was sent. */
  writes: [] as Record<string, unknown>[],
  /** Forced failure modes, for the failure-path tests. */
  rejectAuth: false,
  hideRestApi: false,
  accountCanPost: true,
};

function resetMock() {
  state.posts.clear();
  state.nextId = 100;
  state.writes = [];
  state.rejectAuth = false;
  state.hideRestApi = false;
  state.accountCanPost = true;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const authorized = req.headers.authorization === EXPECTED_AUTH && !state.rejectAuth;

    // --- REST API discovery (unauthenticated on purpose) ---
    if (url.pathname === '/wp-json' || url.pathname === '/wp-json/') {
      if (state.hideRestApi) return send(res, 404, { code: 'rest_no_route', message: 'No route was found.' });
      return send(res, 200, { name: 'Mock EveryFiveDays', namespaces: ['oembed/1.0', 'wp/v2'] });
    }

    // --- current user ---
    if (url.pathname === '/wp-json/wp/v2/users/me') {
      if (!authorized) {
        return send(res, 401, { code: 'incorrect_password', message: 'The password you entered is incorrect.' });
      }
      return send(res, 200, {
        id: 1,
        name: 'Cynth Test Account',
        capabilities: { edit_posts: state.accountCanPost },
      });
    }

    if (url.pathname === '/wp-json/wp/v2/users') {
      if (!authorized) return send(res, 401, { code: 'incorrect_password', message: 'Incorrect password.' });
      return send(res, 200, [
        { id: 1, name: 'Cynth Test Account', slug: 'cynth-test' },
        { id: 7, name: 'Editorial Desk', slug: 'editorial' },
      ]);
    }

    // --- posts ---
    if (url.pathname === '/wp-json/wp/v2/posts' && req.method === 'POST') {
      if (!authorized) return send(res, 401, { code: 'incorrect_password', message: 'Incorrect password.' });

      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      state.writes.push(body);

      // THE SAFETY ASSERTION, enforced by the CMS side rather than trusted
      // from the client: Cynth must never ask this endpoint to publish.
      assert.equal(body.status, 'draft', 'Cynth must only ever create drafts');

      const post: MockPost = {
        id: state.nextId++,
        status: 'draft',
        title: String(body.title ?? ''),
        content: String(body.content ?? ''),
        slug: String(body.slug ?? ''),
        author: body.author as number | undefined,
        excerpt: body.excerpt as string | undefined,
      };
      state.posts.set(post.id, post);
      return send(res, 201, serializePost(post));
    }

    const postMatch = url.pathname.match(/^\/wp-json\/wp\/v2\/posts\/(\d+)$/);
    if (postMatch) {
      if (!authorized) return send(res, 401, { code: 'incorrect_password', message: 'Incorrect password.' });

      const id = Number(postMatch[1]);
      const existing = state.posts.get(id);
      if (!existing) return send(res, 404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' });

      if (req.method === 'GET') return send(res, 200, serializePost(existing));

      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      state.writes.push(body);
      assert.equal(body.status, 'draft', 'Cynth must only ever write drafts');

      existing.title = String(body.title ?? existing.title);
      existing.content = String(body.content ?? existing.content);
      if (body.slug !== undefined) existing.slug = String(body.slug);
      return send(res, 200, serializePost(existing));
    }

    send(res, 404, { code: 'rest_no_route', message: 'No route was found matching the URL.' });
  });
});

function serializePost(post: MockPost) {
  return {
    id: post.id,
    status: post.status,
    title: { rendered: post.title, raw: post.title },
    content: { rendered: post.content, raw: post.content },
    slug: post.slug,
    link: `http://mock.local/?p=${post.id}`,
    modified_gmt: '2026-08-27T10:00:00',
  };
}

await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
const MOCK_PORT = (mock.address() as AddressInfo).port;
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`;

/* --------------------------------------------------------------- fixtures */

dbModule.initializeDatabase();
const db = () => dbModule.getDatabase();

const connection = connections.createConnection({
  name: 'Mock EveryFiveDays',
  connectorType: 'wordpress',
  description: 'Local mock for tests.',
  baseUrl: MOCK_BASE,
  authMethod: 'application_password',
  username: TEST_USERNAME,
  credential: TEST_APP_PASSWORD,
});

const GENERATED_BODY = [
  '# How Five Days Works',
  '',
  'A first paragraph with **bold** and *italic* text.',
  '',
  '## A subheading',
  '',
  '- First point',
  '- Second point',
  '',
  '> A quoted line.',
].join('\n');

function makeGeneratedArticle(title: string) {
  const article = articlesRepo.createArticleDraft({
    articleTypeId: 1,
    authorId: null,
    productId: null,
    projectId: null,
    themeId: null,
    topicId: null,
    title,
    topic: 'Testing',
    targetAudience: null,
    searchIntent: null,
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: null,
    secondaryKeywords: null,
  } as never);

  articlesRepo.saveGeneratedArticle(article.id, {
    title: 'A Model-Written Title',
    content: GENERATED_BODY,
    provider: 'Mock Provider',
    model: 'mock-model',
  });

  return articlesRepo.getArticleById(article.id)!;
}

test.after(() => {
  mock.close();
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

/* ====================== content mapping (markup) ======================== */

test('MAPPING: the generated body is rendered to HTML, not sent as raw Markdown', () => {
  const html = articleBodyToHtml(GENERATED_BODY);

  assert.match(html, /<h1>How Five Days Works<\/h1>/);
  assert.match(html, /<h2>A subheading<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<ul>[\s\S]*<li>First point<\/li>/);
  assert.match(html, /<blockquote><p>A quoted line\.<\/p><\/blockquote>/);
  assert.ok(!html.includes('##'), 'no Markdown markers survive into the post');
});

test('MAPPING: HTML in the source is escaped, never injected into a post', () => {
  const html = articleBodyToHtml('A paragraph with <script>alert(1)</script> in it.');
  assert.ok(!html.includes('<script>'), 'script tags must not reach WordPress');
  assert.match(html, /&lt;script&gt;/);
});

test('MAPPING: only http(s) and root-relative links are linkified', () => {
  assert.match(articleBodyToHtml('[ok](https://example.com)'), /<a href="https:\/\/example\.com">ok<\/a>/);
  assert.match(articleBodyToHtml('[rel](/about)'), /<a href="\/about">rel<\/a>/);

  const dangerous = articleBodyToHtml('[bad](javascript:alert(1))');
  assert.ok(!dangerous.includes('<a href'), 'a javascript: target is never turned into a link');
});

test('MAPPING: ordinary prose containing numbers survives inline formatting', () => {
  // Regression: an earlier code-span placeholder was a bare number, which
  // rewrote sentences like this one.
  const html = articleBodyToHtml('I have 3 cats and 12 fish.');
  assert.match(html, /<p>I have 3 cats and 12 fish\.<\/p>/);
});

/* ==================== Article -> Draft field mapping ==================== */

test('MAPPING: Cynth fields map onto the CMS payload, and nothing is invented', () => {
  const article = makeGeneratedArticle('An Editor Working Title');
  const payload = publish.buildDraftPayload(article, connections.getConnectionById(connection.id)!);

  assert.equal(payload.title, 'An Editor Working Title', 'the editor’s working title wins');
  assert.equal(payload.status, 'draft', 'the status is always draft');
  assert.equal(payload.slug, article.slug, 'Cynth’s own slug is sent');
  assert.ok(payload.content.includes('<h1>'), 'the body is the rendered article');

  // The two Cynth has no authoritative value for.
  assert.equal(payload.excerpt, null, 'no excerpt is invented');
  assert.equal(payload.seo, null, 'SEO metadata is the next milestone’s to supply');
});

test('MAPPING: the model’s title is used only when there is no working title', () => {
  const article = makeGeneratedArticle('');
  const payload = publish.buildDraftPayload(article, connections.getConnectionById(connection.id)!);
  assert.equal(payload.title, 'A Model-Written Title');
});

test('MAPPING: an ungenerated article cannot be pushed at all', () => {
  const article = articlesRepo.createArticleDraft({
    articleTypeId: 1,
    authorId: null,
    productId: null,
    projectId: null,
    themeId: null,
    topicId: null,
    title: 'Nothing generated yet',
    topic: null,
    targetAudience: null,
    searchIntent: null,
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: null,
    secondaryKeywords: null,
  } as never);

  assert.throws(
    () => publish.buildDraftPayload(articlesRepo.getArticleById(article.id)!, connections.getConnectionById(connection.id)!),
    (err: any) => err.code === 'article_not_generated',
  );
});

/* ======================== connection testing ============================ */

test('CONNECTION: a healthy site authenticates and reports it can create drafts', async () => {
  resetMock();
  const result = await publish.testConnection(connection.id);

  assert.equal(result.ok, true);
  assert.equal(result.stage, 'ok');
  assert.equal(result.siteName, 'Mock EveryFiveDays');
  assert.equal(result.authenticatedAs, 'Cynth Test Account');
  assert.equal(result.canCreateDrafts, true);
  assert.equal(state.writes.length, 0, 'a connection test must never write anything');
  assert.equal(state.posts.size, 0, 'a connection test must never create a post');
});

test('CONNECTION: an authentication failure is reported as such, not as a network problem', async () => {
  resetMock();
  state.rejectAuth = true;

  const result = await publish.testConnection(connection.id);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'authentication', 'the stage names the credential, not the connection');
  assert.match(result.message, /credential/i);
  assert.equal(state.posts.size, 0);
});

test('CONNECTION: an unreachable site is a connection failure, not an auth failure', async () => {
  resetMock();
  // A port nothing is listening on.
  const dead = connections.createConnection({
    name: 'Unreachable Site',
    connectorType: 'wordpress',
    description: null,
    baseUrl: 'http://127.0.0.1:9',
    authMethod: 'application_password',
    username: TEST_USERNAME,
    credential: TEST_APP_PASSWORD,
  });

  const result = await publish.testConnection(dead.id);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'connection', 'unreachable is distinct from unauthenticated');

  connections.deleteConnection(dead.id);
});

test('CONNECTION: a site whose REST API is unavailable is an API failure', async () => {
  resetMock();
  state.hideRestApi = true;

  const result = await publish.testConnection(connection.id);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'api', 'a missing REST API is its own diagnosis');
});

test('CONNECTION: an account that cannot post is an authorization failure', async () => {
  resetMock();
  state.accountCanPost = false;

  const result = await publish.testConnection(connection.id);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'authorization', 'authenticating is not the same as being allowed to post');
  assert.match(result.message, /cannot create posts/i);
});

test('CONNECTION: a connection with no stored credential fails before any request', async () => {
  resetMock();
  const bare = connections.createConnection({
    name: 'No Credential',
    connectorType: 'wordpress',
    description: null,
    baseUrl: MOCK_BASE,
    authMethod: 'application_password',
    username: TEST_USERNAME,
    credential: undefined,
  });

  const result = await publish.testConnection(bare.id);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'configuration');
  assert.match(result.message, /no credentials/i);

  connections.deleteConnection(bare.id);
});

test('CONNECTION: the result is recorded on the connection for the settings screen', async () => {
  resetMock();
  await publish.testConnection(connection.id);

  const stored = connections.getConnectionById(connection.id)!;
  assert.equal(stored.lastStatus, 'ok');
  assert.equal(stored.lastStage, 'ok');
  assert.ok(stored.lastCheckedAt);
});

/* ============================ pushing =================================== */

test('PUSH: an article becomes a WordPress DRAFT, and the post id is persisted', async () => {
  resetMock();
  const article = makeGeneratedArticle('First Push Article');

  const result = await publish.pushArticle(article.id, connection.id, 'create');

  assert.equal(result.operation, 'create');
  assert.equal(result.post.status, 'draft', 'the created post is a draft');
  assert.equal(state.posts.size, 1);

  // PART 15: the article knows where it went.
  const link = links.getLink(article.id, connection.id)!;
  assert.equal(link.externalId, result.post.id);
  assert.equal(link.externalStatus, 'draft');
  assert.equal(link.siteUrl, MOCK_BASE);
  assert.ok(link.firstPushedAt);
  assert.ok(link.lastPushedAt);

  // And so does the Article record itself.
  const reloaded = articlesRepo.getArticleById(article.id)!;
  assert.equal(reloaded.cmsLinks.length, 1);
  assert.equal(reloaded.cmsLinks[0].externalId, result.post.id);
});

test('PUSH: the article’s own status is untouched — pushing is not publishing', async () => {
  resetMock();
  const article = makeGeneratedArticle('Status Untouched');

  await publish.pushArticle(article.id, connection.id, 'create');

  assert.equal(articlesRepo.getArticleById(article.id)!.status, 'draft', 'the Cynth article stays a draft');
  assert.equal([...state.posts.values()][0].status, 'draft', 'and so does the WordPress post');
});

test('PUSH: the mapped fields arrive at WordPress intact', async () => {
  resetMock();
  const article = makeGeneratedArticle('Mapped Fields Article');

  await publish.pushArticle(article.id, connection.id, 'create');

  const sent = state.writes[0];
  assert.equal(sent.title, 'Mapped Fields Article');
  assert.equal(sent.status, 'draft');
  assert.equal(sent.slug, articlesRepo.getArticleById(article.id)!.slug);
  assert.ok(String(sent.content).includes('<h1>'));
  assert.equal(sent.excerpt, undefined, 'an absent excerpt is omitted, not sent empty');
  assert.equal(sent.author, undefined, 'no author is asserted without a configured mapping');
});

test('PUSH: a configured author mapping is applied', async () => {
  resetMock();
  connections.setConnectionAuthorMapping(connection.id, '7', 'Editorial Desk');

  const article = makeGeneratedArticle('Attributed Article');
  await publish.pushArticle(article.id, connection.id, 'create');

  assert.equal(state.writes[0].author, 7);

  connections.setConnectionAuthorMapping(connection.id, null, null);
});

/* ==================== DUPLICATE PROTECTION ============================== */

test('DUPLICATES: pushing twice with mode "create" is refused, not duplicated', async () => {
  resetMock();
  const article = makeGeneratedArticle('No Duplicates Article');

  await publish.pushArticle(article.id, connection.id, 'create');
  assert.equal(state.posts.size, 1);

  await assert.rejects(
    () => publish.pushArticle(article.id, connection.id, 'create'),
    (err: any) => err.code === 'already_pushed',
    'a second create must be refused',
  );

  assert.equal(state.posts.size, 1, 'and no second post may exist on the site');
  assert.equal(links.listLinksForArticle(article.id).length, 1);
});

test('DUPLICATES: the preflight says "update" once an article has been pushed', async () => {
  resetMock();
  const article = makeGeneratedArticle('Preflight Action Article');

  const before = publish.getPushPreflight(article.id, connection.id);
  assert.equal(before.action, 'create', 'a fresh article creates');
  assert.equal(before.link, null);

  await publish.pushArticle(article.id, connection.id, 'create');

  const after = publish.getPushPreflight(article.id, connection.id);
  assert.equal(after.action, 'update', 'once pushed, the only honest action is update');
  assert.ok(after.link, 'and the existing post is named');
  assert.equal(after.link!.externalStatus, 'draft');
});

test('UPDATE: updating modifies the existing post in place', async () => {
  resetMock();
  const article = makeGeneratedArticle('Updatable Article');

  const created = await publish.pushArticle(article.id, connection.id, 'create');

  articlesRepo.saveGeneratedArticle(article.id, {
    title: 'Rewritten',
    content: '# Rewritten Heading\n\nRewritten body.',
    provider: 'Mock Provider',
    model: 'mock-model',
  });

  const updated = await publish.pushArticle(article.id, connection.id, 'update');

  assert.equal(updated.operation, 'update');
  assert.equal(updated.post.id, created.post.id, 'the same post id');
  assert.equal(state.posts.size, 1, 'and still exactly one post on the site');
  assert.match(state.posts.get(Number(created.post.id))!.content, /Rewritten Heading/);
  assert.equal(state.posts.get(Number(created.post.id))!.status, 'draft', 'still a draft');
});

test('UPDATE: updating an article that was never pushed is refused, not silently created', async () => {
  resetMock();
  const article = makeGeneratedArticle('Never Pushed Article');

  await assert.rejects(
    () => publish.pushArticle(article.id, connection.id, 'update'),
    (err: any) => err.code === 'not_pushed_yet',
  );
  assert.equal(state.posts.size, 0, 'nothing was created as a fallback');
});

test('UPDATE: Cynth refuses to modify a post a human has published', async () => {
  resetMock();
  const article = makeGeneratedArticle('Published Elsewhere Article');

  const created = await publish.pushArticle(article.id, connection.id, 'create');

  // A human publishes it in WordPress.
  state.posts.get(Number(created.post.id))!.status = 'publish';
  const writesBefore = state.writes.length;

  await assert.rejects(
    () => publish.pushArticle(article.id, connection.id, 'update'),
    (err: any) => err.code === 'remote_post_published',
    'a live post is not Cynth’s to overwrite',
  );

  assert.equal(state.writes.length, writesBefore, 'no write was attempted');
  assert.equal(state.posts.get(Number(created.post.id))!.status, 'publish', 'and it was not unpublished either');
});

test('UPDATE: a post deleted in WordPress is reported, not silently recreated', async () => {
  resetMock();
  const article = makeGeneratedArticle('Deleted Remotely Article');

  const created = await publish.pushArticle(article.id, connection.id, 'create');
  state.posts.delete(Number(created.post.id));

  await assert.rejects(
    () => publish.pushArticle(article.id, connection.id, 'update'),
    (err: any) => err.code === 'remote_post_missing',
  );

  // But a deliberate create is then allowed, so the article is not stuck.
  const recreated = await publish.pushArticle(article.id, connection.id, 'create');
  assert.equal(recreated.operation, 'create');
  assert.equal(links.listLinksForArticle(article.id).length, 1, 'still one link, now pointing at the new post');
});

test('REFRESH: re-reading picks up a status a human changed in WordPress', async () => {
  resetMock();
  const article = makeGeneratedArticle('Refreshable Article');

  const created = await publish.pushArticle(article.id, connection.id, 'create');
  state.posts.get(Number(created.post.id))!.status = 'publish';

  const refreshed = await publish.refreshLink(article.id, connection.id);
  assert.equal(refreshed!.externalStatus, 'publish', 'Cynth reflects what the CMS actually says');
});

/* ============================ history =================================== */

test('HISTORY: pushes, updates and failures are all recorded', async () => {
  resetMock();
  const article = makeGeneratedArticle('History Article');

  await publish.pushArticle(article.id, connection.id, 'create');
  await publish.pushArticle(article.id, connection.id, 'update');
  await assert.rejects(() => publish.pushArticle(article.id, connection.id, 'create'));

  const history = links.listPushHistoryForArticle(article.id);
  const operations = history.map((entry) => `${entry.operation}:${entry.status}`);

  assert.ok(operations.includes('create:success'), 'the first push is recorded');
  assert.ok(operations.includes('update:success'), 'the update is recorded');
  assert.ok(operations.includes('create:failure'), 'the refused duplicate is recorded too');

  for (const entry of history) {
    assert.equal(entry.siteUrl, MOCK_BASE);
    assert.equal(entry.connectionName, 'Mock EveryFiveDays');
  }
});

/* =========================== authors ==================================== */

test('AUTHORS: the site’s users can be listed for the author mapping', async () => {
  resetMock();
  const authors = await publish.listRemoteAuthors(connection.id);

  assert.equal(authors.length, 2);
  assert.equal(authors[1].name, 'Editorial Desk');
  assert.equal(state.writes.length, 0, 'listing users writes nothing');
});

/* =========================== security =================================== */

test('SECURITY: the credential is never stored in the database', () => {
  const dump =
    JSON.stringify(db().prepare('SELECT * FROM cms_connections').all()) +
    JSON.stringify(db().prepare('SELECT * FROM article_cms_links').all()) +
    JSON.stringify(db().prepare('SELECT * FROM cms_push_history').all()) +
    JSON.stringify(db().prepare('SELECT * FROM articles').all());

  assert.ok(!dump.includes(TEST_APP_PASSWORD), 'the application password must never be persisted');
  assert.ok(!dump.includes(TEST_APP_PASSWORD.replace(/\s+/g, '')), 'nor its unspaced form');
  assert.ok(!dump.includes(EXPECTED_AUTH), 'nor the encoded authorization header');
  assert.ok(dump.includes('CYNTH_CMS_'), 'only the env var NAME is stored');
});

test('SECURITY: no connection DTO carries the credential', () => {
  const dump = JSON.stringify(connections.listConnections());
  assert.ok(!dump.includes(TEST_APP_PASSWORD));
  assert.ok(!dump.includes(TEST_APP_PASSWORD.replace(/\s+/g, '')));

  const stored = connections.getConnectionById(connection.id)!;
  assert.equal(stored.hasCredential, true, 'only whether one is set is exposed');
});

test('SECURITY: the preflight and push results carry no credential', async () => {
  resetMock();
  const article = makeGeneratedArticle('Security Article');

  const preflight = publish.getPushPreflight(article.id, connection.id);
  assert.ok(!JSON.stringify(preflight).includes(TEST_APP_PASSWORD.replace(/\s+/g, '')));

  const result = await publish.pushArticle(article.id, connection.id, 'create');
  assert.ok(!JSON.stringify(result).includes(TEST_APP_PASSWORD.replace(/\s+/g, '')));
});

test('SECURITY: an application password echoed back by the CMS is redacted', async () => {
  const { sanitizeCmsMessage } = await import('../src/features/cms/cms.errors.js');

  const leaked = sanitizeCmsMessage(
    `Login failed for ${TEST_USERNAME} with password ${TEST_APP_PASSWORD}`,
    [TEST_APP_PASSWORD, TEST_USERNAME],
  );
  assert.ok(!leaked.includes(TEST_APP_PASSWORD), 'the password is stripped from CMS wording');
  assert.match(leaked, /REDACTED/);
});

/* ================= connector-level draft-only guarantee ================= */

test('SAFETY: the connector contract has no way to publish', () => {
  // Enforced by shape, not by remembering to avoid a method.
  assert.equal(typeof (wordpressConnector as never as Record<string, unknown>).publish, 'undefined');
  assert.equal(typeof (wordpressConnector as never as Record<string, unknown>).setStatus, 'undefined');
  assert.equal(typeof wordpressConnector.createDraft, 'function');
  assert.equal(typeof wordpressConnector.updateDraft, 'function');
});

test('SAFETY: every write the mock received asked for a draft', () => {
  // The mock asserts this per-request as well; this is the cumulative check.
  for (const write of state.writes) {
    assert.equal(write.status, 'draft');
  }
});

test('SECRETS: the secret store keeps values out of the database entirely', () => {
  const envVar = connections.getConnectionById(connection.id)!.credentialEnvVar!;
  assert.equal(secrets.hasSecret(envVar), true);
  assert.equal(secrets.getSecret(envVar), TEST_APP_PASSWORD, 'the value lives only in the environment');

  const row = db().prepare('SELECT * FROM cms_connections WHERE id = ?').get(connection.id) as Record<string, unknown>;
  assert.equal(row.credential_env_var, envVar);
  assert.ok(!JSON.stringify(row).includes(TEST_APP_PASSWORD));
});
