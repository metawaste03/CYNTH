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
// Without this, every connection these tests create wrote its credential into
// the developer's real app/server/.env.local under CYNTH_CMS_<id>_CREDENTIAL —
// and the scratch database's ids overlap the real ones, so a test could
// overwrite (or delete) a real site's password.
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const articlesRepo = await import('../src/features/articles/articles.repository.js');
const connections = await import('../src/features/cms/cmsConnections.repository.js');
const links = await import('../src/features/cms/cmsLinks.repository.js');
const publish = await import('../src/features/cms/cmsPublish.service.js');
const { articleBodyToHtml } = await import('../src/features/cms/articleMarkup.js');
const { wordpressConnector } = await import('../src/features/cms/connectors/wordpressConnector.js');
const secrets = await import('../src/shared/secrets/secretStore.js');
const seoAnalysis = await import('../src/features/seo/seoAnalysis.service.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const mediaRepo = await import('../src/features/media/media.repository.js');
const content = await import('../src/features/content/content.repository.js');
const { MEDIA_IMAGES_DIR, ensureMediaUploadsDir } = await import('../src/features/media/media.upload.js');

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
  featuredMedia?: number;
  categories?: number[];
}

interface MockCategory {
  id: number;
  name: string;
  slug: string;
}

interface MockMedia {
  id: number;
  filename: string | null;
  mimeType: string;
  bytes: number;
  altText: string | null;
}

/** Mock server state, resettable between tests. */
const state = {
  posts: new Map<number, MockPost>(),
  media: new Map<number, MockMedia>(),
  /** The site's existing categories. Cynth may match these; it may never add one. */
  categories: new Map<number, MockCategory>(),
  nextId: 100,
  nextMediaId: 500,
  /** Every write body the mock received, so tests can assert on what was sent. */
  writes: [] as Record<string, unknown>[],
  /** Forced failure modes, for the failure-path tests. */
  rejectAuth: false,
  hideRestApi: false,
  accountCanPost: true,
  /** When false the media endpoint refuses, so the "upload fails" path can be tested. */
  acceptUploads: true,
  /** Pretends a human edited the post in WordPress at this time. */
  modifiedOverride: null as string | null,
};

function resetMock() {
  state.posts.clear();
  state.media.clear();
  state.categories.clear();
  // The five areas EveryFiveDays publishes. "Sleep &amp; Recovery" is stored
  // entity-encoded exactly as WordPress stores it, which is the whole reason
  // the connector decodes before comparing.
  for (const [id, name] of [
    [11, 'Smart Pet Care'],
    [12, 'Cognitive Performance'],
    [13, 'Fitness Technology'],
    [14, 'Productive Workspaces'],
    [15, 'Sleep &amp; Recovery'],
  ] as [number, string][]) {
    state.categories.set(id, { id, name, slug: String(name).toLowerCase().replace(/[^a-z]+/g, '-') });
  }
  state.nextId = 100;
  state.nextMediaId = 500;
  state.writes = [];
  state.rejectAuth = false;
  state.hideRestApi = false;
  state.accountCanPost = true;
  state.acceptUploads = true;
  state.modifiedOverride = null;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const mock = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const rawBuffer = Buffer.concat(chunks);
    const raw = rawBuffer.toString('utf8');
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

    // --- media ---
    // A featured image arrives as a raw body with the filename in
    // content-disposition, which is what the REST API accepts and what saves
    // the connector assembling a multipart request by hand.
    if (url.pathname === '/wp-json/wp/v2/media' && req.method === 'POST') {
      if (!authorized) return send(res, 401, { code: 'incorrect_password', message: 'Incorrect password.' });
      if (!state.acceptUploads) {
        return send(res, 403, { code: 'rest_cannot_create', message: 'Sorry, you are not allowed to upload files.' });
      }

      const disposition = String(req.headers['content-disposition'] ?? '');
      const media = {
        id: state.nextMediaId++,
        filename: /filename="([^"]*)"/.exec(disposition)?.[1] ?? null,
        mimeType: String(req.headers['content-type'] ?? ''),
        bytes: rawBuffer.length,
        altText: null as string | null,
      };
      state.media.set(media.id, media);
      return send(res, 201, { id: media.id, source_url: `http://mock.local/uploads/${media.filename}` });
    }

    const mediaMatch = url.pathname.match(/^\/wp-json\/wp\/v2\/media\/(\d+)$/);
    if (mediaMatch) {
      if (!authorized) return send(res, 401, { code: 'incorrect_password', message: 'Incorrect password.' });
      const media = state.media.get(Number(mediaMatch[1]));
      if (!media) return send(res, 404, { code: 'rest_post_invalid_id', message: 'Invalid attachment ID.' });

      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      if (typeof body.alt_text === 'string') media.altText = body.alt_text;
      return send(res, 200, { id: media.id, alt_text: media.altText });
    }

    // --- categories ---
    //
    // Read-only ON PURPOSE. There is no POST handler here, so a connector that
    // tried to create a category would get a 404 rather than quietly adding a
    // term nobody asked for — the "Sleeping Gadget" beside "Sleeping Gadgets"
    // failure, caught by the shape of the mock rather than by a reviewer.
    if (url.pathname === '/wp-json/wp/v2/categories') {
      if (req.method !== 'GET') {
        return send(res, 404, { code: 'rest_no_route', message: 'No route was found.' });
      }
      // WordPress stores a term name RAW and renders it encoded in REST
      // output, so a search matches the decoded text while the response
      // carries "Sleep &amp; Recovery". The mock reproduces both halves,
      // because the connector has to survive both.
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const plain = (value: string) => value.replace(/&amp;/g, '&').toLowerCase();
      const hits = [...state.categories.values()].filter(
        (term) => !search || plain(term.name).includes(plain(search)),
      );
      return send(res, 200, hits);
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
        categories: Array.isArray(body.categories) ? (body.categories as number[]) : undefined,
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

      /**
       * The invariant is that Cynth never PUBLISHES — not that every write
       * says "draft".
       *
       * The metadata-only paths deliberately send no status at all, and that
       * omission is precisely what makes them safe on a live article: with no
       * status in the body, WordPress leaves the post's own status alone. A
       * blanket `status === 'draft'` here would have demanded the one thing
       * those paths must not do, which is announce a status on a published
       * post.
       */
      if (body.status !== undefined) {
        assert.equal(body.status, 'draft', 'Cynth must never write a status other than draft');
      }

      existing.title = String(body.title ?? existing.title);
      existing.content = String(body.content ?? existing.content);
      if (body.slug !== undefined) existing.slug = String(body.slug);
      if (body.excerpt !== undefined) existing.excerpt = String(body.excerpt);
      if (body.featured_media !== undefined) existing.featuredMedia = Number(body.featured_media);
      // As WordPress does: a status in the body IS the post's status from now
      // on. The mock used to ignore it, which is how a live update that
      // unpublished the post passed every test.
      if (body.status !== undefined) existing.status = String(body.status);
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
    // Fixed and in the past, so "was this edited in WordPress since Cynth
    // last pushed it?" answers no unless a test says otherwise.
    modified_gmt: state.modifiedOverride ?? '2026-08-27T10:00:00',
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

/**
 * A generated article that has passed the SEO gate.
 *
 * The deterministic SEO analysis is run deliberately rather than the gate
 * being switched off: since Milestone 14 an article reaches a CMS by way of
 * SEO review, and these tests should exercise the flow the application
 * actually has. The analysis is deterministic only, so NO AI PROVIDER IS
 * CONTACTED and nothing here can cost money.
 */
async function makeGeneratedArticle(title: string, authorId: number | null = null, themeId: number | null = null) {
  const article = articlesRepo.createArticleDraft({
    articleTypeId: 1,
    authorId,
    productId: null,
    projectId: null,
    themeId,
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

  await seoAnalysis.runSeoAnalysis(article.id);
  return articlesRepo.getArticleById(article.id)!;
}

/**
 * A generated article carrying a real featured image on disk.
 *
 * A genuine file, not a stub record: the connector reads bytes at upload
 * time, so a test that never wrote a file would pass while proving nothing
 * about the path that matters.
 */
async function makeGeneratedArticleWithImage(
  title: string,
  filename: string,
  altText: string | null,
  options: { deleteFile?: boolean } = {},
) {
  const article = await makeGeneratedArticle(title);

  ensureMediaUploadsDir();
  const stored = `${Date.now()}-${filename}`;
  const filePath = path.join(MEDIA_IMAGES_DIR, stored);
  // A one-pixel PNG. Small, but real bytes with a real signature.
  fs.writeFileSync(
    filePath,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  );

  const asset = mediaRepo.createMedia({
    filePath: `uploads/media/${stored}`,
    originalFilename: filename,
    mimeType: 'image/png',
    byteSize: fs.statSync(filePath).size,
    title: filename,
    altText,
  } as never);

  mediaRepo.attachMedia({ articleId: article.id, mediaId: asset.id, role: 'featured' });

  if (options.deleteFile) fs.rmSync(filePath, { force: true });

  return article;
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

test('MAPPING: Cynth fields map onto the CMS payload, and nothing is invented', async () => {
  const article = await makeGeneratedArticle('An Editor Working Title');
  const payload = publish.buildDraftPayload(article, connections.getConnectionById(connection.id)!);

  assert.equal(payload.title, 'An Editor Working Title', 'the editor’s working title wins');
  assert.equal(payload.status, 'draft', 'the status is always draft');
  assert.equal(payload.slug, article.slug, 'Cynth’s own slug is sent');
  assert.ok(payload.content.includes('<h1>'), 'the body is the rendered article');

  // The two Cynth has no authoritative value for.
  assert.equal(payload.excerpt, null, 'no excerpt is invented');
  // The SEO engine supplies this now (Milestone 14), but only from values a
  // human owns. This article has no SEO metadata, so none is sent — an
  // empty string here would overwrite whatever a human wrote in the CMS.
  assert.equal(payload.seo, null, 'no SEO metadata is invented when Cynth holds none');
});

test('MAPPING: the model’s title is used only when there is no working title', async () => {
  const article = await makeGeneratedArticle('');
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
  const article = await makeGeneratedArticle('First Push Article');

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
  const article = await makeGeneratedArticle('Status Untouched');

  await publish.pushArticle(article.id, connection.id, 'create');

  assert.equal(articlesRepo.getArticleById(article.id)!.status, 'draft', 'the Cynth article stays a draft');
  assert.equal([...state.posts.values()][0].status, 'draft', 'and so does the WordPress post');
});

test('PUSH: the mapped fields arrive at WordPress intact', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Mapped Fields Article');

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

  const article = await makeGeneratedArticle('Attributed Article');
  await publish.pushArticle(article.id, connection.id, 'create');

  assert.equal(state.writes[0].author, 7);

  connections.setConnectionAuthorMapping(connection.id, null, null);
});

test('PUSH: an article author’s own CMS user beats the connection default', async () => {
  resetMock();
  connections.setConnectionAuthorMapping(connection.id, '7', 'Editorial Desk');

  const author = authorsRepo.createAuthor({
    name: 'Mapped Author',
    category: 'Sleep & Recovery',
  } as never);
  dbModule
    .getDatabase()
    .prepare('UPDATE authors SET remote_author_id = ? WHERE id = ?')
    .run('42', author.id);

  const article = await makeGeneratedArticle('Attributed To Its Author', author.id);
  await publish.pushArticle(article.id, connection.id, 'create');

  assert.equal(state.writes[0].author, 42, 'the article’s own author is used, not the connection default');

  connections.setConnectionAuthorMapping(connection.id, null, null);
});

test('PUSH: an author with no mapping still falls back to the connection default', async () => {
  resetMock();
  connections.setConnectionAuthorMapping(connection.id, '7', 'Editorial Desk');

  const author = authorsRepo.createAuthor({ name: 'Unmapped Author', category: null } as never);
  const article = await makeGeneratedArticle('Falls Back', author.id);
  await publish.pushArticle(article.id, connection.id, 'create');

  assert.equal(state.writes[0].author, 7, 'an unmapped author behaves exactly as before');

  connections.setConnectionAuthorMapping(connection.id, null, null);
});

/* ==================== EXCERPT ========================================== */

test('PUSH: an authored excerpt is sent as the excerpt', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Has A Standfirst');
  dbModule
    .getDatabase()
    .prepare('UPDATE articles SET excerpt = ? WHERE id = ?')
    .run('  A short, authored standfirst.  ', article.id);

  const updated = articlesRepo.getArticleById(article.id)!;
  const payload = publish.buildDraftPayload(updated, connections.getConnectionById(connection.id)!);

  assert.equal(payload.excerpt, 'A short, authored standfirst.', 'sent, and trimmed');

  await publish.pushArticle(article.id, connection.id, 'create');
  assert.equal(state.writes[0].excerpt, 'A short, authored standfirst.');
});

test('PUSH: an article with no excerpt omits the field rather than clearing one', async () => {
  resetMock();
  const article = await makeGeneratedArticle('No Standfirst');
  const payload = publish.buildDraftPayload(article, connections.getConnectionById(connection.id)!);

  assert.equal(payload.excerpt, null);

  await publish.pushArticle(article.id, connection.id, 'create');
  assert.ok(
    !('excerpt' in state.writes[0]),
    'the key must be absent, so an excerpt written in WordPress survives a push',
  );
});

/* ==================== FEATURED IMAGE =================================== */

test('PUSH: a featured image is uploaded and attached to the draft', async () => {
  resetMock();
  const article = await makeGeneratedArticleWithImage('Has A Hero', 'hero-shot.png', 'A made bed at dawn');

  const post = await publish.pushArticle(article.id, connection.id, 'create');

  assert.equal(state.media.size, 1, 'exactly one upload');
  const media = [...state.media.values()][0];
  assert.equal(media.filename, 'hero-shot.png', 'the filename reaches WordPress');
  assert.ok(media.bytes > 0, 'the real bytes were sent');
  assert.equal(media.altText, 'A made bed at dawn', 'alt text is written when the editor wrote some');

  const stored = state.posts.get(Number(post.post.id))!;
  assert.equal(stored.featuredMedia, media.id, 'and the post points at it');
});

test('IMAGE PUSH: a published article can be given its image without being unpublished', async () => {
  /**
   * The gap this closes, found on the live site: an article was published,
   * its featured image was chosen in Cynth afterwards, and the live post had
   * no image at all. Nothing was broken — there was no path. Every ordinary
   * write this connector makes says `status: draft`, so the only way to give
   * a published article its picture would have been to unpublish it first.
   */
  resetMock();
  const article = await makeGeneratedArticleWithImage('Published Already', 'late-hero.png', 'A lit window');
  const pushed = await publish.pushArticle(article.id, connection.id, 'create');

  // The human published it in WordPress, which is where publishing happens.
  const post = state.posts.get(Number(pushed.post.id))!;
  post.status = 'publish';
  post.featuredMedia = undefined;
  state.writes.length = 0;
  state.media.clear();

  const result = await publish.pushFeaturedImage(article.id, connection.id);

  assert.equal(state.media.size, 1, 'the file was uploaded');
  assert.equal(post.featuredMedia, [...state.media.values()][0].id, 'and the post points at it');
  assert.equal(post.status, 'publish', 'the article is still published');
  assert.match(result.message, /attached to post/i);

  // The part that matters. No status was sent at all — that omission is what
  // makes this safe, because WordPress then leaves the post's own status
  // alone. Sending "draft" here would have taken a live article offline.
  for (const write of state.writes) {
    assert.equal(write.status, undefined, 'a status must never be sent on this path');
  }

  // And nothing that a reader sees was touched.
  for (const write of state.writes) {
    for (const field of ['title', 'content', 'slug', 'excerpt', 'author']) {
      assert.equal(write[field], undefined, `${field} must not be sent`);
    }
  }
});

test('IMAGE PUSH: an article with no image, or no post, is refused rather than half-done', async () => {
  resetMock();

  const noImage = await makeGeneratedArticle('No Image At All');
  await publish.pushArticle(noImage.id, connection.id, 'create');
  await assert.rejects(
    () => publish.pushFeaturedImage(noImage.id, connection.id),
    /no featured image selected/i,
  );

  const notPushed = await makeGeneratedArticleWithImage('Never Pushed', 'unsent.png', null);
  await assert.rejects(
    () => publish.pushFeaturedImage(notPushed.id, connection.id),
    /has not been pushed/i,
  );
});

test('PUSH: every write made while attaching an image still asks for a draft', async () => {
  resetMock();
  const article = await makeGeneratedArticleWithImage('Draft Only', 'x.png', null);
  await publish.pushArticle(article.id, connection.id, 'create');

  // The mock asserts this for itself on every post write, but stating it here
  // means a future change to the attach step fails on an obvious test rather
  // than inside the mock.
  for (const write of state.writes) {
    assert.equal(write.status, 'draft');
  }
});

test('PUSH: an image with no alt text is uploaded without inventing any', async () => {
  resetMock();
  const article = await makeGeneratedArticleWithImage('No Alt', 'plain.png', null);
  await publish.pushArticle(article.id, connection.id, 'create');

  const media = [...state.media.values()][0];
  assert.equal(media.altText, null, 'alt text is left unset rather than guessed at');
});

test('PUSH: a rejected upload leaves the article safely in WordPress without its image', async () => {
  resetMock();
  state.acceptUploads = false;

  const article = await makeGeneratedArticleWithImage('Upload Refused', 'nope.png', null);
  const post = await publish.pushArticle(article.id, connection.id, 'create');

  // The body is what matters and it is already there. Failing the push would
  // invite a retry that creates a second copy of an article that exists.
  const stored = state.posts.get(Number(post.post.id))!;
  assert.equal(stored.featuredMedia, undefined, 'no image attached');
  assert.ok(stored.content.length > 0, 'but the article itself arrived intact');
  assert.equal(links.listLinksForArticle(article.id).length, 1, 'and the push is recorded as a success');
});

test('PUSH: a featured image whose file has vanished does not block the push', async () => {
  resetMock();
  const article = await makeGeneratedArticleWithImage('Missing File', 'gone.png', null, { deleteFile: true });

  const payload = publish.buildDraftPayload(
    articlesRepo.getArticleById(article.id)!,
    connections.getConnectionById(connection.id)!,
  );
  assert.equal(payload.featuredImage, null, 'a record pointing at no file yields no image');

  await publish.pushArticle(article.id, connection.id, 'create');
  assert.equal(state.media.size, 0, 'nothing was uploaded');
  assert.equal(links.listLinksForArticle(article.id).length, 1, 'and the article still went');
});

/* ==================== DUPLICATE PROTECTION ============================== */

test('DUPLICATES: pushing twice with mode "create" is refused, not duplicated', async () => {
  resetMock();
  const article = await makeGeneratedArticle('No Duplicates Article');

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
  const article = await makeGeneratedArticle('Preflight Action Article');

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
  const article = await makeGeneratedArticle('Updatable Article');

  const created = await publish.pushArticle(article.id, connection.id, 'create');

  articlesRepo.saveGeneratedArticle(article.id, {
    title: 'Rewritten',
    content: '# Rewritten Heading\n\nRewritten body.',
    provider: 'Mock Provider',
    model: 'mock-model',
  });

  // The article changed, so the stored SEO analysis no longer describes it.
  // Re-running is the flow, not a workaround: the gate is configured to
  // refuse an analysis that has gone stale.
  await seoAnalysis.runSeoAnalysis(article.id);

  const updated = await publish.pushArticle(article.id, connection.id, 'update');

  assert.equal(updated.operation, 'update');
  assert.equal(updated.post.id, created.post.id, 'the same post id');
  assert.equal(state.posts.size, 1, 'and still exactly one post on the site');
  assert.match(state.posts.get(Number(created.post.id))!.content, /Rewritten Heading/);
  assert.equal(state.posts.get(Number(created.post.id))!.status, 'draft', 'still a draft');
});

test('UPDATE: updating an article that was never pushed is refused, not silently created', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Never Pushed Article');

  await assert.rejects(
    () => publish.pushArticle(article.id, connection.id, 'update'),
    (err: any) => err.code === 'not_pushed_yet',
  );
  assert.equal(state.posts.size, 0, 'nothing was created as a fallback');
});

test('UPDATE: Cynth refuses to modify a post a human has published', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Published Elsewhere Article');

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
  const article = await makeGeneratedArticle('Deleted Remotely Article');

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
  const article = await makeGeneratedArticle('Refreshable Article');

  const created = await publish.pushArticle(article.id, connection.id, 'create');
  state.posts.get(Number(created.post.id))!.status = 'publish';

  const refreshed = await publish.refreshLink(article.id, connection.id);
  assert.equal(refreshed!.externalStatus, 'publish', 'Cynth reflects what the CMS actually says');
});

/* ============================ history =================================== */

test('HISTORY: pushes, updates and failures are all recorded', async () => {
  resetMock();
  const article = await makeGeneratedArticle('History Article');

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
  const article = await makeGeneratedArticle('Security Article');

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

/* ================ the category an article is filed under ================ */

/**
 * WHY CYNTH SETS THIS AT ALL. It used to send no category, so every article
 * arrived uncategorised and a human filed it by hand. One did not match: a
 * Sleep & Recovery piece was published under Smart Pet Care, which kept it off
 * its own category page and put it on somebody else's, and nothing anywhere
 * could have caught that. Cynth already knows the thematic area — it is the
 * field the article was commissioned under.
 */

// A project to hang the themes on. Inserted directly because the content
// repository exposes no create for projects — themes are what this needs.
const projectId = Number(
  db().prepare("INSERT INTO projects (name, slug) VALUES ('Category Test Project', 'category-test')").run()
    .lastInsertRowid,
);

const petCareTheme = content.createTheme(projectId, { name: 'Smart Pet Care', description: null } as never);
const sleepTheme = content.createTheme(projectId, { name: 'Sleep & Recovery', description: null } as never);
const inventedTheme = content.createTheme(projectId, { name: 'Astrology For Cats', description: null } as never);

test('CATEGORY: an article is filed under its own thematic area', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Filed Correctly', null, petCareTheme.id);

  const created = await publish.pushArticle(article.id, connection.id, 'create');

  const sent = state.writes[state.writes.length - 1];
  assert.deepEqual(sent.categories, [11], 'the id of the site’s existing Smart Pet Care category');
  assert.deepEqual(state.posts.get(Number(created.post.id))!.categories, [11]);
});

test('CATEGORY: an entity-encoded name on the site still matches', async () => {
  resetMock();
  // WordPress stores this one as "Sleep &amp; Recovery"; Cynth holds the plain
  // characters. Comparing them undecoded matches nothing, silently.
  const article = await makeGeneratedArticle('Ampersand Area', null, sleepTheme.id);

  await publish.pushArticle(article.id, connection.id, 'create');

  assert.deepEqual(state.writes[state.writes.length - 1].categories, [15]);
});

test('CATEGORY: an unknown area creates nothing, and clears nothing', async () => {
  resetMock();
  const article = await makeGeneratedArticle('No Such Category', null, inventedTheme.id);
  const categoriesBefore = state.categories.size;

  await publish.pushArticle(article.id, connection.id, 'create');

  const sent = state.writes[state.writes.length - 1];
  assert.equal(sent.categories, undefined, 'no categories field at all');
  assert.equal(state.categories.size, categoriesBefore, 'and no category was invented on the site');

  // An empty array would have been the tempting alternative, and it would have
  // stripped the post of every category it had — turning "I could not find
  // yours" into "I removed the one you were using".
  assert.notDeepEqual(sent.categories, []);
});

test('CATEGORY: an article with no thematic area sends none', async () => {
  resetMock();
  const article = await makeGeneratedArticle('No Area At All');

  await publish.pushArticle(article.id, connection.id, 'create');

  assert.equal(state.writes[state.writes.length - 1].categories, undefined);
});

test('CATEGORY: the preview says where it will be filed, before anything is sent', async () => {
  const article = await makeGeneratedArticle('Previewed Filing', null, sleepTheme.id);
  const preview = publish.previewMapping(article.id, connection.id);
  assert.equal(preview.categoryName, 'Sleep & Recovery');
});

/* ============ replacing an article that is already published ============ */

/**
 * WHY THIS EXISTS AT ALL. Cynth refused to touch published content for two
 * reasons, and only one of them was a policy. The other was mechanical:
 * `updateDraft` sends `status: draft` unconditionally, so "updating" a live
 * post would not have updated it, it would have UNPUBLISHED it — the article
 * gone from the site, and the caller shown a success.
 *
 * The policy reason stands, and these tests are what holds it: a separate
 * mode no default can reach, an explicit yes every time, a second yes when
 * somebody has edited the post in WordPress since, and a payload carrying no
 * status and no slug.
 */

let liveArticleId = 0;

test('LIVE UPDATE: the ordinary update still refuses, and now says what to use', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Ordinary Update Refusal');
  const created = await publish.pushArticle(article.id, connection.id, 'create');
  state.posts.get(Number(created.post.id))!.status = 'publish';

  await assert.rejects(
    () => publish.pushArticle(article.id, connection.id, 'update'),
    (err: any) => err.code === 'remote_post_published' && /Update the live article/.test(err.message),
  );
});

test('LIVE UPDATE: without a confirmation it writes nothing', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Unconfirmed Live Update');
  const created = await publish.pushArticle(article.id, connection.id, 'create');
  state.posts.get(Number(created.post.id))!.status = 'publish';
  const writesBefore = state.writes.length;

  await assert.rejects(
    () => publish.pushArticle(article.id, connection.id, 'update_published'),
    (err: any) => err.code === 'live_update_not_confirmed',
    'a missing confirmation is a refusal, never a default yes',
  );

  assert.equal(state.writes.length, writesBefore, 'nothing was sent');
  assert.equal(state.posts.get(Number(created.post.id))!.status, 'publish');
});

test('LIVE UPDATE: confirmed, it replaces the body and leaves the post published', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Confirmed Live Update');
  liveArticleId = article.id;
  const created = await publish.pushArticle(article.id, connection.id, 'create');
  const postId = Number(created.post.id);

  state.posts.get(postId)!.status = 'publish';
  const originalSlug = state.posts.get(postId)!.slug;

  // One acknowledgement, not two: nobody has edited it in WordPress.
  const result = await publish.pushArticle(article.id, connection.id, 'update_published', { confirmed: true });

  assert.equal(result.operation, 'update_published');
  assert.equal(state.posts.get(postId)!.status, 'publish', 'the article is still live');
  assert.equal(state.posts.get(postId)!.slug, originalSlug, 'and its URL did not move');

  const sent = state.writes[state.writes.length - 1];
  assert.equal(sent.status, undefined, 'no status is announced, so WordPress keeps its own');
  assert.equal(sent.slug, undefined, 'no slug is sent, so the live URL cannot be moved');
  assert.ok(typeof sent.content === 'string' && sent.content.length > 0, 'the body is what changed');
});

test('LIVE UPDATE: pointed at a draft, it sends you to the ordinary update', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Still A Draft');
  await publish.pushArticle(article.id, connection.id, 'create');

  await assert.rejects(
    () => publish.pushArticle(article.id, connection.id, 'update_published', { confirmed: true }),
    (err: any) => err.code === 'remote_post_is_draft',
    'nobody is reading a draft, so the risky path is the wrong one',
  );
});

test('LIVE UPDATE: an edit made in WordPress since the last push stops it', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Edited In WordPress');
  const created = await publish.pushArticle(article.id, connection.id, 'create');
  const postId = Number(created.post.id);
  state.posts.get(postId)!.status = 'publish';

  // Somebody fixes a typo on the site, an hour after Cynth last sent it.
  state.modifiedOverride = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '');
  const writesBefore = state.writes.length;

  await assert.rejects(
    () => publish.pushArticle(article.id, connection.id, 'update_published', { confirmed: true }),
    (err: any) => err.code === 'remote_edited_since_push',
    'confirming "replace the live article" is not confirming "discard their edit"',
  );
  assert.equal(state.writes.length, writesBefore, 'nothing was sent');

  // Told about it, the editor may still choose to overwrite.
  const result = await publish.pushArticle(article.id, connection.id, 'update_published', {
    confirmed: true,
    acknowledgeRemoteEdits: true,
  });
  assert.equal(result.operation, 'update_published');
  state.modifiedOverride = null;
});

test('LIVE UPDATE: the history records it as its own operation', () => {
  const history = links.listPushHistoryForArticle(liveArticleId);
  assert.ok(
    history.some((entry) => entry.operation === 'update_published'),
    'a live replacement must be findable in the audit trail, not hidden inside "update"',
  );
});

test('LIVE UPDATE: an article with a featured image is still published afterwards', async () => {
  // The regression: the body update kept the post live, then attaching the
  // image sent `status: draft` and took it down (posts 365, 394, 338).
  resetMock();
  const article = await makeGeneratedArticleWithImage('Live With Image', 'live.png', 'A live picture');
  const created = await publish.pushArticle(article.id, connection.id, 'create');
  const postId = Number(created.post.id);
  state.posts.get(postId)!.status = 'publish';
  const writesBefore = state.writes.length;

  const result = await publish.pushArticle(article.id, connection.id, 'update_published', { confirmed: true });

  assert.equal(state.posts.get(postId)!.status, 'publish', 'the article must still be live');
  assert.equal(result.post.status, 'publish', 'and Cynth must record it as live');
  assert.ok(state.posts.get(postId)!.featuredMedia, 'the image was still attached');
  for (const write of state.writes.slice(writesBefore)) {
    assert.equal(write.status, undefined, 'no write in a live update may carry a status');
  }
});

/* ================= connector-level draft-only guarantee ================= */

test('SAFETY: the connector contract has no way to publish', () => {
  // Enforced by shape, not by remembering to avoid a method.
  assert.equal(typeof (wordpressConnector as never as Record<string, unknown>).publish, 'undefined');
  assert.equal(typeof (wordpressConnector as never as Record<string, unknown>).setStatus, 'undefined');
  assert.equal(typeof wordpressConnector.createDraft, 'function');
  assert.equal(typeof wordpressConnector.updateDraft, 'function');
});

test('SAFETY: no write ever asked this CMS to publish anything', () => {
  /**
   * RESTATED, NOT RELAXED. This used to assert `status === 'draft'` on every
   * write, which was the right guarantee while every write announced a status.
   * Updating an article that is ALREADY live must announce none — sending
   * `status: draft` at a published post unpublishes it — so the invariant is
   * now the one that was always meant: a write either asks for a draft or
   * says nothing about status at all. Neither can publish.
   */
  for (const write of state.writes) {
    assert.ok(
      write.status === 'draft' || write.status === undefined,
      `a write asked for status "${String(write.status)}"`,
    );
  }
  assert.ok(
    state.writes.some((write) => write.status === undefined),
    'and the live-update path really did send no status, rather than never running',
  );
});

test('SECRETS: the secret store keeps values out of the database entirely', () => {
  const envVar = connections.getConnectionById(connection.id)!.credentialEnvVar!;
  assert.equal(secrets.hasSecret(envVar), true);
  assert.equal(secrets.getSecret(envVar), TEST_APP_PASSWORD, 'the value lives only in the environment');

  const row = db().prepare('SELECT * FROM cms_connections WHERE id = ?').get(connection.id) as Record<string, unknown>;
  assert.equal(row.credential_env_var, envVar);
  assert.ok(!JSON.stringify(row).includes(TEST_APP_PASSWORD));
});

/* ======================== status sync from the CMS ====================== */

test('SYNC: a post published in WordPress stops showing as a draft in Cynth', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Published Behind Cynth’s Back');
  const created = await publish.pushArticle(article.id, connection.id, 'create');
  assert.equal(links.getLink(article.id, connection.id)!.externalStatus, 'draft');

  // A human presses Publish in WordPress. Cynth is not told.
  state.posts.get(Number(created.post.id))!.status = 'publish';
  const writesBefore = state.writes.length;

  const result = await publish.syncLinksFromCms();

  assert.equal(links.getLink(article.id, connection.id)!.externalStatus, 'publish');
  assert.ok(result.changed.some((c) => c.articleId === article.id && c.to === 'publish'));
  assert.ok(result.markedPublished.includes(article.id), 'the default site publishing it marks the article published');
  assert.equal(articlesRepo.getArticleById(article.id)!.status, 'published');
  assert.equal(state.writes.length, writesBefore, 'a sync writes nothing to the site');
});

test('SYNC: a post deleted in WordPress is recorded as gone, not left as a draft', async () => {
  resetMock();
  const article = await makeGeneratedArticle('Deleted Behind Cynth’s Back');
  const created = await publish.pushArticle(article.id, connection.id, 'create');
  state.posts.delete(Number(created.post.id));

  await publish.syncLinksFromCms();

  assert.equal(links.getLink(article.id, connection.id)!.externalStatus, 'deleted');
  assert.equal(articlesRepo.getArticleById(article.id)!.status, 'draft', 'a vanished post never promotes the article');
});

/* ============== credentials never follow a changed destination ========== */

test('CREDENTIALS: changing the site address clears the stored credential', () => {
  const moved = connections.createConnection({
    name: 'Moves Away',
    connectorType: 'wordpress',
    description: null,
    baseUrl: MOCK_BASE,
    seoTarget: null,
    authMethod: 'application_password',
    username: TEST_USERNAME,
    credential: TEST_APP_PASSWORD,
  });
  assert.equal(moved.hasCredential, true);

  // An edit to the name only keeps it.
  const renamed = connections.updateConnection(moved.id, {
    name: 'Renamed',
    connectorType: 'wordpress',
    description: null,
    baseUrl: MOCK_BASE,
    seoTarget: null,
    authMethod: 'application_password',
    username: TEST_USERNAME,
    credential: undefined,
  })!;
  assert.equal(renamed.hasCredential, true, 'same site: the credential stays');

  // Pointing it anywhere else does not take the password along.
  const pointed = connections.updateConnection(moved.id, {
    name: 'Renamed',
    connectorType: 'wordpress',
    description: null,
    baseUrl: 'https://attacker.example',
    seoTarget: null,
    authMethod: 'application_password',
    username: TEST_USERNAME,
    credential: undefined,
  })!;
  assert.equal(pointed.hasCredential, false, 'a new site needs the credential entered again');
  assert.equal(connections.getConnectionSecret(moved.id), null);

  connections.deleteConnection(moved.id);
});

test('CREDENTIALS: a credential with a line break is refused', async () => {
  const { validateCmsConnectionInput } = await import('../src/features/cms/cmsConnections.validation.js');
  const result = validateCmsConnectionInput({
    name: 'Injected',
    connectorType: 'wordpress',
    baseUrl: MOCK_BASE,
    username: TEST_USERNAME,
    credential: 'pass\nNODE_OPTIONS=--require=/tmp/evil.js',
  });
  assert.ok(result.errors.some((e) => /line break/.test(e)));
  assert.throws(() => secrets.setSecret('CYNTH_TEST_INJECT', 'a\nB=c'), /control characters/);
});
