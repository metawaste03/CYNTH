/**
 * Deleting a draft (Milestone 23).
 *
 * Deletion is irreversible and Cynth has no undo, so what matters is that it
 * destroys exactly what it says and nothing else:
 *
 *   1. The article and everything belonging to it go.
 *   2. Products, images and authors it referenced SURVIVE — they are shared.
 *   3. Generation history survives, detached, so what was spent is not erased
 *      along with the thing it was spent on.
 *   4. An article that exists as a CMS post refuses without an explicit
 *      override, because Cynth cannot delete the remote post.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-delete-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;

const dbModule = await import('../src/shared/database/index.js');
const articles = await import('../src/features/articles/articles.repository.js');
const articleProducts = await import('../src/features/articles/articleProducts.repository.js');
const products = await import('../src/features/products/products.repository.js');
const media = await import('../src/features/media/media.repository.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const history = await import('../src/features/generation/generationHistory.repository.js');
const pipeline = await import('../src/features/pipeline/pipeline.repository.js');

dbModule.initializeDatabase();
const db = dbModule.getDatabase();

const project = content.getDefaultProject()!;
const theme = content.createTheme(project.id, { name: 'Delete Theme', description: null });
const author = authorsRepo.createAuthor({ name: 'Delete Author' });

function makeDraft(title = 'A draft') {
  return articles.createArticleDraft({
    articleTypeId: 1,
    authorId: author.id,
    productId: null,
    projectId: project.id,
    themeId: theme.id,
    topicId: null,
    title,
    topic: 'A topic',
    targetAudience: null,
    searchIntent: null,
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: 'kw',
    secondaryKeywords: null,
  } as never);
}

test('PREFLIGHT: says what goes and what survives, before anything is destroyed', () => {
  const draft = makeDraft('Preflight draft');
  const product = products.createProduct({ title: 'A product', affiliateLink: 'https://example.test/p' });
  articleProducts.attachProduct(draft.id, { productId: product.id });

  const asset = media.createMedia({ filePath: 'uploads/media/x.jpg', title: 'An image', themeId: theme.id });
  media.attachMedia({ articleId: draft.id, mediaId: asset.id, role: 'featured' });

  const preflight = articles.getDeletionPreflight(draft.id)!;

  assert.equal(preflight.canDelete, true);
  assert.equal(preflight.blockers.length, 0);
  assert.ok(preflight.removes.some((r) => /product attachment/.test(r)));
  assert.ok(preflight.removes.some((r) => /image attachment/.test(r)));
  assert.ok(preflight.keeps.some((k) => /products, images and authors/i.test(k)));
  assert.ok(preflight.keeps.some((k) => /generation history/i.test(k)));

  // Nothing was destroyed by asking.
  assert.ok(articles.getArticleById(draft.id));
});

test('DELETE: the article and everything belonging to it go', () => {
  const draft = makeDraft('Doomed draft');
  const line = pipeline.startPipeline({ articleId: draft.id, mode: 'development', themeId: theme.id });
  pipeline.beginStageRun({ pipelineId: line.id, version: line.version, stage: 'topic_research' });

  assert.ok(articles.getDeletionPreflight(draft.id)!.removes.some((r) => /pipeline run/.test(r)));

  const result = articles.deleteArticle(draft.id);
  assert.ok('deleted' in result);

  assert.equal(articles.getArticleById(draft.id), null);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS c FROM keywords WHERE article_id = ?').get(draft.id) as any).c,
    0,
    'the keyword row cascaded',
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS c FROM article_pipelines WHERE article_id = ?').get(draft.id) as any).c,
    0,
    'the pipeline cascaded',
  );
  assert.equal(pipeline.getCurrentPipeline(draft.id), null);
});

test('DELETE: shared records survive — products, images and authors are not collateral', () => {
  const draft = makeDraft('Draft with attachments');
  const product = products.createProduct({ title: 'Surviving product', affiliateLink: 'https://example.test/keep' });
  const asset = media.createMedia({ filePath: 'uploads/media/keep.jpg', title: 'Surviving image', themeId: theme.id });

  articleProducts.attachProduct(draft.id, { productId: product.id });
  media.attachMedia({ articleId: draft.id, mediaId: asset.id, role: 'featured' });

  articles.deleteArticle(draft.id);

  assert.ok(products.getProductById(product.id), 'the product survives its article');
  assert.ok(media.getMedia(asset.id), 'the image survives its article');
  assert.ok(authorsRepo.getAuthorById(author.id), 'the author survives');

  // Only the links went.
  assert.equal(media.listArticleMedia(draft.id).length, 0);
  assert.equal(articleProducts.listArticleProducts(draft.id).length, 0);
});

test('DELETE: generation history survives, detached — the record of what was spent is not erased', () => {
  const draft = makeDraft('Draft with history');
  history.recordGeneration({
    articleId: draft.id,
    taskType: 'article_generation',
    providerName: 'Stub',
    providerType: 'openrouter',
    model: 'stub/model',
    status: 'success',
    totalTokens: 1234,
  });

  const before = (db.prepare('SELECT COUNT(*) AS c FROM generation_history').get() as any).c;
  articles.deleteArticle(draft.id);
  const after = (db.prepare('SELECT COUNT(*) AS c FROM generation_history').get() as any).c;

  assert.equal(after, before, 'the history row was kept');
  const orphaned = db
    .prepare('SELECT article_id, total_tokens FROM generation_history WHERE total_tokens = 1234')
    .get() as any;
  assert.equal(orphaned.article_id, null, 'it is detached rather than deleted');
  assert.equal(orphaned.total_tokens, 1234, 'what it cost is still readable');
});

test('BLOCKED: an article pushed to a CMS refuses, and explains why', () => {
  const draft = makeDraft('Pushed draft');

  const connectionId = Number(
    db
      .prepare(
        `INSERT INTO cms_connections (name, connector_type, base_url, is_active) VALUES ('WP', 'wordpress', 'http://example.test', 1)`,
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO article_cms_links (article_id, connection_id, external_id, external_status) VALUES (?, ?, '277', 'draft')`,
  ).run(draft.id, connectionId);

  const preflight = articles.getDeletionPreflight(draft.id)!;
  assert.equal(preflight.canDelete, false);
  assert.match(preflight.blockers[0], /post 277/);
  assert.match(preflight.blockers[0], /cannot delete a remote post/i);
  assert.match(preflight.blockers[0], /duplicate/i, 'the real consequence is named');
  assert.ok(preflight.keeps.some((k) => /remote CMS post/i.test(k)));

  const refused = articles.deleteArticle(draft.id);
  assert.ok('error' in refused, 'deletion must be refused without an override');
  assert.ok(articles.getArticleById(draft.id), 'the article is untouched by a refused delete');
});

test('OVERRIDE: force deletes a pushed article, and is never the default', () => {
  const pushed = articles
    .listArticles({})
    .find((a) => a.displayTitle === 'Pushed draft')!;

  // Default still refuses.
  assert.ok('error' in articles.deleteArticle(pushed.id));

  const forced = articles.deleteArticle(pushed.id, { force: true });
  assert.ok('deleted' in forced);
  assert.equal(articles.getArticleById(pushed.id), null);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS c FROM article_cms_links WHERE article_id = ?').get(pushed.id) as any).c,
    0,
    'the link went with it',
  );
});

test('DELETE: an article that does not exist is reported, not silently succeeded', () => {
  assert.equal(articles.getDeletionPreflight(999_999), null);
  const result = articles.deleteArticle(999_999);
  assert.ok('error' in result);
  assert.match((result as { error: string }).error, /not found/i);
});

test.after(() => {
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
