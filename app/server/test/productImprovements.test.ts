/**
 * Milestone 18 tests: the retrieval defects found by testing Milestone 17,
 * product themes, durable images, and placement review storage.
 *
 * Everything runs against a scratch database and a LOCAL mock retailer on
 * 127.0.0.1. NO REAL WEBSITE IS CONTACTED and no model is called.
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

const SCRATCH = path.join(os.tmpdir(), `cynth-m18-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;

const dbModule = await import('../src/shared/database/index.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const articles = await import('../src/features/articles/articles.repository.js');
const products = await import('../src/features/products/products.repository.js');
const webRepo = await import('../src/features/web-intelligence/webSources.repository.js');
const articleProducts = await import('../src/features/articles/articleProducts.repository.js');
const extract = await import('../src/features/product-research/productExtract.js');
const retrieval = await import('../src/features/product-research/productRetrieval.service.js');
const { buildGenerationContext } = await import('../src/features/generation/generationContext.service.js');
const { buildPrompt } = await import('../src/features/prompt-builder/promptBuilder.service.js');
const { SEO_CATEGORIES } = await import('../src/features/seo/seo.constants.js');

dbModule.initializeDatabase();

const project = content.getDefaultProject()!;
const workspaceTheme = content.createTheme(project.id, { name: 'Workspace M18', description: null });
const petTheme = content.createTheme(project.id, { name: 'Pet Care M18', description: null });
const author = authorsRepo.createAuthor({ name: 'M18 Author' });

/* --------------------------------------------------------- mock retailer */

const GOOD_PAGE = `<!doctype html><html><head>
<title>Mesh Task Chair - MockShop</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Mesh Task Chair",
 "description":"Breathable mesh chair.","image":"/img/chair.png","brand":{"name":"MockCo"}}
</script>
</head><body>body copy</body></html>`;

/**
 * The shape that broke Milestone 17: OpenGraph describing the SITE, not the
 * product, with the company logo as the image. Modelled on what Amazon
 * actually serves.
 */
const SITE_LEVEL_OG_PAGE = `<!doctype html><html><head>
<title>Ergonomic Standing Desk 48in | Mockshop</title>
<meta name="description" content="A height-adjustable standing desk with a 48 inch top." />
<meta property="og:title" content="Mockshop" />
<meta property="og:description" content="Mockshop" />
<meta property="og:image" content="https://cdn.mockshop.test/share-icons/logo.png" />
<meta property="og:site_name" content="Mockshop" />
</head><body>body copy</body></html>`;

const TITLE_ONLY_PAGE = '<!doctype html><html><head><title>Something</title></head><body></body></html>';
const BOT_WALL_PAGE =
  '<!doctype html><html><head><title>Robot Check</title></head><body>Enter the characters you see below</body></html>';

// A 1x1 PNG, so the image-download path has something real to store.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let redirectTarget = '/product/good';

const retailer = http.createServer((req, res) => {
  const url = req.url ?? '';

  if (url === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('User-agent: *\nDisallow: /private/\n');
    return;
  }
  if (url === '/img/chair.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG_1X1);
    return;
  }
  if (url.startsWith('/redirect')) {
    res.writeHead(302, { location: redirectTarget });
    res.end();
    return;
  }
  if (url.startsWith('/product/good')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(GOOD_PAGE);
    return;
  }
  if (url.startsWith('/product/site-og')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(SITE_LEVEL_OG_PAGE);
    return;
  }
  if (url.startsWith('/product/title-only')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(TITLE_ONLY_PAGE);
    return;
  }
  if (url.startsWith('/product/botwall')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(BOT_WALL_PAGE);
    return;
  }
  if (url.startsWith('/product/gone')) {
    // The exact shape that produced a product called "Page Not Found".
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<html><head><title>Page Not Found</title></head><body></body></html>');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/html' });
  res.end('<html><head><title>Page Not Found</title></head><body></body></html>');
});

await new Promise<void>((resolve) => retailer.listen(0, '127.0.0.1', resolve));
const RETAILER = `http://127.0.0.1:${(retailer.address() as AddressInfo).port}`;

function authoriseRetailer() {
  const existing = webRepo.getWebSourceByDomain('127.0.0.1');
  const input = {
    projectId: project.id,
    name: 'Mock Retailer',
    domain: '127.0.0.1',
    description: null,
    purpose: 'research' as const,
    isActive: true,
    crawlPermitted: true,
    searchPermitted: false,
    respectRobots: true,
    rateLimitPerMinute: null,
    notes: null,
  };
  return existing ? webRepo.updateWebSource(existing.id, input)! : webRepo.createWebSource(input);
}

/* ------------------------------------------- the Milestone 17 defects, fixed */

test('DEFECT: an HTTP 404 no longer becomes a product called "Page Not Found"', async () => {
  authoriseRetailer();

  const before = products.listProducts({}).length;
  await assert.rejects(
    () => retrieval.retrieveProduct({ url: `${RETAILER}/product/gone` }),
    (error: unknown) =>
      error instanceof retrieval.ProductRetrievalError &&
      error.code === 'retrieval_failed' &&
      /HTTP 404/.test(error.message),
  );

  assert.equal(products.listProducts({}).length, before, 'a product was created from an error page');
});

test('DEFECT: site-level OpenGraph is ignored, and the real title is used instead', () => {
  const result = extract.extractProductMetadata(SITE_LEVEL_OG_PAGE, 'https://www.mockshop.test/p/desk');

  assert.ok(result.foundVia.includes('opengraph-site-level-ignored'), 'the site-level block was not detected');
  assert.equal(result.title, 'Ergonomic Standing Desk 48in', 'the document title should win, with the site suffix stripped');
  assert.notEqual(result.title, 'Mockshop', 'the product must never be named after the retailer');
  assert.ok(result.description?.startsWith('A height-adjustable'), 'the real description should be used');
  assert.equal(result.imageUrl, null, 'the site logo must not become the product image');
});

test('DEFECT: a page publishing only a title is not usable research', () => {
  const result = extract.extractProductMetadata(TITLE_ONLY_PAGE, 'https://shop.test/p/1');
  assert.equal(extract.hasUsableMetadata(result), false, 'a bare title is a name, not research');
});

test('DEFECT: a bot-wall is reported as one rather than stored', async () => {
  authoriseRetailer();
  await assert.rejects(
    () => retrieval.retrieveProduct({ url: `${RETAILER}/product/botwall` }),
    (error: unknown) =>
      error instanceof retrieval.ProductRetrievalError && error.code === 'not_a_product_page',
  );
});

/* -------------------------------------------------------------- redirects */

test('SAFETY: a redirect to an unauthorised host is refused, not followed', async () => {
  authoriseRetailer();
  redirectTarget = 'http://elsewhere.test/product/1';

  await assert.rejects(
    () => retrieval.retrieveProduct({ url: `${RETAILER}/redirect` }),
    (error: unknown) =>
      error instanceof retrieval.ProductRetrievalError && /not permitted|stopped rather than following/i.test(error.message),
  );
});

test('REDIRECT: a redirect within an authorised source is followed, and the URL read is recorded', async () => {
  authoriseRetailer();
  redirectTarget = '/product/good';

  const result = await retrieval.retrieveProduct({
    url: `${RETAILER}/redirect`,
    affiliateUrl: 'https://example.test/aff?tag=me-20',
  });

  assert.equal(result.product.title, 'Mesh Task Chair');
  // Provenance names the page actually read, not the one asked for.
  const row = webRepo.getRetrieval(result.retrievalId)!;
  assert.equal(row.url, `${RETAILER}/product/good`);
  assert.match(row.notes ?? '', /Redirected via/);
  // And the source_url follows the redirect too.
  assert.equal(result.product.sourceUrl, `${RETAILER}/product/good`);
  assert.equal(result.product.affiliateLink, 'https://example.test/aff?tag=me-20', 'the affiliate link was altered');
});

/* ------------------------------------------------------- durable images */

test('IMAGE: a retrieved product image is stored locally, not left on the source CDN', async () => {
  const product = products.listProducts({}).find((p) => p.title === 'Mesh Task Chair')!;
  const detail = products.getProductById(product.id)!;

  assert.ok(detail.images.length > 0, 'the product image was not downloaded');
  const image = detail.images[0];
  assert.ok(image.url.startsWith('/uploads/products/'), 'the image is not served from local storage');
  assert.equal(image.isPrimary, true);

  // The file is really on disk.
  const onDisk = path.join(SCRATCH, 'uploads', 'products', path.basename(image.url));
  assert.ok(fs.existsSync(onDisk), `no file at ${onDisk}`);
  assert.ok(fs.statSync(onDisk).size > 0);

  // And it remembers where it came from.
  assert.match(image.originalFilename ?? '', /\/img\/chair\.png$/);
});

test('IMAGE: the article context prefers the stored image over the source URL', () => {
  const product = products.listProducts({}).find((p) => p.title === 'Mesh Task Chair')!;
  const draft = makeDraft(workspaceTheme.id);
  articleProducts.attachProduct(draft.id, { productId: product.id });

  const context = buildGenerationContext(draft.id)!;
  const entry = context.products.find((p) => p.productId === product.id)!;
  assert.ok(entry.imageUrl?.startsWith('/uploads/products/'), 'the card would depend on the retailer CDN');
});

test('PREVIEW: the card the preview draws carries the image and the untouched link', () => {
  // The gap this covers: the writer places a [[product:id]] marker and the card
  // is assembled from stored records at CMS push time. Cynth showed the marker
  // as literal text, so an uploaded primary image appeared NOWHERE in the app —
  // it reached only the published post, which is the last place you want to
  // first see how a card looks.
  const product = products.listProducts({}).find((p) => p.title === 'Mesh Task Chair')!;
  const draft = makeDraft(workspaceTheme.id);
  articleProducts.attachProduct(draft.id, { productId: product.id });

  // Exactly what GET /articles/:id/products returns.
  const entry = buildGenerationContext(draft.id)!.products.find((p) => p.productId === product.id)!;

  // Everything the card draws.
  assert.ok(entry.imageUrl, 'the preview card has an image to show');
  assert.ok(entry.imageUrl!.startsWith('/uploads/products/'), 'and it is the stored one, not the retailer CDN');
  assert.equal(entry.title, product.title);
  assert.ok(Array.isArray(entry.keyFeatures));

  // THE RULE THAT MATTERS. The affiliate URL is the editor's string, verbatim.
  // The preview reads the same field the published card reads, so what is shown
  // is what will ship — no parameters added, none removed, no canonicalisation.
  const stored = products.getProductById(product.id)!;
  assert.equal(entry.affiliateUrl, stored.affiliateLink, 'the preview must not alter the affiliate link');
});

/* ------------------------------------------------------- product themes */

function makeDraft(themeId: number | null) {
  return articles.createArticleDraft({
    articleTypeId: 1,
    authorId: author.id,
    productId: null,
    projectId: project.id,
    themeId,
    topicId: null,
    title: 'M18 draft',
    topic: 'Workspace',
    targetAudience: null,
    searchIntent: null,
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: null,
    secondaryKeywords: null,
  } as never);
}

test('THEME: a product can be assigned, reassigned and cleared', () => {
  const product = products.createProduct({ title: 'MX Master Mouse' });
  assert.equal(product.themeId, null, 'a product starts with no thematic area');

  const assigned = products.setProductTheme(product.id, workspaceTheme.id) as { themeId: number; themeName: string };
  assert.equal(assigned.themeId, workspaceTheme.id);
  assert.equal(assigned.themeName, 'Workspace M18', 'the area name is resolved for display');

  const moved = products.setProductTheme(product.id, petTheme.id) as { themeId: number };
  assert.equal(moved.themeId, petTheme.id);

  const cleared = products.setProductTheme(product.id, null) as { themeId: number | null };
  assert.equal(cleared.themeId, null, 'the association could not be removed');
});

test('THEME: an unknown thematic area is refused rather than stored', () => {
  const product = products.createProduct({ title: 'Ghost Product' });
  const result = products.setProductTheme(product.id, 999_999);
  assert.ok(result && 'error' in result);
});

test('THEME: products can be listed by thematic area, including those with none', () => {
  const mouse = products.listProducts({}).find((p) => p.title === 'MX Master Mouse')!;
  products.setProductTheme(mouse.id, workspaceTheme.id);

  const inWorkspace = products.listProducts({ themeId: workspaceTheme.id });
  assert.ok(inWorkspace.some((p) => p.id === mouse.id));
  assert.ok(inWorkspace.every((p) => p.themeId === workspaceTheme.id));

  const unassigned = products.listProducts({ themeId: 'none' });
  assert.ok(unassigned.every((p) => p.themeId === null));
  assert.ok(!unassigned.some((p) => p.id === mouse.id));
});

test('THEME: a mismatch is stated to the model as information, never as an exclusion', () => {
  const mouse = products.listProducts({}).find((p) => p.title === 'MX Master Mouse')!;
  products.setProductTheme(mouse.id, petTheme.id);

  // An article in the workspace area, carrying a product filed under pet care.
  const draft = makeDraft(workspaceTheme.id);
  articleProducts.attachProduct(draft.id, { productId: mouse.id });

  const context = buildGenerationContext(draft.id)!;
  const entry = context.products.find((p) => p.productId === mouse.id)!;
  assert.equal(entry.themeMatchesArticle, false);
  assert.equal(entry.themeName, 'Pet Care M18');

  const built = buildPrompt(draft.id) as { prompt: string };
  assert.match(built.prompt, /Thematic area: Pet Care M18/);
  assert.match(built.prompt, /not a reason to exclude it/i, 'a mismatch must not read as an instruction to drop it');
});

test('THEME: no mismatch is claimed when either side has no area', () => {
  const orphan = products.createProduct({ title: 'Unfiled Product' });
  const draft = makeDraft(workspaceTheme.id);
  articleProducts.attachProduct(draft.id, { productId: orphan.id });

  const entry = buildGenerationContext(draft.id)!.products.find((p) => p.productId === orphan.id)!;
  assert.equal(entry.themeMatchesArticle, null, 'an unknown must not be reported as a mismatch');
});

/* ---------------------------------------------------- placement review */

test('REVIEW: product_placement is a real SEO category', () => {
  assert.ok((SEO_CATEGORIES as readonly string[]).includes('product_placement'));
});

test('REVIEW: a verdict is stored without touching the author\'s placement', () => {
  const product = products.createProduct({ title: 'Reviewed Product' });
  const draft = makeDraft(workspaceTheme.id);
  articleProducts.attachProduct(draft.id, { productId: product.id });
  articleProducts.recordPlacements(draft.id, [{ productId: product.id, section: 'Seating' }]);

  articleProducts.recordPlacementReviews(draft.id, [
    {
      productId: product.id,
      verdict: 'weak',
      assessment: 'The surrounding paragraphs are about lighting.',
      suggestedSection: 'Lighting',
      confidence: 0.8,
      model: 'mock-model',
    },
  ]);

  const row = articleProducts.listArticleProducts(draft.id).find((r) => r.productId === product.id)!;
  assert.equal(row.reviewVerdict, 'weak');
  assert.equal(row.reviewSuggestedSection, 'Lighting');
  assert.equal(row.reviewModel, 'mock-model');
  assert.ok(row.reviewedAt);

  // The author's decision is untouched — this is a review, not an edit.
  assert.equal(row.status, 'placed', 'the review changed the placement status');
  assert.equal(row.placementSection, 'Seating', 'the review moved the product');
});

test('REVIEW: a good placement is recorded as good, not as silence', () => {
  const product = products.createProduct({ title: 'Well Placed Product' });
  const draft = makeDraft(workspaceTheme.id);
  articleProducts.attachProduct(draft.id, { productId: product.id });
  articleProducts.recordPlacements(draft.id, [{ productId: product.id, section: 'Seating' }]);

  articleProducts.recordPlacementReviews(draft.id, [
    { productId: product.id, verdict: 'good', assessment: 'The section is about seating.', confidence: 0.9 },
  ]);

  const row = articleProducts.listArticleProducts(draft.id).find((r) => r.productId === product.id)!;
  assert.equal(row.reviewVerdict, 'good');
  assert.equal(row.reviewSuggestedSection, null, 'a good placement needs no suggestion');
  assert.ok(row.reviewAssessment, 'a good verdict still explains itself');
});

test('REVIEW: regenerating clears reviews, which described the old placements', () => {
  const product = products.createProduct({ title: 'Regenerated Product' });
  const draft = makeDraft(workspaceTheme.id);
  articleProducts.attachProduct(draft.id, { productId: product.id });
  articleProducts.recordPlacements(draft.id, [{ productId: product.id, section: 'A' }]);
  articleProducts.recordPlacementReviews(draft.id, [
    { productId: product.id, verdict: 'good', assessment: 'Fine.', confidence: 1 },
  ]);

  articleProducts.recordPlacements(draft.id, [{ productId: product.id, section: 'B' }]);

  const row = articleProducts.listArticleProducts(draft.id).find((r) => r.productId === product.id)!;
  assert.equal(row.reviewVerdict, null, 'a stale verdict survived a regeneration');
  assert.equal(row.placementSection, 'B');
});

/* ------------------------------------------------------------- no limit */

test('NO LIMIT: an article can carry many products, and the prompt offers all of them', () => {
  const draft = makeDraft(workspaceTheme.id);
  const created = Array.from({ length: 25 }, (_, i) =>
    products.createProduct({ title: `Bulk Product ${i + 1}`, affiliateLink: `https://example.test/p/${i + 1}` }),
  );

  for (const product of created) {
    const attached = articleProducts.attachProduct(draft.id, { productId: product.id });
    assert.ok(!('error' in attached), `attaching product ${product.id} was refused`);
  }

  assert.equal(articleProducts.resolveProductIdsForArticle(draft.id).length, 25);

  const context = buildGenerationContext(draft.id)!;
  assert.equal(context.products.length, 25, 'the context dropped products');

  const built = buildPrompt(draft.id) as { prompt: string };
  for (const product of created) {
    assert.ok(built.prompt.includes(`Product ${product.id}:`), `product ${product.id} was not offered to the model`);
  }
});

test.after(() => {
  retailer.close();
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
