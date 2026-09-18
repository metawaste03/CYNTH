/**
 * Amazon Creators API integration tests (Milestone 19).
 *
 * What must hold:
 *   1. An Amazon URL is identified, and its ASIN read, without any network call.
 *   2. The affiliate URL survives the API path byte for byte.
 *   3. An Amazon URL NEVER falls back to scraping — not when unconfigured, not
 *      when the API fails.
 *   4. Credentials never appear in any response.
 *
 * NO REAL AMAZON REQUEST IS EVER MADE. `fetch` is stubbed for the whole file,
 * and a test that reached the network would fail on the stub rather than
 * quietly succeed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* ------------------------------------------------------------------ setup */

const SCRATCH = path.join(os.tmpdir(), `cynth-amazon-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
// Secrets too: without this a test that configures a credential writes it into
// the developer's real .env.local.
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const amazonUrl = await import('../src/features/product-research/amazon/amazonUrl.js');
const amazonConfig = await import('../src/features/product-research/amazon/amazonConfig.js');
const mapper = await import('../src/features/product-research/amazon/amazonProduct.mapper.js');
const client = await import('../src/features/product-research/amazon/creatorsApi.client.js');
const amazonRetrieval = await import('../src/features/product-research/amazon/amazonRetrieval.service.js');
const retrieval = await import('../src/features/product-research/productRetrieval.service.js');
const products = await import('../src/features/products/products.repository.js');

dbModule.initializeDatabase();

/* ------------------------------------------------------------ fetch stub */

interface StubCall {
  url: string;
  init: RequestInit | undefined;
}

const calls: StubCall[] = [];
let tokenResponse: { status: number; body: unknown } = {
  status: 200,
  body: { access_token: 'test-token-not-a-real-credential', expires_in: 3600 },
};
let getItemsResponse: { status: number; body: unknown } = { status: 200, body: {} };

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  calls.push({ url, init });

  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (url.includes('/auth/o2/token')) return reply(tokenResponse.status, tokenResponse.body);
  if (url.includes('/catalog/v1/getItems')) return reply(getItemsResponse.status, getItemsResponse.body);

  throw new Error(`Unexpected network call in tests: ${url}`);
}) as typeof fetch;

/** A Creators API item shaped as the documentation describes: lowerCamelCase, displayValue wrappers. */
const API_ITEM = {
  asin: 'B09B8V1LZ3',
  itemInfo: {
    title: { displayValue: 'Echo Dot (5th Gen) Smart Speaker with Alexa' },
    byLineInfo: { brand: { displayValue: 'Amazon' }, manufacturer: { displayValue: 'Amazon' } },
    features: { displayValues: ['Improved audio', 'Alexa built in', 'Temperature sensor'] },
    productInfo: { unitCount: { displayValue: 1 }, itemDimensions: { height: { displayValue: 3.5, unit: 'inches' } } },
    classifications: { productGroup: { displayValue: 'CE' } },
  },
  images: { primary: { large: { url: 'https://m.media-amazon.com/images/I/test-large.jpg' } } },
  browseNodeInfo: { browseNodes: [{ displayName: 'Smart Speakers' }] },
};

/** The user's link. Query parameters and all — nothing may alter this string. */
const AFFILIATE_URL = 'https://amzn.to/3SBe7Ah';

function configure() {
  amazonConfig.updateAmazonConfig({
    partnerTag: 'everyfivedays-20',
    marketplace: 'www.amazon.com',
    credentialVersion: '3.1',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  });
  client.clearTokenCache();
}

/* ----------------------------------------------------------- URL handling */

test('URL: Amazon storefronts and shorteners are recognised, others are not', () => {
  assert.equal(amazonUrl.isAmazonUrl('https://www.amazon.com/dp/B09B8V1LZ3'), true);
  assert.equal(amazonUrl.isAmazonUrl('https://www.amazon.co.uk/dp/B09B8V1LZ3'), true);
  assert.equal(amazonUrl.isAmazonUrl('https://amzn.to/3SBe7Ah'), true);
  assert.equal(amazonUrl.isAmazonUrl('https://www.notamazon.com/dp/B09B8V1LZ3'), false);
  assert.equal(amazonUrl.isAmazonUrl('https://shop.example.test/p/1'), false);
});

test('URL: the ASIN is read from every common Amazon link form', () => {
  const cases: [string, string | null][] = [
    ['https://www.amazon.com/dp/B09B8V1LZ3', 'B09B8V1LZ3'],
    ['https://www.amazon.com/Echo-Dot-5th-Gen/dp/B09B8V1LZ3?tag=x-20&th=1', 'B09B8V1LZ3'],
    ['https://www.amazon.com/gp/product/B09B8V1LZ3', 'B09B8V1LZ3'],
    ['https://www.amazon.co.uk/gp/aw/d/B09B8V1LZ3/', 'B09B8V1LZ3'],
    ['https://www.amazon.com/s?k=echo+dot', null],
    ['https://www.amazon.com/Echo-Dot-Ergonomic-Chair/', null],
  ];

  for (const [url, expected] of cases) {
    assert.equal(amazonUrl.asinFromUrl(url), expected, url);
  }
});

test('URL: a path segment that is not ASIN-shaped is not mistaken for one', () => {
  assert.equal(amazonUrl.asinFromUrl('https://www.amazon.com/dp/NOTANASIN1'), null);
  assert.equal(amazonUrl.asinFromUrl('https://www.amazon.com/dp/B09B8V1LZ'), null, 'nine characters is not an ASIN');
});

test('URL: the marketplace and region come from the host', () => {
  assert.equal(amazonUrl.marketplaceForUrl('https://www.amazon.co.jp/dp/B09B8V1LZ3')?.region, 'FE');
  assert.equal(amazonUrl.marketplaceForUrl('https://www.amazon.de/dp/B09B8V1LZ3')?.marketplace, 'www.amazon.de');
});

/* --------------------------------------------------------- configuration */

test('CONFIG: an unconfigured install reports itself unconfigured', () => {
  amazonConfig.updateAmazonConfig({ clientId: '', clientSecret: '', partnerTag: '' });
  const config = amazonConfig.getAmazonConfig();
  assert.equal(config.hasCredentials, false);
  assert.equal(config.isConfigured, false);
});

test('CONFIG: credentials alone are not "configured" — the partner tag is required too', () => {
  amazonConfig.updateAmazonConfig({ clientId: 'a', clientSecret: 'b', partnerTag: '' });
  const config = amazonConfig.getAmazonConfig();
  assert.equal(config.hasCredentials, true);
  assert.equal(config.isConfigured, false, 'the API cannot be called without a partner tag');
});

test('CONFIG: no credential VALUE is ever exposed by the config object', () => {
  configure();
  const serialised = JSON.stringify(amazonConfig.getAmazonConfig());
  assert.ok(!serialised.includes('test-client-id'), 'the client id leaked');
  assert.ok(!serialised.includes('test-client-secret'), 'the client secret leaked');
  assert.ok(serialised.includes('"hasCredentials":true'), 'presence should still be reported');
});

test('CONFIG: secrets are never written to the database', () => {
  configure();
  const db = dbModule.getDatabase();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  for (const row of rows) {
    assert.ok(!row.value?.includes('test-client-secret'), `secret found in settings.${row.key}`);
    assert.ok(!row.value?.includes('test-client-id'), `credential id found in settings.${row.key}`);
  }
});

/* -------------------------------------------------------------- mapping */

test('MAP: the documented response shape maps onto Cynth product fields', () => {
  const mapped = mapper.mapAmazonItem(API_ITEM);

  assert.equal(mapped.asin, 'B09B8V1LZ3');
  assert.equal(mapped.title, 'Echo Dot (5th Gen) Smart Speaker with Alexa');
  assert.equal(mapped.brand, 'Amazon');
  assert.equal(mapped.imageUrl, 'https://m.media-amazon.com/images/I/test-large.jpg');
  assert.equal(mapped.category, 'Smart Speakers');
  assert.ok(mapped.features.includes('Alexa built in'));
  // productInfo is flattened into readable specification strings.
  assert.ok(mapped.features.some((f) => /Item Dimensions Height: 3.5 inches/.test(f)), mapped.features.join(' | '));
  assert.ok(mapped.foundVia.includes('creators-api'));
});

test('MAP: a sparse response yields a sparse product, not invented fields', () => {
  const mapped = mapper.mapAmazonItem({ asin: 'B000000000', itemInfo: { title: { displayValue: 'Bare Item' } } });

  assert.equal(mapped.title, 'Bare Item');
  assert.equal(mapped.brand, null);
  assert.equal(mapped.imageUrl, null);
  assert.deepEqual(mapped.features, []);
  assert.equal(mapper.hasUsableAmazonData(mapped), false, 'a title alone is not usable data');
});

test('MAP: PascalCase keys are tolerated at the third-party boundary', () => {
  const mapped = mapper.mapAmazonItem({
    ASIN: 'B09B8V1LZ3',
    ItemInfo: { Title: { DisplayValue: 'Pascal Item' }, Features: { DisplayValues: ['One', 'Two'] } },
  });
  assert.equal(mapped.title, 'Pascal Item');
  assert.deepEqual(mapped.features, ['One', 'Two']);
});

/* ------------------------------------------------------------ API calls */

test('API: the request matches the documented Creators API contract', async () => {
  configure();
  calls.length = 0;
  getItemsResponse = { status: 200, body: { itemsResult: { items: [API_ITEM] } } };

  await client.getItems(['B09B8V1LZ3']);

  const token = calls.find((c) => c.url.includes('/auth/o2/token'))!;
  assert.equal(token.url, 'https://api.amazon.com/auth/o2/token', 'v3.1 uses the NA token host');
  const tokenBody = JSON.parse(String(token.init?.body));
  assert.equal(tokenBody.grant_type, 'client_credentials');
  assert.equal(tokenBody.scope, 'creatorsapi::default');

  const getItems = calls.find((c) => c.url.includes('/catalog/v1/getItems'))!;
  assert.equal(getItems.url, 'https://creatorsapi.amazon/catalog/v1/getItems');
  const headers = getItems.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer test-token-not-a-real-credential');
  assert.equal(headers['x-marketplace'], 'www.amazon.com');

  const itemsBody = JSON.parse(String(getItems.init?.body));
  assert.deepEqual(itemsBody.itemIds, ['B09B8V1LZ3']);
  assert.equal(itemsBody.itemIdType, 'ASIN');
  assert.equal(itemsBody.partnerTag, 'everyfivedays-20');
  assert.ok(Array.isArray(itemsBody.resources) && itemsBody.resources.includes('itemInfo.title'));
});

test('API: the token is cached rather than re-minted per call', async () => {
  configure();
  getItemsResponse = { status: 200, body: { itemsResult: { items: [API_ITEM] } } };

  calls.length = 0;
  await client.getItems(['B09B8V1LZ3']);
  await client.getItems(['B09B8V1LZ3']);

  assert.equal(calls.filter((c) => c.url.includes('/auth/o2/token')).length, 1, 'the token should be reused');
  assert.equal(calls.filter((c) => c.url.includes('getItems')).length, 2);
});

test('API: several ASINs go in ONE request — there is no per-article product cap', async () => {
  configure();
  getItemsResponse = { status: 200, body: { itemsResult: { items: [API_ITEM] } } };
  calls.length = 0;

  const many = Array.from({ length: 25 }, (_, i) => `B${String(i).padStart(9, '0')}`);
  await client.getItems(many);

  const getItems = calls.find((c) => c.url.includes('getItems'))!;
  assert.equal(JSON.parse(String(getItems.init?.body)).itemIds.length, 25);
});

test('API: a rejected credential is reported with Amazon\'s own reason', async () => {
  configure();
  client.clearTokenCache();
  tokenResponse = { status: 401, body: { error: 'invalid_client', error_description: 'Client authentication failed' } };

  await assert.rejects(
    () => client.getItems(['B09B8V1LZ3']),
    (error: unknown) =>
      error instanceof client.CreatorsApiError &&
      error.code === 'amazon_auth_failed' &&
      /Client authentication failed/.test(error.message),
  );

  tokenResponse = { status: 200, body: { access_token: 'test-token-not-a-real-credential', expires_in: 3600 } };
});

test('API: a top-level Amazon fault is reported with its own reason, not as a bare status', async () => {
  configure();
  client.clearTokenCache();

  // The exact 403 body a real Associates account returned before it met the
  // sales threshold. Reading only the list form of errors discarded this
  // entirely and reported "HTTP 403", sending the user to re-check
  // credentials that Amazon had already accepted.
  getItemsResponse = {
    status: 403,
    body: {
      message: 'Your account does not currently meet the eligibility requirements.',
      reason: 'AssociateNotEligible',
      type: 'AccessDeniedException',
    },
  };

  await assert.rejects(
    () => client.getItems(['B09B8V1LZ3']),
    (error: unknown) => {
      assert.ok(error instanceof client.CreatorsApiError);
      assert.equal(error.code, 'amazon_not_eligible', 'eligibility is not an authentication failure');
      assert.match(error.message, /AssociateNotEligible/, 'the machine-readable reason must survive');
      assert.match(error.message, /eligibility requirements/, "Amazon's own words must reach the user");
      assert.match(error.remedy ?? '', /10 qualifying sales/, 'the remedy must name the real blocker');
      assert.ok(
        !/Check the credentials/i.test(error.remedy ?? ''),
        'must not send the user to re-check credentials that worked',
      );
      return true;
    },
  );

  getItemsResponse = { status: 200, body: { itemsResult: { items: [API_ITEM] } } };
});

/* ------------------------------------------------- the no-fallback rule */

test('NO FALLBACK: an unconfigured Amazon URL refuses, and reads no page', async () => {
  amazonConfig.updateAmazonConfig({ clientId: '', clientSecret: '', partnerTag: '' });
  client.clearTokenCache();
  calls.length = 0;

  await assert.rejects(
    () => retrieval.retrieveProduct({ url: 'https://www.amazon.com/dp/B09B8V1LZ3' }),
    (error: unknown) =>
      error instanceof retrieval.ProductRetrievalError && error.code === 'amazon_not_configured',
  );

  assert.equal(calls.length, 0, 'nothing was fetched — no page read, no API call');
});

test('NO FALLBACK: an Amazon API failure does not become a page read', async () => {
  configure();
  getItemsResponse = { status: 500, body: { errors: [{ code: 'InternalError', message: 'boom' }] } };
  calls.length = 0;

  await assert.rejects(() => retrieval.retrieveProduct({ url: 'https://www.amazon.com/dp/B09B8V1LZ3' }));

  assert.ok(
    calls.every((c) => c.url.includes('amazon.com/auth') || c.url.includes('creatorsapi.amazon')),
    `only Amazon API calls should have been made, saw: ${calls.map((c) => c.url).join(', ')}`,
  );
});

test('NO FALLBACK: preflight for an Amazon URL talks about the API, not Web Sources', async () => {
  amazonConfig.updateAmazonConfig({ clientId: '', clientSecret: '', partnerTag: '' });

  const preflight = await retrieval.preflightUrl('https://www.amazon.com/dp/B09B8V1LZ3');
  assert.equal(preflight.source, 'amazon_creators_api');
  assert.equal(preflight.permitted, false);
  assert.match(preflight.remedy ?? '', /Settings/);
  assert.ok(!/authorised source list/i.test(preflight.reason), 'must not send the user to Web Sources');
});

/* ------------------------------------------------------- the whole path */

test('END TO END: an Amazon URL becomes a product with the affiliate URL intact', async () => {
  configure();
  getItemsResponse = { status: 200, body: { itemsResult: { items: [API_ITEM] } } };

  const result = await retrieval.retrieveProduct({
    url: 'https://www.amazon.com/dp/B09B8V1LZ3',
    affiliateUrl: AFFILIATE_URL,
  });

  assert.equal(result.created, true);
  assert.equal(result.product.title, 'Echo Dot (5th Gen) Smart Speaker with Alexa');
  assert.equal(result.product.brand, 'Amazon');
  assert.equal(result.product.vendor, 'amazon');
  assert.equal(result.product.researchStatus, 'retrieved');
  assert.ok(result.product.keyFeatures.includes('Alexa built in'));

  // THE RULE. The API supplies product data and never a link.
  assert.equal(result.product.affiliateLink, AFFILIATE_URL, 'the affiliate URL was altered');

  // Nothing was crawled, so there is no retrieval row to point at — recording
  // one would be a fetch that never happened.
  assert.equal(result.retrievalId, null);
});

test('END TO END: the research pass records that it came from the API', async () => {
  const product = products.listProducts({}).find((p) => p.title.startsWith('Echo Dot'))!;
  const research = await import('../src/features/product-research/productResearch.repository.js');
  const latest = research.getLatestResearch(product.id)!;

  assert.equal(latest.extractionMethod, 'creators_api');
  assert.match(latest.notes ?? '', /ASIN B09B8V1LZ3/);
  assert.equal(latest.retrievalId, null);
});

test('END TO END: an ASIN Amazon does not return is an error, not an empty product', async () => {
  configure();
  getItemsResponse = { status: 200, body: { itemsResult: { items: [] }, errors: [{ code: 'ItemNotAccessible', message: 'not found' }] } };

  await assert.rejects(
    () => retrieval.retrieveProduct({ url: 'https://www.amazon.com/dp/B000000001' }),
    (error: unknown) =>
      error instanceof retrieval.ProductRetrievalError && /returned no item/i.test(error.message),
  );
});

test.after(() => {
  globalThis.fetch = realFetch;
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
