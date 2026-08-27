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
const policy = await import('../src/features/generation/generationPolicy.service.js');
const router = await import('../src/features/model-router/modelRouter.service.js');
const { parseOpenRouterCatalog } = await import('../src/features/generation/providers/openrouterAdapter.js');

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

const mock = http.createServer((req, res) => {
  if (req.url?.startsWith('/models')) {
    catalogRequests += 1;
    authorizationSeen = req.headers.authorization;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(CATALOG_BODY));
    return;
  }
  res.writeHead(404).end('{}');
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
const MOCK_BASE = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

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
  await catalog.discoverModels(providerId, { refresh: true });
  const after = catalogRequests;

  await catalog.discoverModels(providerId, {});
  await catalog.discoverModels(providerId, { filter: 'free' });
  assert.equal(catalogRequests, after, 'repeated reads are served from the cache');

  await catalog.discoverModels(providerId, { refresh: true });
  assert.equal(catalogRequests, after + 1, 'refresh re-reads the provider');
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
    purpose: 'article_generation',
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

  providers.setModelDefaultForPurpose(providerId, model.id);
  const configured = providers.getProviderById(providerId)!.models.find((m) => m.id === model.id)!;
  assert.equal(configured.isDefaultForPurpose, true);

  providers.addModelFromCatalog(providerId, entry, { modelName: entry.id });

  const after = providers.getProviderById(providerId)!.models.find((m) => m.id === model.id)!;
  assert.equal(after.purpose, 'article_generation', 'purpose survives a refresh');
  assert.equal(after.isDefaultForPurpose, true, 'the default-for-purpose flag survives a refresh');
  assert.equal(after.isEnabled, true);
});

test('REGISTRY: the same model can serve two purposes without being a duplicate', async () => {
  const entry = (await catalog.findCatalogModel(providerId, 'testvendor/genuinely-free'))!;

  // Already registered for article_generation by the tests above. Registering
  // it for a SECOND purpose is a real configuration, not a duplicate — the
  // registry has always allowed it, and a purpose-blind upsert would have
  // silently rewritten the first row's purpose instead.
  const second = providers.addModelFromCatalog(providerId, entry, {
    modelName: entry.id,
    purpose: 'seo_review',
  })!;

  assert.equal(second.created, true, 'a new purpose gets its own registry row');
  assert.equal(second.model.purpose, 'seo_review');

  const rows = providers
    .getProviderById(providerId)!
    .models.filter((m) => m.modelName === entry.id);

  assert.equal(rows.length, 2, 'exactly two rows: one per purpose');
  assert.deepEqual(
    rows.map((r) => r.purpose).sort(),
    ['article_generation', 'seo_review'],
    'and the original purpose was not overwritten',
  );

  // Adding it AGAIN for seo_review refreshes rather than making a third row.
  const third = providers.addModelFromCatalog(providerId, entry, {
    modelName: entry.id,
    purpose: 'seo_review',
  })!;
  assert.equal(third.created, false);
  assert.equal(
    providers.getProviderById(providerId)!.models.filter((m) => m.modelName === entry.id).length,
    2,
    'still two rows',
  );
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
  const defaulted = models.find((m) => m.isDefaultForPurpose);
  assert.ok(defaulted, 'a refresh never clears the default-for-purpose flag');
  assert.equal(defaulted!.purpose, 'article_generation');
});

test('REFRESH: a model that vanishes from the catalogue keeps its last known pricing', async () => {
  // A model Cynth knows about that the mock catalogue does not list.
  providers.addModel(providerId, {
    modelName: 'testvendor/retired-model',
    displayName: 'Retired',
    purpose: null,
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

test('SELECTION: the router resolves the exact model asked for', () => {
  const selectable = providers.listSelectableModels();
  const paid = selectable.find((m) => m.modelName === 'testvendor/free-tier-marketing-name')!;

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

/* ============================ security ================================= */

test('SECURITY: no key material reaches the database', () => {
  const dump =
    JSON.stringify(db().prepare('SELECT * FROM ai_providers').all()) +
    JSON.stringify(db().prepare('SELECT * FROM ai_provider_models').all());

  assert.ok(!dump.includes(process.env[KEY_VAR]!), 'the key value must never be persisted');
  assert.ok(dump.includes(KEY_VAR), 'only the env var NAME is stored');
});
