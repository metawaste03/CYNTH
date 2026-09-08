/**
 * Model discovery, free/paid classification, and the model registry.
 *
 * NO REAL PROVIDER IS EVER CONTACTED and no credentials are required: the
 * catalogue is served by a local mock on 127.0.0.1 and the API key is a
 * literal test string. Nothing here can spend money.
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

const SCRATCH = path.join(os.tmpdir(), `cynth-models-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;

const KEY_VAR = 'CYNTH_MODELS_TEST_KEY';
process.env[KEY_VAR] = 'test-key-not-a-real-credential';

const dbModule = await import('../src/shared/database/index.js');
const providers = await import('../src/features/ai-providers/aiProviders.repository.js');
const catalog = await import('../src/features/ai-providers/modelCatalog.service.js');
const capabilities = await import('../src/features/ai-providers/modelCapabilities.repository.js');
const validation = await import('../src/features/ai-providers/modelValidation.service.js');
const policy = await import('../src/features/generation/generationPolicy.service.js');
const router = await import('../src/features/model-router/modelRouter.service.js');
const { parseOpenRouterCatalog } = await import('../src/features/generation/providers/openrouterAdapter.js');
const baseUrl = await import('../src/features/generation/providers/baseUrl.js');

/* --------------------------------------------------------- mock catalogue */

/**
 * A stand-in for OpenRouter's /models response, exercising every shape the
 * parser has to survive: string prices, numeric prices, a missing pricing
 * object entirely, a flat per-request charge, and — the important one — a
 * model with "free" in its name that is NOT free.
 */
const CATALOG_BODY = {
  data: [
    {
      id: 'testvendor/genuinely-free',
      name: 'Genuinely Free',
      description: 'Costs nothing.',
      pricing: { prompt: '0', completion: '0', request: '0' },
      context_length: 32768,
      architecture: { input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Test' },
      top_provider: { max_completion_tokens: 4096, is_moderated: false },
      supported_parameters: ['temperature', 'max_tokens'],
      created: 1_700_000_000,
    },
    {
      // The trap: "free" in the name, real prices in the pricing object.
      id: 'testvendor/free-tier-marketing-name',
      name: 'Free Tier Edition',
      pricing: { prompt: '0.000003', completion: '0.000015' },
      context_length: 200000,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      top_provider: { is_moderated: true },
    },
    {
      id: 'testvendor/plain-paid',
      name: 'Plain Paid',
      pricing: { prompt: 0.000001, completion: 0.000002 },
      context_length: 8192,
    },
    {
      // Zero per-token prices but a flat per-request charge. Not free.
      id: 'testvendor/per-request-charge',
      name: 'Per Request Charge',
      pricing: { prompt: '0', completion: '0', request: '0.01' },
      context_length: 4096,
    },
    {
      // No pricing published at all -> unknown, which must never become free.
      id: 'testvendor/no-pricing',
      name: 'No Pricing Published',
      context_length: 16384,
    },
    {
      // OpenRouter's real sentinel for "the price depends on where this
      // routes to". A negative number is not a price.
      id: 'testvendor/sentinel-priced',
      name: 'Auto Router Style',
      pricing: { prompt: '-1', completion: '-1' },
      context_length: 1000000,
    },
    {
      id: 'testvendor/disabled-model',
      name: 'Disabled Model',
      pricing: { prompt: '0', completion: '0' },
      top_provider: { is_disabled: true },
    },
  ],
};

let catalogRequests = 0;
let authorizationSeen: string | undefined;

/** Every chat request the mock received, so a test can assert what a probe actually sent. */
const chatRequests: { model: string; maxTokens: number | undefined; messages: unknown }[] = [];
/** Set by a test to make the next chat request fail with a given status. */
let chatFailureStatus: number | null = null;

const mock = http.createServer((req, res) => {
  if (req.url?.startsWith('/models')) {
    catalogRequests += 1;
    authorizationSeen = req.headers.authorization;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(CATALOG_BODY));
    return;
  }

  // The generation endpoint, so a model TEST can be exercised without any
  // real provider and without any possibility of being charged.
  if (req.url?.startsWith('/chat/completions')) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      chatRequests.push({ model: parsed.model, maxTokens: parsed.max_tokens, messages: parsed.messages });

      if (chatFailureStatus !== null) {
        const status = chatFailureStatus;
        chatFailureStatus = null;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'the provider said no' } }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: parsed.model,
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 },
        }),
      );
    });
    return;
  }

  res.writeHead(404).end('{}');
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
const MOCK_BASE = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

/**
 * A second server that answers everything with an HTML page.
 *
 * This reproduces the exact reported failure: a Base URL pointing at a
 * provider's WEBSITE rather than its API root. The website answers HTTP 200
 * with text/html, so the request succeeds and the parse does not — which
 * produced only "The provider returned a response Cynth could not read".
 */
const websiteMock = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><title>Models</title></head><body><h1>Our models</h1></body></html>');
});
await new Promise<void>((r) => websiteMock.listen(0, '127.0.0.1', r));
const WEBSITE_BASE = `http://127.0.0.1:${(websiteMock.address() as AddressInfo).port}`;

/* --------------------------------------------------------------- fixtures */

dbModule.initializeDatabase();
const db = () => dbModule.getDatabase();

const providerId = Number(
  db()
    .prepare(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
       VALUES ('Mock OpenRouter', 'openrouter', ?, ?, 1)`,
    )
    .run(MOCK_BASE, KEY_VAR).lastInsertRowid,
);

test.after(() => {
  mock.close();
  websiteMock.close();
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

/* ======================== catalogue parsing ============================= */

test('discovery parsing: reads every field the catalogue publishes', () => {
  const parsed = parseOpenRouterCatalog(CATALOG_BODY as never);
  assert.equal(parsed.length, 7, 'every entry with an id is parsed');

  const free = parsed.find((m) => m.id === 'testvendor/genuinely-free')!;
  assert.equal(free.displayName, 'Genuinely Free');
  assert.equal(free.vendor, 'testvendor', 'vendor is read off the id, not hardcoded');
  assert.equal(free.promptPrice, 0);
  assert.equal(free.completionPrice, 0);
  assert.equal(free.contextLength, 32768);
  assert.deepEqual(free.capabilities.inputModalities, ['text']);
  assert.equal(free.capabilities.maxCompletionTokens, 4096);
  assert.equal(free.capabilities.tokenizer, 'Test');
  assert.deepEqual(free.capabilities.supportedParameters, ['temperature', 'max_tokens']);
  assert.ok(free.publishedAt?.startsWith('20'), 'creation date becomes an ISO timestamp');
});

test('discovery parsing: prices arrive as strings or numbers, and absence stays absent', () => {
  const parsed = parseOpenRouterCatalog(CATALOG_BODY as never);

  const stringPriced = parsed.find((m) => m.id === 'testvendor/free-tier-marketing-name')!;
  assert.equal(stringPriced.promptPrice, 0.000003, 'decimal strings are parsed');

  const numberPriced = parsed.find((m) => m.id === 'testvendor/plain-paid')!;
  assert.equal(numberPriced.promptPrice, 0.000001, 'numbers are accepted too');

  const unpriced = parsed.find((m) => m.id === 'testvendor/no-pricing')!;
  assert.equal(unpriced.promptPrice, null, 'a missing price is null, never zero');
  assert.equal(unpriced.completionPrice, null);
});

test('discovery parsing: availability is reported only when the provider states it', () => {
  const parsed = parseOpenRouterCatalog(CATALOG_BODY as never);
  assert.equal(parsed.find((m) => m.id === 'testvendor/disabled-model')!.status, 'disabled');
  assert.equal(
    parsed.find((m) => m.id === 'testvendor/plain-paid')!.status,
    null,
    'no status is invented for a model the provider says nothing about',
  );
});

test('discovery parsing: a malformed body yields no models rather than throwing', () => {
  assert.deepEqual(parseOpenRouterCatalog(null), []);
  assert.deepEqual(parseOpenRouterCatalog({} as never), []);
  assert.deepEqual(parseOpenRouterCatalog({ data: 'nonsense' } as never), []);
  assert.deepEqual(parseOpenRouterCatalog({ data: [{ noId: true }] } as never), []);
});

/* ==================== free / paid classification ======================== */

test('FREE/PAID: classification reads prices, never the model name', () => {
  const parsed = parseOpenRouterCatalog(CATALOG_BODY as never);
  const byId = new Map(parsed.map((m) => [m.id, m]));

  assert.equal(policy.classifyModel(byId.get('testvendor/genuinely-free')!), 'free');

  // The whole point: "Free Tier Edition" is a paid model.
  assert.equal(
    policy.classifyModel(byId.get('testvendor/free-tier-marketing-name')!),
    'paid',
    'a model with "free" in its name is still paid when its prices say so',
  );

  assert.equal(policy.classifyModel(byId.get('testvendor/plain-paid')!), 'paid');

  // Zero per-token prices, but a real per-request charge.
  assert.equal(
    policy.classifyModel(byId.get('testvendor/per-request-charge')!),
    'paid',
    'a flat per-request charge makes a model paid',
  );

  // Unknown must never collapse into free.
  assert.equal(policy.classifyModel(byId.get('testvendor/no-pricing')!), 'unknown');
});

test('FREE/PAID: a negative price is a sentinel, not a price', () => {
  const parsed = parseOpenRouterCatalog(CATALOG_BODY as never);
  const sentinel = parsed.find((m) => m.id === 'testvendor/sentinel-priced')!;

  assert.equal(sentinel.promptPrice, null, 'a -1 price is normalised to unknown');
  assert.equal(sentinel.completionPrice, null);
  assert.equal(
    policy.classifyModel(sentinel),
    'unknown',
    'a model whose price cannot be stated up front is unknown, and unknown is treated as paid',
  );

  // The failure this prevents: a negative price would produce a negative
  // estimated cost, i.e. Cynth telling the user a generation pays them.
  const estimate = policy.estimateCost(sentinel, 4000, 1000);
  assert.equal(estimate.totalCost, null, 'no cost is estimated for a model with no real price');
  assert.equal(estimate.costClass, 'unknown');
});

test('FREE/PAID: a ":free" suffix is not evidence of anything', () => {
  // Naming alone must not move the answer in either direction.
  assert.equal(policy.classifyModel({ promptPrice: 0.001, completionPrice: 0.002 }), 'paid');
  assert.equal(policy.classifyModel({ promptPrice: 0, completionPrice: 0 }), 'free');
  assert.equal(policy.classifyModel({ promptPrice: 0, completionPrice: null }), 'unknown');
});

/* ========================= model discovery ============================== */

test('DISCOVERY: reads the live catalogue and classifies every model', async () => {
  const result = await catalog.discoverModels(providerId, { refresh: true, limit: 100 });

  assert.equal(result.total, 7);
  assert.equal(result.counts.free, 2, 'genuinely-free and disabled-model are both priced at zero');
  assert.equal(result.counts.paid, 3);
  assert.equal(result.counts.unknown, 2, 'unpriced and sentinel-priced models are both unknown');
  assert.equal(result.providerName, 'Mock OpenRouter');
});

test('DISCOVERY: the free filter returns only genuinely free models', async () => {
  const result = await catalog.discoverModels(providerId, { filter: 'free', limit: 100 });

  assert.ok(result.models.length > 0);
  assert.ok(
    result.models.every((m) => m.costClass === 'free'),
    'every returned model is classified free',
  );
  assert.ok(
    !result.models.some((m) => m.id === 'testvendor/free-tier-marketing-name'),
    'the misleadingly-named paid model is excluded',
  );
  assert.ok(result.models.some((m) => m.id === 'testvendor/genuinely-free'));
});

test('DISCOVERY: the paid filter includes the misleadingly-named model', async () => {
  const result = await catalog.discoverModels(providerId, { filter: 'paid', limit: 100 });
  assert.ok(result.models.every((m) => m.costClass === 'paid'));
  assert.ok(result.models.some((m) => m.id === 'testvendor/free-tier-marketing-name'));
  assert.ok(result.models.some((m) => m.id === 'testvendor/per-request-charge'));
});

test('DISCOVERY: unpriced models are filterable as their own class', async () => {
  const result = await catalog.discoverModels(providerId, { filter: 'unknown', limit: 100 });
  assert.equal(result.models.length, 2);
  assert.ok(result.models.some((m) => m.id === 'testvendor/no-pricing'));
  assert.ok(result.models.some((m) => m.id === 'testvendor/sentinel-priced'));
});

test('DISCOVERY: search matches id, display name and vendor', async () => {
  const byId = await catalog.discoverModels(providerId, { search: 'plain-paid', limit: 100 });
  assert.equal(byId.matched, 1);

  const byVendor = await catalog.discoverModels(providerId, { search: 'testvendor', limit: 100 });
  assert.equal(byVendor.matched, 7);

  const byName = await catalog.discoverModels(providerId, { search: 'No Pricing', limit: 100 });
  assert.equal(byName.matched, 1);
});

test('DISCOVERY: the catalogue is cached, and refresh bypasses the cache', async () => {
  // Counted rather than hardcoded: one refresh is not one HTTP call. The
  // OpenRouter adapter reads the general roster AND the image-output roster,
  // because most image models appear only in the second. What matters here is
  // that a cached read costs nothing and a refresh costs a full read.
  const beforeFirst = catalogRequests;
  await catalog.discoverModels(providerId, { refresh: true });
  const perRefresh = catalogRequests - beforeFirst;
  assert.ok(perRefresh >= 1, 'a refresh reads the provider');

  const after = catalogRequests;
  await catalog.discoverModels(providerId, {});
  await catalog.discoverModels(providerId, { filter: 'free' });
  assert.equal(catalogRequests, after, 'repeated reads are served from the cache');

  await catalog.discoverModels(providerId, { refresh: true });
  assert.equal(catalogRequests, after + perRefresh, 'refresh re-reads the provider');
});

test('DISCOVERY: the provider key is sent, and never returned to the caller', async () => {
  await catalog.discoverModels(providerId, { refresh: true });
  assert.equal(authorizationSeen, `Bearer ${process.env[KEY_VAR]}`, 'the key authenticates the read');

  const result = await catalog.discoverModels(providerId, { refresh: true });
  assert.ok(
    !JSON.stringify(result).includes(process.env[KEY_VAR]!),
    'no discovery response may carry the key',
  );
});

/* ========================== model registry ============================== */

test('REGISTRY: adding from the catalogue stores the provider’s own metadata', async () => {
  const entry = (await catalog.findCatalogModel(providerId, 'testvendor/genuinely-free'))!;
  const added = providers.addModelFromCatalog(providerId, entry, {
    modelName: entry.id,
    purposes: ['article_generation'],
  })!;

  assert.equal(added.created, true);
  assert.equal(added.model.modelName, 'testvendor/genuinely-free');
  assert.equal(added.model.displayName, 'Genuinely Free', 'the catalogue name is used when none is supplied');
  assert.equal(added.model.vendor, 'testvendor');
  assert.equal(added.model.promptPrice, 0);
  assert.equal(added.model.completionPrice, 0);
  assert.equal(added.model.contextLength, 32768);
  assert.equal(added.model.isFree, true);
  assert.equal(added.model.costClass, 'free');
  assert.equal(added.model.inCatalog, true);
  assert.deepEqual(added.model.capabilities?.inputModalities, ['text']);
  assert.ok(added.model.pricingSyncedAt, 'the refresh timestamp is recorded');
});

test('REGISTRY: re-adding the same model refreshes it instead of duplicating it', async () => {
  const entry = (await catalog.findCatalogModel(providerId, 'testvendor/genuinely-free'))!;

  const before = providers.listRegisteredModelNames(providerId).filter((n) => n === entry.id).length;
  const again = providers.addModelFromCatalog(providerId, entry, { modelName: entry.id })!;
  const after = providers.listRegisteredModelNames(providerId).filter((n) => n === entry.id).length;

  assert.equal(again.created, false, 'the second add is a refresh, not an insert');
  assert.equal(before, 1);
  assert.equal(after, 1, 'still exactly one registry row for this model');
});

test('REGISTRY: re-adding preserves the user’s own configuration', async () => {
  const entry = (await catalog.findCatalogModel(providerId, 'testvendor/genuinely-free'))!;
  const model = providers
    .getProviderById(providerId)!
    .models.find((m) => m.modelName === entry.id)!;

  providers.setModelDefaultForPurpose(providerId, model.id, 'article_generation');
  const configured = providers.getProviderById(providerId)!.models.find((m) => m.id === model.id)!;
  assert.equal(configured.isDefaultForPurpose, true);

  providers.addModelFromCatalog(providerId, entry, { modelName: entry.id });

  const after = providers.getProviderById(providerId)!.models.find((m) => m.id === model.id)!;
  assert.deepEqual(
    after.assignedCapabilities.map((c) => c.purpose),
    ['article_generation'],
    'the capability set survives a refresh',
  );
  assert.equal(
    after.assignedCapabilities.find((c) => c.purpose === 'article_generation')!.isDefaultForPurpose,
    true,
    'and so does the default-for-purpose flag',
  );
  assert.equal(after.isEnabled, true);
});

test('CAPABILITIES: one model holds several capabilities, in ONE registry row', async () => {
  const entry = (await catalog.findCatalogModel(providerId, 'testvendor/genuinely-free'))!;

  // Already registered for article_generation by the tests above. Adding it
  // for SEO Review must extend what the model does, not create a second entry
  // for the same model: through Milestone 14 this produced two rows that had
  // to be priced, validated and chosen between separately.
  const second = providers.addModelFromCatalog(providerId, entry, {
    modelName: entry.id,
    purposes: ['seo_review'],
  })!;

  assert.equal(second.created, false, 'an additional capability is not an additional model');
  assert.deepEqual(
    second.model.assignedCapabilities.map((c) => c.purpose).sort(),
    ['article_generation', 'seo_review'],
    'the model now does both jobs',
  );

  const rows = providers.getProviderById(providerId)!.models.filter((m) => m.modelName === entry.id);
  assert.equal(rows.length, 1, 'exactly one registry row for one model');

  assert.equal(
    rows[0].assignedCapabilities.find((c) => c.purpose === 'article_generation')!.isDefaultForPurpose,
    true,
    'adding a capability never disturbs a default the user already set',
  );
});

test('CAPABILITIES: purpose filtering separates article models from SEO models', async () => {
  const seoOnly = (await catalog.findCatalogModel(providerId, 'testvendor/free-tier-marketing-name'))!;
  providers.addModelFromCatalog(providerId, seoOnly, {
    modelName: seoOnly.id,
    purposes: ['seo_review'],
  });

  const articleModels = providers.listSelectableModels('article_generation');
  const seoModels = providers.listSelectableModels('seo_review');

  assert.ok(
    articleModels.some((m) => m.modelName === 'testvendor/genuinely-free'),
    'the dual-capability model writes articles',
  );
  assert.ok(
    !articleModels.some((m) => m.modelName === seoOnly.id),
    'an SEO-only model is never offered for article generation',
  );
  assert.ok(seoModels.some((m) => m.modelName === seoOnly.id), 'and it IS offered for SEO review');
  assert.ok(
    seoModels.some((m) => m.modelName === 'testvendor/genuinely-free'),
    'a model with both capabilities appears under both',
  );
});

test('CAPABILITIES: removing a capability leaves that purpose unset, not reassigned', async () => {
  const model = providers
    .getProviderById(providerId)!
    .models.find((m) => m.modelName === 'testvendor/genuinely-free')!;

  providers.setModelDefaultForPurpose(providerId, model.id, 'seo_review');
  assert.equal(capabilities.defaultModelIdForPurpose('seo_review'), model.id);

  capabilities.removeCapability(model.id, 'seo_review');

  assert.equal(
    capabilities.defaultModelIdForPurpose('seo_review'),
    null,
    'the purpose is left deliberately unset rather than reassigned to another model',
  );
  assert.equal(
    capabilities.defaultModelIdForPurpose('article_generation'),
    model.id,
    'and the other capability is untouched',
  );

  capabilities.addCapability(model.id, 'seo_review');
});

test('CAPABILITIES: an unknown capability is refused rather than stored', () => {
  const model = providers
    .getProviderById(providerId)!
    .models.find((m) => m.modelName === 'testvendor/genuinely-free')!;

  const result = capabilities.addCapability(model.id, 'interpretive_dance');
  assert.ok(result.errors.length, 'an unknown capability is an error');
  assert.ok(
    !result.capabilities.some((c) => c.purpose === 'interpretive_dance'),
    'and nothing was written',
  );
});

test('CAPABILITIES: a model cannot be default for a capability it does not hold', () => {
  const model = providers
    .getProviderById(providerId)!
    .models.find((m) => m.modelName === 'testvendor/genuinely-free')!;

  const result = providers.setModelDefaultForPurpose(providerId, model.id, 'keyword_expansion');
  assert.ok(result.errors.length, 'refused');
  assert.equal(capabilities.defaultModelIdForPurpose('keyword_expansion'), null);
});

test('REGISTRY: a paid model records its real prices, not zeroes', async () => {
  const entry = (await catalog.findCatalogModel(providerId, 'testvendor/free-tier-marketing-name'))!;
  const added = providers.addModelFromCatalog(providerId, entry, { modelName: entry.id })!;

  assert.equal(added.model.promptPrice, 0.000003);
  assert.equal(added.model.completionPrice, 0.000015);
  assert.equal(added.model.isFree, false, 'despite the name');
  assert.equal(added.model.costClass, 'paid');
});

test('REGISTRY: an unpriced model is stored as unknown, never as free', async () => {
  const entry = (await catalog.findCatalogModel(providerId, 'testvendor/no-pricing'))!;
  const added = providers.addModelFromCatalog(providerId, entry, { modelName: entry.id })!;

  assert.equal(added.model.promptPrice, null);
  assert.equal(added.model.isFree, null, 'unknown is stored as NULL, not as 0 or 1');
  assert.equal(added.model.costClass, 'unknown');
});

/* ======================= catalogue refresh ============================== */

test('REFRESH: updates provider metadata and preserves user configuration', async () => {
  const result = await catalog.refreshProviderModels(providerId);

  assert.ok(result.updated >= 3, 'every registered model still in the catalogue was refreshed');
  assert.equal(result.catalogSize, 7);
  assert.equal(result.counts.free, 2);

  const models = providers.getProviderById(providerId)!.models;
  const defaulted = models.find((m) =>
    m.assignedCapabilities.some((c) => c.purpose === 'article_generation' && c.isDefaultForPurpose),
  );
  assert.ok(defaulted, 'a refresh never clears the default-for-purpose flag');
});

test('REFRESH: a model that vanishes from the catalogue keeps its last known pricing', async () => {
  // A model Cynth knows about that the mock catalogue does not list.
  providers.addModel(providerId, {
    modelName: 'testvendor/retired-model',
    displayName: 'Retired',
    purposes: [],
    isEnabled: true,
  });
  dbModule
    .getDatabase()
    .prepare(
      `UPDATE ai_provider_models SET prompt_price = 0.00001, completion_price = 0.00002
       WHERE provider_id = ? AND model_name = 'testvendor/retired-model'`,
    )
    .run(providerId);

  const result = await catalog.refreshProviderModels(providerId);
  assert.ok(result.missingFromCatalog.includes('testvendor/retired-model'), 'the absence is reported');

  const retired = providers
    .getProviderById(providerId)!
    .models.find((m) => m.modelName === 'testvendor/retired-model')!;

  assert.equal(retired.promptPrice, 0.00001, 'stale pricing is kept rather than blanked');
  assert.equal(retired.inCatalog, false, 'but the model is flagged as no longer listed');
  assert.equal(
    retired.costClass,
    'paid',
    'keeping the price keeps the class — blanking it would have made this look free',
  );
});

/* ========================= model selection ============================== */

test('SELECTION: selectable models carry their provider and cost class', () => {
  const selectable = providers.listSelectableModels();

  assert.ok(selectable.length >= 3);
  for (const model of selectable) {
    assert.equal(model.providerName, 'Mock OpenRouter');
    assert.ok(['free', 'paid', 'unknown'].includes(model.costClass));
    assert.equal(model.hasApiKey, true);
  }

  const free = selectable.find((m) => m.modelName === 'testvendor/genuinely-free')!;
  assert.equal(free.costClass, 'free');

  const misleading = selectable.find((m) => m.modelName === 'testvendor/free-tier-marketing-name')!;
  assert.equal(misleading.costClass, 'paid');
});

test('SELECTION: no selectable model response carries an API key', () => {
  const dump = JSON.stringify(providers.listSelectableModels());
  assert.ok(!dump.includes(process.env[KEY_VAR]!), 'the key value must never be exposed');
});

test('SELECTION: the router refuses a model not registered for the task', () => {
  const selectable = providers.listSelectableModels();
  // Registered for SEO Review only, by the capability tests above.
  const seoOnly = selectable.find((m) => m.modelName === 'testvendor/free-tier-marketing-name')!;

  const routed = router.routeForModel('article_generation', seoOnly.modelId);
  assert.ok(!('errors' in routed));
  if ('errors' in routed) return;

  assert.equal(routed.configured, false, 'an SEO model does not become an article model on request');
  assert.equal(routed.model, null, 'and nothing is substituted for it');
  assert.match(routed.reason ?? '', /not registered for this task/);
});

test('SELECTION: the router resolves the exact model asked for', () => {
  const selectable = providers.listSelectableModels();
  const paid = selectable.find((m) => m.modelName === 'testvendor/free-tier-marketing-name')!;

  // Give it the capability the previous test proved it needed.
  capabilities.addCapability(paid.modelId, 'article_generation');

  const routed = router.routeForModel('article_generation', paid.modelId);
  assert.ok(!('errors' in routed));
  if ('errors' in routed) return;

  assert.equal(routed.configured, true);
  assert.equal(routed.isExplicitSelection, true, 'the route knows this was a deliberate choice');
  assert.equal(routed.model!.modelName, 'testvendor/free-tier-marketing-name');
  assert.equal(routed.model!.costClass, 'paid');
  assert.equal(routed.provider!.name, 'Mock OpenRouter');
});

test('SELECTION: a disabled model is refused, never swapped for a working one', () => {
  const selectable = providers.listSelectableModels();
  const target = selectable.find((m) => m.modelName === 'testvendor/no-pricing')!;

  providers.setModelEnabled(providerId, target.modelId, false);

  const routed = router.routeForModel('article_generation', target.modelId);
  assert.ok(!('errors' in routed));
  if ('errors' in routed) return;

  assert.equal(routed.configured, false, 'a disabled model does not resolve');
  assert.equal(routed.model, null, 'and no substitute model is offered in its place');
  assert.match(routed.reason!, /disabled/i);

  providers.setModelEnabled(providerId, target.modelId, true);
});

test('SELECTION: a model that no longer exists resolves to nothing, not to the default', () => {
  const routed = router.routeForModel('article_generation', 999_999);
  assert.ok(!('errors' in routed));
  if ('errors' in routed) return;

  assert.equal(routed.configured, false);
  assert.equal(routed.model, null, 'the purpose default must not be silently substituted');
});

/* ========================== model validation ============================ */

test('VALIDATION: the pipeline reports every stage, in order', async () => {
  const result = await validation.validateModel({
    providerId,
    modelName: 'testvendor/genuinely-free',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.stages.map((stage) => stage.stage),
    ['configuration', 'endpoint', 'credential', 'catalog', 'live_probe', 'normalisation'],
    'the stage order is the diagnosis: each rules out one class of failure',
  );
  assert.ok(
    result.stages.every((stage) => stage.detail.length > 0),
    'every stage says what it established, not just whether it passed',
  );
});

/**
 * THE REPORTED BUG.
 *
 * A Base URL pointing at a provider's website answers HTTP 200 with an HTML
 * page. That used to surface as "The provider returned a response Cynth could
 * not read" — true, and impossible to act on. Validation must name the
 * endpoint as the problem instead.
 */
test('VALIDATION: a Base URL pointing at a website is diagnosed as an endpoint problem', async () => {
  const websiteProviderId = Number(
    db()
      .prepare(
        `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
         VALUES ('Website URL Provider', 'openrouter', ?, ?, 1)`,
      )
      .run(WEBSITE_BASE, KEY_VAR).lastInsertRowid,
  );

  const result = await validation.validateModel({
    providerId: websiteProviderId,
    modelName: 'testvendor/genuinely-free',
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedStage, 'catalog', 'the catalogue read is where the HTML arrives');
  assert.match(
    result.message,
    /HTML web page/i,
    'the message says WHAT came back, not merely that it was unreadable',
  );
  assert.match(result.message, /Base URL/i, 'and names the setting that is wrong');
  assert.ok(
    !/could not read the response\.?$/i.test(result.message),
    'the old unactionable message must not be what the user sees',
  );
});

test('VALIDATION: a known provider host without its API path is refused before any request', () => {
  const { diagnoseBaseUrl } = baseUrl;

  const wrong = diagnoseBaseUrl('https://openrouter.ai/', 'openrouter');
  assert.equal(wrong.ok, false);
  assert.match(wrong.problem!, /website, not its API endpoint/);
  assert.equal(wrong.suggestion, 'https://openrouter.ai/api/v1', 'the correction is quoted, not applied');

  const right = diagnoseBaseUrl('https://openrouter.ai/api/v1', 'openrouter');
  assert.equal(right.ok, true);

  const unset = diagnoseBaseUrl(null, 'openrouter');
  assert.equal(unset.ok, true);
  assert.equal(unset.resolved, 'https://openrouter.ai/api/v1', 'an unset Base URL uses the adapter default');

  const notAUrl = diagnoseBaseUrl('openrouter.ai/api/v1', 'openrouter');
  assert.equal(notAUrl.ok, false, 'a scheme-less value is refused');
});

test('VALIDATION: an unknown model id fails at the catalogue stage, and says so', async () => {
  const result = await validation.validateModel({
    providerId,
    modelName: 'testvendor/does-not-exist',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'model_not_found');
  assert.equal(result.failedStage, 'catalog');
  assert.match(result.message, /does not list a model called/);
  assert.ok(
    result.stages.find((stage) => stage.stage === 'credential')!.ok,
    'the credential stage still passed — the failure is specifically the model id',
  );
});

test('VALIDATION: a model the provider reports as disabled is refused', async () => {
  const result = await validation.validateModel({ providerId, modelName: 'testvendor/disabled-model' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'model_unavailable');
  assert.match(result.message, /disabled/);
});

test('VALIDATION: a missing API key fails at the credential stage, not the catalogue', async () => {
  const keylessId = Number(
    db()
      .prepare(
        `INSERT INTO ai_providers (name, provider_type, base_url, is_active)
         VALUES ('No Key Provider', 'openrouter', ?, 1)`,
      )
      .run(MOCK_BASE).lastInsertRowid,
  );

  const result = await validation.validateModel({ providerId: keylessId, modelName: 'testvendor/genuinely-free' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_api_key');
  assert.equal(result.failedStage, 'credential');
  assert.ok(
    !result.stages.some((stage) => stage.stage === 'catalog'),
    'the pipeline stops rather than reporting a downstream symptom',
  );
});

test('VALIDATION: an unsupported provider type is named as such', async () => {
  const oddId = Number(
    db()
      .prepare(
        `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
         VALUES ('Unknown Type', 'not-a-real-provider', ?, ?, 1)`,
      )
      .run(MOCK_BASE, KEY_VAR).lastInsertRowid,
  );

  const result = await validation.validateModel({ providerId: oddId, modelName: 'anything' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unsupported_provider');
  assert.equal(result.failedStage, 'configuration');
});

/* ============================= model test =============================== */

test('TEST MODEL: a free model is probed with a minimal request, and no article is created', async () => {
  const before = chatRequests.length;
  const result = await validation.validateModel({ providerId, modelName: 'testvendor/genuinely-free' });

  assert.equal(result.ok, true);
  assert.equal(result.liveProbeRan, true);
  assert.equal(chatRequests.length, before + 1, 'exactly one request was sent');

  const sent = chatRequests[chatRequests.length - 1];
  assert.equal(sent.model, 'testvendor/genuinely-free', 'the model asked for is the model sent');
  assert.ok(sent.maxTokens !== undefined && sent.maxTokens <= 16, 'the output is hard-capped: this is a test, not an article');
  assert.equal((sent.messages as { content: string }[]).length, 1, 'one short message, not an assembled article prompt');
  assert.ok(
    (sent.messages as { content: string }[])[0].content.length < 60,
    'the probe prompt is a handful of words',
  );

  assert.equal(result.probe!.reportedModel, 'testvendor/genuinely-free');
  assert.equal(result.probe!.promptTokens, 8, 'usage is reported exactly as the provider gave it');
});

test('TEST MODEL: a PAID model is never probed without explicit permission', async () => {
  const before = chatRequests.length;
  const result = await validation.validateModel({
    providerId,
    modelName: 'testvendor/free-tier-marketing-name',
  });

  assert.equal(result.ok, true, 'the catalogue stages still verified the model');
  assert.equal(result.costClass, 'paid');
  assert.equal(result.liveProbeRan, false, 'and nothing chargeable was sent');
  assert.equal(chatRequests.length, before, 'no request reached the provider at all');
  assert.match(result.message, /nothing was charged/i);

  const probeStage = result.stages.find((stage) => stage.stage === 'live_probe')!;
  assert.equal(probeStage.skipped, true, 'a skipped stage is marked skipped, never counted as a pass');
});

test('TEST MODEL: an unpriced model is treated as paid, not as free', async () => {
  const before = chatRequests.length;
  const result = await validation.validateModel({ providerId, modelName: 'testvendor/no-pricing' });

  assert.equal(result.costClass, 'unknown');
  assert.equal(result.liveProbeRan, false, 'unknown pricing is never assumed to be free');
  assert.equal(chatRequests.length, before);
});

test('TEST MODEL: a per-request charge makes a zero-per-token model chargeable', async () => {
  const before = chatRequests.length;
  const result = await validation.validateModel({ providerId, modelName: 'testvendor/per-request-charge' });

  assert.equal(result.costClass, 'paid', 'a flat request charge is a charge');
  assert.equal(chatRequests.length, before, 'so it is not probed unasked');
});

test('TEST MODEL: with permission, a paid model IS probed, and the cost is stated up front', async () => {
  const entry = (await catalog.findCatalogModel(providerId, 'testvendor/free-tier-marketing-name'))!;
  const estimate = validation.estimateProbeCost(entry);
  assert.ok(estimate !== null && estimate > 0, 'the cost is computed from published prices, never guessed');

  const before = chatRequests.length;
  const result = await validation.validateModel({
    providerId,
    modelName: 'testvendor/free-tier-marketing-name',
    allowLiveProbe: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.liveProbeRan, true);
  assert.equal(chatRequests.length, before + 1);
});

test('TEST MODEL: an unpriced model has no cost estimate rather than a made-up one', async () => {
  const entry = (await catalog.findCatalogModel(providerId, 'testvendor/no-pricing'))!;
  assert.equal(validation.estimateProbeCost(entry), null, 'unknown is null, never zero');
});

test('TEST MODEL: a provider rejection during the probe is reported with its own code', async () => {
  chatFailureStatus = 401;
  const result = await validation.validateModel({ providerId, modelName: 'testvendor/genuinely-free' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'authentication_failed');
  assert.equal(result.failedStage, 'live_probe');
  assert.match(result.message, /rejected Cynth/i);
});

test('TEST MODEL: a failed test records the failure without inventing a passing state', async () => {
  const entry = (await catalog.findCatalogModel(providerId, 'testvendor/plain-paid'))!;
  const added = providers.addModelFromCatalog(providerId, entry, {
    modelName: entry.id,
    purposes: ['article_generation'],
  })!;

  providers.recordTestState(
    added.model.id,
    { status: 'failed', mode: 'live', message: 'The provider rejected the request.' },
    'authentication_failed',
  );
  const failed = providers.getModel(providerId, added.model.id)!;
  assert.equal(failed.validation.status, 'invalid');
  assert.equal(failed.validation.lastTest!.status, 'failed');
  assert.equal(failed.validation.code, 'authentication_failed');

  providers.recordTestState(added.model.id, { status: 'passed', mode: 'live', message: 'It works.' }, null);
  const passed = providers.getModel(providerId, added.model.id)!;
  assert.equal(passed.validation.status, 'valid');
  assert.equal(passed.validation.code, null, 'a pass clears the stored reason rather than leaving a stale one');
  assert.ok(passed.validation.lastTest!.testedAt, 'and stamps when it was tested');
});

/**
 * A model saved before this milestone has no validation state, and must not
 * be presented as though something had checked it.
 */
test('REGISTRY: a model nothing has validated reads as unvalidated, not as valid', () => {
  const added = providers.addModel(providerId, {
    modelName: 'testvendor/hand-typed',
    displayName: 'Hand Typed',
    purposes: ['article_generation'],
    isEnabled: true,
  })!;

  assert.equal(added.validation.status, 'unvalidated');
  assert.equal(added.validation.lastTest, null);
});

test('REGISTRY: changing a model id clears what was verified about the old one', () => {
  const model = providers
    .getProviderById(providerId)!
    .models.find((m) => m.modelName === 'testvendor/hand-typed')!;

  providers.recordValidationState(model.id, { status: 'valid', code: null, message: 'checked' });
  assert.equal(providers.getModel(providerId, model.id)!.validation.status, 'valid');

  // Renaming only the display name leaves the verification intact...
  providers.updateModel(providerId, model.id, {
    modelName: 'testvendor/hand-typed',
    displayName: 'Renamed',
    purposes: ['article_generation'],
    isEnabled: true,
  });
  assert.equal(providers.getModel(providerId, model.id)!.validation.status, 'valid');

  // ...but changing the MODEL ID invalidates it: the stored result described
  // a different model, and carrying it over would report the new one as
  // checked when nothing had checked it.
  providers.updateModel(providerId, model.id, {
    modelName: 'testvendor/hand-typed-v2',
    displayName: 'Renamed',
    purposes: ['article_generation'],
    isEnabled: true,
  });
  assert.equal(providers.getModel(providerId, model.id)!.validation.status, 'unvalidated');
});

/* ============================ security ================================= */

test('SECURITY: no key material reaches the database', () => {
  const dump =
    JSON.stringify(db().prepare('SELECT * FROM ai_providers').all()) +
    JSON.stringify(db().prepare('SELECT * FROM ai_provider_models').all());

  assert.ok(!dump.includes(process.env[KEY_VAR]!), 'the key value must never be persisted');
  assert.ok(dump.includes(KEY_VAR), 'only the env var NAME is stored');
});
