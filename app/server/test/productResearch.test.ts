/**
 * Product research and insertion tests (Milestone 17).
 *
 * The three things this feature must not get wrong:
 *   1. The user's affiliate URL survives, byte for byte, all the way to the
 *      rendered card.
 *   2. Nothing is read without an authorised source that permits it.
 *   3. A product is placed where the author put it, and omitting one is a
 *      recorded outcome rather than a failure.
 *
 * Everything runs against a scratch database and a LOCAL mock retailer on
 * 127.0.0.1. NO REAL WEBSITE IS EVER CONTACTED and no AI provider is called.
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

const SCRATCH = path.join(os.tmpdir(), `cynth-products-test-${process.pid}`);
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
const placement = await import('../src/features/articles/productPlacement.js');
const extract = await import('../src/features/product-research/productExtract.js');
const retrieval = await import('../src/features/product-research/productRetrieval.service.js');
const researchRepo = await import('../src/features/product-research/productResearch.repository.js');
const { articleBodyToHtml } = await import('../src/features/cms/articleMarkup.js');
const { renderProductCard } = await import('../src/features/cms/productCard.js');
const { buildGenerationContext } = await import('../src/features/generation/generationContext.service.js');
const { buildPrompt } = await import('../src/features/prompt-builder/promptBuilder.service.js');

dbModule.initializeDatabase();

const project = content.getDefaultProject()!;
const theme = content.createTheme(project.id, { name: 'Workspace Test', description: null });
const author = authorsRepo.createAuthor({ name: 'Product Test Author' });

/* --------------------------------------------------------- mock retailer */

/**
 * A local page that publishes schema.org Product metadata, exactly as a real
 * retailer does. Nothing here reaches the public internet.
 */
const PRODUCT_PAGE = `<!doctype html>
<html><head>
<title>ErgoChair Pro - Example Store</title>
<meta property="og:title" content="ErgoChair Pro Ergonomic Office Chair" />
<meta property="og:image" content="/img/ergochair.jpg" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "ErgoChair Pro Ergonomic Office Chair",
  "brand": { "@type": "Brand", "name": "ErgoWorks" },
  "description": "Adjustable lumbar support chair for long desk sessions.",
  "image": "https://cdn.example.test/ergochair.jpg",
  "sku": "EC-PRO-1",
  "category": "Office Chairs",
  "offers": { "@type": "Offer", "price": "329.00", "priceCurrency": "USD", "availability": "https://schema.org/InStock" },
  "additionalProperty": [
    { "@type": "PropertyValue", "name": "Lumbar support", "value": "Adjustable" },
    { "@type": "PropertyValue", "name": "Armrests", "value": "4D" }
  ]
}
</script>
</head><body><h1>ErgoChair Pro</h1><p>Marketing copy that must never reach an article.</p></body></html>`;

/** A page with nothing machine-readable on it, to prove Cynth refuses rather than guesses. */
const BARE_PAGE = '<!doctype html><html><head></head><body><p>Just some words.</p></body></html>';

let robotsBody = 'User-agent: *\nDisallow: /private/\n';
const requestLog: string[] = [];

const retailer = http.createServer((req, res) => {
  requestLog.push(req.url ?? '');

  if (req.url === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(robotsBody);
    return;
  }
  if (req.url?.startsWith('/product/chair')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PRODUCT_PAGE);
    return;
  }
  if (req.url?.startsWith('/private/')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PRODUCT_PAGE);
    return;
  }
  if (req.url?.startsWith('/bare')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(BARE_PAGE);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/html' });
  res.end('<html><head><title>Not found</title></head><body></body></html>');
});

await new Promise<void>((resolve) => retailer.listen(0, '127.0.0.1', resolve));
const retailerPort = (retailer.address() as AddressInfo).port;
const RETAILER = `http://127.0.0.1:${retailerPort}`;

/**
 * The retriever matches a URL's host against the source's domain, and
 * `127.0.0.1` normalises to itself, so the mock is reachable through exactly
 * the same authorisation path a real retailer would be.
 */
function authoriseRetailer(options: { crawl?: boolean; respectRobots?: boolean } = {}) {
  const existing = webRepo.getWebSourceByDomain('127.0.0.1');
  const input = {
    projectId: project.id,
    name: 'Mock Retailer',
    domain: '127.0.0.1',
    description: null,
    purpose: 'research' as const,
    isActive: true,
    crawlPermitted: options.crawl !== false,
    searchPermitted: false,
    respectRobots: options.respectRobots !== false,
    rateLimitPerMinute: null,
    notes: null,
  };
  return existing ? webRepo.updateWebSource(existing.id, input)! : webRepo.createWebSource(input);
}

/** The user's link: query parameters and all. Nothing may alter this string. */
const AFFILIATE_URL = 'https://www.amazon.com/dp/B0EXAMPLE?tag=everyfivedays-20&linkCode=ll1&ref_=as_li_ss_tl';

function makeDraft() {
  return articles.createArticleDraft({
    articleTypeId: 1,
    authorId: author.id,
    productId: null,
    projectId: project.id,
    themeId: theme.id,
    topicId: null,
    title: 'Workspace Setup',
    topic: 'Building a productive workspace',
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

/* ------------------------------------------------------------ extraction */

test('EXTRACT: structured metadata is read, page copy is not', () => {
  const result = extract.extractProductMetadata(PRODUCT_PAGE, `${RETAILER}/product/chair`);

  assert.equal(result.title, 'ErgoChair Pro Ergonomic Office Chair');
  assert.equal(result.brand, 'ErgoWorks');
  assert.equal(result.description, 'Adjustable lumbar support chair for long desk sessions.');
  assert.equal(result.imageUrl, 'https://cdn.example.test/ergochair.jpg');
  assert.equal(result.price, '329.00');
  assert.deepEqual(result.features, ['Lumbar support: Adjustable', 'Armrests: 4D']);
  assert.ok(result.foundVia.includes('json-ld'));

  // The body copy must not appear anywhere in the extraction.
  const serialised = JSON.stringify(result);
  assert.ok(
    !serialised.includes('Marketing copy that must never reach an article'),
    'page copy leaked into the extracted metadata',
  );
});

test('EXTRACT: a page publishing no product metadata yields nothing usable', () => {
  const result = extract.extractProductMetadata(BARE_PAGE, `${RETAILER}/bare`);
  assert.equal(extract.hasUsableMetadata(result), false);
});

test('EXTRACT: the vendor is derived from the host, not hardcoded', () => {
  assert.equal(extract.vendorFromUrl('https://www.amazon.com/dp/X'), 'amazon');
  assert.equal(extract.vendorFromUrl('https://www.amazon.co.uk/dp/X'), 'amazon');
  assert.equal(extract.vendorFromUrl('https://shop.example-store.net/p/1'), 'example-store');
});

/* --------------------------------------------------------- authorisation */

test('AUTHORISATION: an unauthorised domain is refused before anything is fetched', async () => {
  const before = requestLog.length;
  const preflight = await retrieval.preflightUrl('https://not-configured.test/product/1');

  assert.equal(preflight.sourceConfigured, false);
  assert.equal(preflight.permitted, false);
  assert.match(preflight.remedy ?? '', /Web Sources/);
  assert.equal(requestLog.length, before, 'a request was made for an unauthorised domain');
});

test('AUTHORISATION: a configured source with crawling off is refused', async () => {
  authoriseRetailer({ crawl: false });

  const preflight = await retrieval.preflightUrl(`${RETAILER}/product/chair`);
  assert.equal(preflight.sourceConfigured, true);
  assert.equal(preflight.permitted, false);
  assert.match(preflight.reason, /not permitted/i);

  await assert.rejects(
    () => retrieval.retrieveProduct({ url: `${RETAILER}/product/chair` }),
    (error: unknown) => error instanceof retrieval.ProductRetrievalError && error.code === 'retrieval_not_permitted',
  );
});

test('AUTHORISATION: robots.txt is obeyed when the source says to', async () => {
  authoriseRetailer({ crawl: true, respectRobots: true });

  const preflight = await retrieval.preflightUrl(`${RETAILER}/private/product/chair`);
  assert.equal(preflight.permitted, false, 'a disallowed path must be refused');
  assert.match(preflight.reason, /robots\.txt disallows/i);

  const allowed = await retrieval.preflightUrl(`${RETAILER}/product/chair`);
  assert.equal(allowed.permitted, true, 'a permitted path must be allowed');
});

test('AUTHORISATION: an authorisation for one domain cannot be spent on another', async () => {
  authoriseRetailer({ crawl: true });
  const preflight = await retrieval.preflightUrl('http://elsewhere.test/product/1');
  assert.equal(preflight.permitted, false);
});

/* ------------------------------------------------------------- retrieval */

test('RETRIEVE: a product page becomes a product, with provenance recorded', async () => {
  authoriseRetailer({ crawl: true, respectRobots: true });

  const result = await retrieval.retrieveProduct({
    url: `${RETAILER}/product/chair`,
    affiliateUrl: AFFILIATE_URL,
  });

  assert.equal(result.created, true);
  assert.equal(result.product.title, 'ErgoChair Pro Ergonomic Office Chair');
  assert.equal(result.product.brand, 'ErgoWorks');
  assert.equal(result.product.researchStatus, 'retrieved');
  assert.deepEqual(result.product.keyFeatures, ['Lumbar support: Adjustable', 'Armrests: 4D']);

  // Provenance: the retrieval row exists and names the source.
  const retrievalRow = webRepo.getRetrieval(result.retrievalId);
  assert.ok(retrievalRow, 'no retrieval was recorded');
  assert.equal(retrievalRow!.url, `${RETAILER}/product/chair`);
  assert.equal(retrievalRow!.httpStatus, 200);
  assert.ok(retrievalRow!.contentHash, 'the content hash proves which version was read');
  assert.equal(retrievalRow!.robotsAllowed, true);

  // The research pass points at that retrieval.
  const research = researchRepo.getLatestResearch(result.product.id)!;
  assert.equal(research.retrievalId, result.retrievalId);
  assert.equal(research.extractionMethod, 'structured_metadata');
});

test('AFFILIATE URL: stored exactly as supplied, and never replaced by the page URL', () => {
  const product = products.listProducts({}).find((p) => p.title.startsWith('ErgoChair'))!;
  assert.equal(product.affiliateLink, AFFILIATE_URL, 'the affiliate URL was altered');
  assert.equal(product.sourceUrl, `${RETAILER}/product/chair`, 'the page read is recorded separately');
  assert.notEqual(product.affiliateLink, product.sourceUrl);
});

test('RETRIEVE: a page with no product metadata is refused, not guessed at', async () => {
  authoriseRetailer({ crawl: true });
  await assert.rejects(
    () => retrieval.retrieveProduct({ url: `${RETAILER}/bare` }),
    (error: unknown) => error instanceof retrieval.ProductRetrievalError && error.code === 'no_product_metadata',
  );
});

test('RETRIEVE: re-reading a page does not overwrite what the editor typed', async () => {
  authoriseRetailer({ crawl: true });
  const existing = products.listProducts({}).find((p) => p.title.startsWith('ErgoChair'))!;

  products.updateProduct(existing.id, {
    title: 'The chair I actually recommend',
    description: 'My own words about this chair.',
    affiliateLink: AFFILIATE_URL,
  });

  await retrieval.retrieveProduct({ url: `${RETAILER}/product/chair`, productId: existing.id });

  const after = products.getProductById(existing.id)!;
  assert.equal(after.title, 'The chair I actually recommend', 'research overwrote the editor’s title');
  assert.equal(after.description, 'My own words about this chair.', 'research overwrote the editor’s description');
  assert.equal(after.affiliateLink, AFFILIATE_URL, 'research touched the affiliate link');
});

/* ------------------------------------------------- many products per article */

test('ATTACH: an article carries several products, in order', () => {
  const draft = makeDraft();
  const chair = products.listProducts({}).find((p) => p.title.startsWith('The chair'))!;
  const light = products.createProduct({ title: 'Monitor Light Bar', affiliateLink: 'https://example.test/light' });
  const tray = products.createProduct({ title: 'Desk Cable Tray', affiliateLink: 'https://example.test/tray' });

  for (const product of [chair, light, tray]) {
    const attached = articleProducts.attachProduct(draft.id, { productId: product.id });
    assert.ok(!('error' in attached));
  }

  assert.deepEqual(
    articleProducts.resolveProductIdsForArticle(draft.id),
    [chair.id, light.id, tray.id],
    'three products, in the order they were attached',
  );
  return { draft, chair, light, tray };
});

test('ATTACH: a draft predating article_products keeps its single legacy product', () => {
  const legacyProduct = products.createProduct({ title: 'Legacy Product' });
  const draft = makeDraft();
  articles.updateArticleDraft(draft.id, {
    articleTypeId: 1,
    authorId: author.id,
    productId: legacyProduct.id,
    projectId: project.id,
    themeId: theme.id,
    topicId: null,
    title: 'Legacy draft',
    topic: 'x',
    targetAudience: null,
    searchIntent: null,
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: null,
    secondaryKeywords: null,
  } as never);

  assert.deepEqual(articleProducts.resolveProductIdsForArticle(draft.id), [legacyProduct.id]);
  assert.equal(buildGenerationContext(draft.id)!.products.length, 1);
});

/* ----------------------------------------------------------------- prompt */

test('PROMPT: products are offered with what they are for, and the affiliate URL is withheld', () => {
  const draft = makeDraft();
  const chair = products.listProducts({}).find((p) => p.title.startsWith('The chair'))!;
  researchRepo.applyResearchFields(chair.id, {
    useCase: 'Supports the lower back during long seated work sessions.',
    researchStatus: 'researched',
  });
  articleProducts.attachProduct(draft.id, { productId: chair.id, editorialNote: 'For the seating section.' });

  const built = buildPrompt(draft.id) as { prompt: string };
  assert.ok(!('errors' in built), 'the prompt failed to build');

  assert.ok(built.prompt.includes('=== PRODUCTS AVAILABLE ==='));
  assert.ok(built.prompt.includes('=== PRODUCT PLACEMENT ==='));
  assert.ok(built.prompt.includes('Supports the lower back'), 'the use case must reach the model');
  assert.ok(built.prompt.includes('For the seating section.'), 'the editor’s note must reach the model');
  assert.ok(built.prompt.includes(`[[product:${chair.id}]]`) || built.prompt.includes('[[product:123]]'));

  // The model has no business seeing a tracking URL.
  assert.ok(!built.prompt.includes(AFFILIATE_URL), 'the affiliate URL reached the model');
  assert.ok(!built.prompt.includes('tag=everyfivedays-20'), 'the affiliate tag reached the model');
});

test('PROMPT: omitting a product is stated as an acceptable outcome', () => {
  const draft = makeDraft();
  const light = products.listProducts({}).find((p) => p.title === 'Monitor Light Bar')!;
  articleProducts.attachProduct(draft.id, { productId: light.id });

  const built = buildPrompt(draft.id) as { prompt: string };
  assert.match(built.prompt, /Leaving a product out entirely is a correct outcome/i);
  assert.match(built.prompt, /Do NOT force a product into a section it does not fit/i);
});

/* -------------------------------------------------------------- placement */

const BODY = [
  '# Building a workspace',
  '',
  'Some opening prose.',
  '',
  '## Seating',
  '',
  'A chair is the thing you touch for eight hours.',
  '',
  '[[product:1]]',
  '',
  '## Lighting',
  '',
  'Screen glare is a lighting problem.',
  '',
  '[[product:2]]',
  '',
  '[[product:999]]',
  '',
  '[[product:1]]',
].join('\n');

test('PLACEMENT: markers resolve to the section they fall under', () => {
  const scan = placement.scanProductPlacements(BODY, [1, 2]);

  assert.deepEqual(
    scan.placements.map((p) => ({ productId: p.productId, section: p.section })),
    [
      { productId: 1, section: 'Seating' },
      { productId: 2, section: 'Lighting' },
    ],
  );
});

test('PLACEMENT: an invented id and a repeat are discarded, not rendered', () => {
  const scan = placement.scanProductPlacements(BODY, [1, 2]);
  assert.equal(scan.discarded.length, 2);
  assert.ok(scan.discarded.some((entry) => entry.productId === 999));

  const cleaned = placement.stripInvalidMarkers(BODY, [1, 2]);
  assert.ok(!cleaned.includes('[[product:999]]'), 'an invented marker survived into the body');
  assert.equal(cleaned.match(/\[\[product:1\]\]/g)?.length, 1, 'the repeated marker was not removed');
  assert.ok(cleaned.includes('[[product:2]]'), 'a valid marker was removed');
});

test('PLACEMENT: a product the author did not place is recorded as omitted', () => {
  const draft = makeDraft();
  const chair = products.listProducts({}).find((p) => p.title.startsWith('The chair'))!;
  const tray = products.listProducts({}).find((p) => p.title === 'Desk Cable Tray')!;
  articleProducts.attachProduct(draft.id, { productId: chair.id });
  articleProducts.attachProduct(draft.id, { productId: tray.id });

  articleProducts.recordPlacements(draft.id, [{ productId: chair.id, section: 'Seating' }]);

  const rows = articleProducts.listArticleProducts(draft.id);
  const chairRow = rows.find((row) => row.productId === chair.id)!;
  const trayRow = rows.find((row) => row.productId === tray.id)!;

  assert.equal(chairRow.status, 'placed');
  assert.equal(chairRow.placementSection, 'Seating');
  assert.equal(trayRow.status, 'omitted', 'an unplaced product must be recorded as omitted');
  assert.equal(trayRow.placedAt, null);
});

/* ------------------------------------------------------------ card render */

test('CARD: the rendered card carries the affiliate URL verbatim', () => {
  const draft = makeDraft();
  const chair = products.listProducts({}).find((p) => p.title.startsWith('The chair'))!;
  articleProducts.attachProduct(draft.id, { productId: chair.id });

  const context = buildGenerationContext(draft.id)!;
  const html = articleBodyToHtml(`## Seating\n\nProse.\n\n[[product:${chair.id}]]\n`, context.products);

  assert.ok(html.includes('[efd_product '), 'no card was rendered');
  // Emitted verbatim and unescaped: a shortcode attribute is not HTML, and the
  // site's renderer escapes it at the point it becomes markup.
  assert.ok(html.includes(`url="${AFFILIATE_URL}"`), 'the affiliate URL was not emitted verbatim');
  assert.ok(!html.includes(`${RETAILER}/product/chair`), 'the source page URL leaked into the card');
  assert.ok(html.includes('[/efd_product]'), 'the shortcode was not closed');
});

test('CARD: the vendor reaches the card, so the button is not hardcoded to one retailer', () => {
  const draft = makeDraft();
  const chair = products.listProducts({}).find((p) => p.title.startsWith('The chair'))!;
  articleProducts.attachProduct(draft.id, { productId: chair.id });

  const context = buildGenerationContext(draft.id)!;
  const product = context.products.find((p) => p.productId === chair.id)!;

  assert.ok('vendor' in product, 'the card context must carry the vendor');

  const withVendor = renderProductCard({ ...product, vendor: 'www.Amazon.com' });
  assert.ok(withVendor.includes('vendor="amazon"'), 'a host should normalise to a bare slug');

  const unknown = renderProductCard({ ...product, vendor: 'rei' });
  assert.ok(unknown.includes('vendor="rei"'), 'an unfamiliar vendor must still be passed through');

  const none = renderProductCard({ ...product, vendor: null });
  assert.ok(!none.includes('vendor='), 'no vendor means no attribute, not an empty one');
});

test('CARD: key features are NOT on the card — they are for the writer, not the reader', () => {
  const card = renderProductCard({
    productId: 1,
    title: 'Thing',
    brand: null,
    category: null,
    affiliateUrl: 'https://example.test/p',
    vendor: null,
    imageUrl: null,
    description: 'A summary.',
    useCase: null,
    problemSolved: null,
    bestFor: null,
    keyFeatures: ['420D fabric', 'Rain cover included', 'Hip belt pockets'],
    editorialNote: null,
    editorialFit: null,
    themeName: null,
    themeMatchesArticle: null,
  });

  assert.ok(!card.includes('420D'), 'a feature list reached the card');
  assert.ok(!card.includes('Rain cover'), 'a feature list reached the card');
  assert.ok(card.includes('A summary.'), 'the summary should still be there');
});

test('CARD: brackets and quotes cannot break out of the shortcode', () => {
  const card = renderProductCard({
    productId: 1,
    title: 'A "quoted" [bracketed] name',
    brand: 'Br]and',
    category: null,
    affiliateUrl: 'https://example.test/p',
    vendor: null,
    imageUrl: null,
    description: 'Summary with [brackets] and "quotes".',
    useCase: null,
    problemSolved: null,
    bestFor: null,
    keyFeatures: [],
    editorialNote: null,
    editorialFit: null,
    themeName: null,
    themeMatchesArticle: null,
  });

  // Exactly one opening and one closing tag: nothing in the data created a
  // second shortcode or terminated this one early.
  assert.equal(card.match(/\[efd_product /g)?.length, 1, 'the data opened a second shortcode');
  assert.equal(card.match(/\[\/efd_product\]/g)?.length, 1, 'the data closed the shortcode early');

  const attrs = card.slice(0, card.indexOf(']'));
  assert.ok(!attrs.includes('"quoted"'), 'a quote survived into an attribute');

  // Quotes are fine in enclosed content — which is why the summary goes there.
  assert.ok(card.includes('"quotes"'), 'enclosed content should keep its punctuation');
});

test('CARD: a marker for a product the article does not carry renders as text, not a card', () => {
  const html = articleBodyToHtml('Prose.\n\n[[product:4242]]\n', []);
  assert.ok(!html.includes('efd-product-card'));
  assert.ok(html.includes('[[product:4242]]'), 'an unrecognised marker must survive as text');
});

test('CARD: no script, and only http(s) URLs become links', () => {
  const html = articleBodyToHtml(
    `## X\n\n[[product:1]]\n`,
    [
      {
        productId: 1,
        title: 'Dodgy',
        brand: null,
        category: null,
        affiliateUrl: 'javascript:alert(1)',
        imageUrl: 'javascript:alert(2)',
        vendor: null,
        description: null,
        useCase: null,
        problemSolved: null,
        bestFor: null,
        keyFeatures: [],
        editorialNote: null,
        editorialFit: null,
      },
    ],
  );

  assert.ok(!html.includes('javascript:'), 'a javascript: URL reached the markup');
  assert.ok(!html.includes('<script'), 'a card must never emit a script');
  assert.ok(html.includes('[efd_product '), 'the card should still render, just without the link');
  assert.ok(!html.includes('url='), 'a rejected URL must not become an empty attribute either');
});

test('CARD: markup is escaped, so a product title cannot inject HTML', () => {
  const html = articleBodyToHtml(
    `[[product:1]]\n`,
    [
      {
        productId: 1,
        title: '<img src=x onerror=alert(1)>',
        brand: null,
        category: null,
        affiliateUrl: 'https://example.test/p',
        vendor: null,
        imageUrl: null,
        description: null,
        useCase: null,
        problemSolved: null,
        bestFor: null,
        keyFeatures: [],
        editorialNote: null,
        editorialFit: null,
      },
    ],
  );

  // The card is a shortcode now, so the defence is different in kind — but it
  // is still Cynth's job. The site strips tags again at the point the
  // attribute becomes markup; neither side relies on the other, because they
  // ship separately and either could be older than the other.
  assert.ok(!html.includes('<img'), 'a product title carried a tag into the shortcode');
  assert.ok(!html.includes('onerror'), 'an event handler survived into the shortcode');
  assert.equal(html.match(/\[efd_product /g)?.length, 1, 'the title opened a second shortcode');
  assert.equal(html.match(/\[\/efd_product\]/g)?.length, 1, 'the title closed the shortcode early');
});

test.after(() => {
  retailer.close();
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
