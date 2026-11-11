/**
 * Cynth generation pipeline tests.
 *
 * Covers the path from editorial configuration to a persisted Draft, using a
 * local mock provider. NO REAL AI PROVIDER IS EVER CONTACTED and no
 * credentials are required — the mock listens on 127.0.0.1 and the API key is
 * a literal test string.
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

const SCRATCH = path.join(os.tmpdir(), `cynth-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;

const KEY_VAR = 'CYNTH_PIPELINE_TEST_KEY';
process.env[KEY_VAR] = 'test-key-not-a-real-credential';

const dbModule = await import('../src/shared/database/index.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const articles = await import('../src/features/articles/articles.repository.js');
const policy = await import('../src/features/generation/generationPolicy.service.js');
const { buildGenerationContext } = await import('../src/features/generation/generationContext.service.js');
const { buildPrompt, PROMPT_VERSION } = await import('../src/features/prompt-builder/promptBuilder.service.js');
const { generateArticle, getGenerationPreflight } = await import('../src/features/generation/generation.service.js');
const { listGenerationHistoryForArticle } = await import('../src/features/generation/generationHistory.repository.js');

/* ---------------------------------------------------------- mock provider */

let lastRequestBody: any = null;
let providerCalls = 0;
/**
 * Makes the next provider call fail, so the free-model-safety test can prove
 * what Cynth does NOT do afterwards: no retry, and no second model.
 */
let failNextRequest = false;
let nextContent = '# Mock Heading\n\nMock body.';

const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    providerCalls += 1;
    try {
      lastRequestBody = JSON.parse(raw);
    } catch {
      lastRequestBody = raw;
    }

    if (failNextRequest) {
      failNextRequest = false;
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Mock provider failure.' } }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'mock-model',
        choices: [{ message: { content: nextContent }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      }),
    );
  });
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
const MOCK_BASE = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

/* --------------------------------------------------------------- fixtures */

dbModule.initializeDatabase();
/**
 * Always re-read the handle: one test deliberately closes and reopens the
 * database, which invalidates any handle captured at module load.
 */
const db = () => dbModule.getDatabase();
const project = content.getDefaultProject()!;

const themeA = content.createTheme(project.id, { name: 'Test Theme A', description: 'Theme A guidance.' });
const themeB = content.createTheme(project.id, { name: 'Test Theme B', description: null });

const topicA = content.createTopic(themeA.id, {
  title: 'Topic In A',
  description: 'Topic description.',
  notes: null,
  scope: 'SCOPE-MARKER',
  keyAreas: 'KEYAREAS-MARKER',
  considerations: 'CONSIDERATIONS-MARKER',
  exclusions: 'EXCLUSIONS-MARKER',
});
const topicB = content.createTopic(themeB.id, { title: 'Topic In B', description: null, notes: null });

const authorA = authorsRepo.createAuthor({
  name: 'Author A',
  shortBiography: 'IDENTITY-MARKER',
  expertise: 'EXPERTISE-MARKER',
  perspective: 'PERSPECTIVE-MARKER',
  writingStyle: 'VOICE-MARKER',
  tone: 'TONE-MARKER',
  targetAudience: 'AUDIENCE-MARKER',
  editorialPrinciples: 'PRINCIPLES-MARKER',
  boundaries: 'BOUNDARIES-MARKER',
  writingNotes: 'GUIDANCE-MARKER',
} as never);
const authorB = authorsRepo.createAuthor({ name: 'Author B' } as never);

content.setAuthorThemes(authorA.id, [themeA.id]);
content.setAuthorThemes(authorB.id, [themeB.id]);

const providerId = Number(
  db()
    .prepare(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
       VALUES ('Mock Provider', 'openai', ?, ?, 1)`,
    )
    .run(MOCK_BASE, KEY_VAR).lastInsertRowid,
);
const modelId = Number(
  db()
    .prepare(
      `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled,
        prompt_price, completion_price, is_free)
       VALUES (?, 'mock-model', 1, 0, 0, 1)`,
    )
    .run(providerId).lastInsertRowid,
);

/**
 * Registers a model for a purpose.
 *
 * Milestone 15 replaced `ai_provider_models.purpose` with the
 * `ai_model_capabilities` table — a model now holds a SET of capabilities, and
 * the old column is deprecated and unread. Routing therefore has to come from
 * here rather than from a column on the model row.
 */
function registerCapability(id: number, purpose: string, isDefault = false): void {
  db()
    .prepare(
      `INSERT OR IGNORE INTO ai_model_capabilities (model_id, purpose, is_default_for_purpose)
       VALUES (?, ?, ?)`,
    )
    .run(id, purpose, isDefault ? 1 : 0);
}

registerCapability(modelId, 'article_generation', true);

function makeDraft(themeId: number | null, topicId: number | null, authorId: number) {
  return articles.createArticleDraft({
    articleTypeId: 1,
    authorId,
    productId: null,
    projectId: project.id,
    themeId,
    topicId,
    title: 'Working Title',
    topic: 'Fallback subject',
    targetAudience: 'Testers',
    searchIntent: 'Informational',
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: 'kw',
    secondaryKeywords: null,
  } as never);
}

const setPricing = (prompt: number | null, completion: number | null) =>
  db()
    .prepare('UPDATE ai_provider_models SET prompt_price = ?, completion_price = ? WHERE id = ?')
    .run(prompt, completion, modelId);

test.after(() => {
  mock.close();
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

/* ============================== the tests =============================== */

test('Theme -> Topic: a topic belongs to exactly one theme', () => {
  assert.equal(topicA.themeId, themeA.id);
  assert.equal(topicB.themeId, themeB.id);
  assert.deepEqual(content.listTopics({ themeId: themeA.id }).map((t) => t.id), [topicA.id]);
  assert.deepEqual(content.listTopics({ themeId: themeB.id }).map((t) => t.id), [topicB.id]);
});

test('Theme -> Author: coverage is many-to-many, not one-to-one', () => {
  assert.deepEqual(content.listAuthorsForTheme(themeA.id).map((a) => a.id), [authorA.id]);

  // One author can cover several themes.
  content.setAuthorThemes(authorA.id, [themeA.id, themeB.id]);
  assert.equal(content.listThemesForAuthor(authorA.id).length, 2);
  assert.equal(content.listAuthorsForTheme(themeB.id).length, 2);

  // And reassignment replaces rather than accumulates.
  content.setAuthorThemes(authorA.id, [themeA.id]);
  assert.equal(content.listThemesForAuthor(authorA.id).length, 1);
});

test('generation context resolves the full editorial configuration', () => {
  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  const ctx = buildGenerationContext(draft.id)!;

  assert.equal(ctx.project?.id, project.id);
  assert.equal(ctx.theme?.name, 'Test Theme A');
  assert.equal(ctx.topic?.scope, 'SCOPE-MARKER');
  assert.equal(ctx.author?.expertise, 'EXPERTISE-MARKER');
  assert.equal(ctx.author?.boundaries, 'BOUNDARIES-MARKER');
  assert.equal(ctx.articleType?.name, 'Product Review');
});

test('prompt construction includes every configured layer, in hierarchy order', () => {
  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  const built = buildPrompt(draft.id);
  assert.ok(!('errors' in built), 'prompt should build');
  if ('errors' in built) return;

  for (const marker of [
    'SCOPE-MARKER', 'KEYAREAS-MARKER', 'CONSIDERATIONS-MARKER', 'EXCLUSIONS-MARKER',
    'IDENTITY-MARKER', 'EXPERTISE-MARKER', 'PERSPECTIVE-MARKER', 'VOICE-MARKER',
    'TONE-MARKER', 'AUDIENCE-MARKER', 'PRINCIPLES-MARKER', 'BOUNDARIES-MARKER', 'GUIDANCE-MARKER',
  ]) {
    assert.ok(built.prompt.includes(marker), `prompt should carry ${marker}`);
  }

  // Hierarchy: system rules first, then project/theme, then topic.
  const order = ['=== SYSTEM RULES ===', '=== PROJECT & THEMATIC AREA ===', '=== TOPIC ===', '=== ARTICLE ===', '=== AUTHOR ==='];
  const positions = order.map((s) => built.prompt.indexOf(s));
  assert.ok(positions.every((p) => p >= 0), 'all sections present');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'sections in hierarchy order');
  assert.equal(built.promptVersion, PROMPT_VERSION);
});

test('prompt omits sections for configuration the user has not supplied', () => {
  const draft = makeDraft(null, null, authorB.id);
  const built = buildPrompt(draft.id);
  if ('errors' in built) return assert.fail(built.errors.join(' '));

  assert.ok(!built.prompt.includes('=== TOPIC ==='), 'no topic section without a topic');
  assert.ok(built.prompt.includes('Fallback subject'), 'legacy free-text subject still used');
  assert.ok(built.prompt.includes('=== SYSTEM RULES ==='), 'system rules always present');
});

test('model classification: free vs paid vs unknown', () => {
  assert.equal(policy.classifyModel({ promptPrice: 0, completionPrice: 0 }), 'free');
  assert.equal(policy.classifyModel({ promptPrice: 0.000003, completionPrice: 0.000015 }), 'paid');
  // Unknown must never collapse into free.
  assert.equal(policy.classifyModel({ promptPrice: null, completionPrice: null }), 'unknown');
  assert.equal(policy.classifyModel({ promptPrice: 0, completionPrice: null }), 'unknown');
});

test('cost estimation uses published prices and refuses to guess', () => {
  const paid = policy.estimateCost({ promptPrice: 0.000003, completionPrice: 0.000015 }, 4000, 1000);
  assert.equal(paid.costClass, 'paid');
  assert.equal(paid.promptTokens, 1000);
  assert.equal(paid.promptCost, 1000 * 0.000003);
  assert.equal(paid.completionCost, 1000 * 0.000015);
  // Floating point: compare within tolerance rather than demanding exactness.
  assert.ok(Math.abs(paid.totalCost! - 0.018) < 1e-12, `expected ~0.018, got ${paid.totalCost}`);

  const unknown = policy.estimateCost({ promptPrice: null, completionPrice: null }, 4000, 1000);
  assert.equal(unknown.costClass, 'unknown');
  assert.equal(unknown.totalCost, null, 'no invented cost when pricing is unknown');
  assert.equal(unknown.currency, null);
});

test('COST SAFETY: test mode refuses paid models and never substitutes one', () => {
  policy.setGenerationMode('test');

  const free = policy.evaluateSpend('free', false);
  assert.equal(free.allowed, true);

  const paid = policy.evaluateSpend('paid', false);
  assert.equal(paid.allowed, false);
  assert.equal(paid.requiresConfirmation, false, 'test mode is a refusal, not a confirmation prompt');
  assert.match(paid.reason!, /Test mode/);

  // Unknown pricing is treated as paid, not as free.
  assert.equal(policy.evaluateSpend('unknown', false).allowed, false);

  // Even an explicit confirmation cannot spend money in test mode.
  assert.equal(policy.evaluateSpend('paid', true).allowed, false);
});

test('COST SAFETY: production mode requires explicit per-request confirmation', () => {
  policy.setGenerationMode('production');

  const unconfirmed = policy.evaluateSpend('paid', false);
  assert.equal(unconfirmed.allowed, false);
  assert.equal(unconfirmed.requiresConfirmation, true);

  assert.equal(policy.evaluateSpend('paid', true).allowed, true);
  // Free models never need confirming.
  assert.equal(policy.evaluateSpend('free', false).requiresConfirmation, false);

  policy.setGenerationMode('test');
});

test('COST SAFETY: a paid generation is blocked end to end in test mode', async () => {
  policy.setGenerationMode('test');
  setPricing(0.000003, 0.000015); // make the configured model paid

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  const before = providerCalls;

  await assert.rejects(
    () => generateArticle(draft.id),
    (err: any) => err.code === 'paid_generation_blocked',
    'paid generation must be refused in test mode',
  );

  assert.equal(providerCalls, before, 'no provider call may be made when the spend is refused');
  assert.equal(articles.getArticleById(draft.id)?.generated, null, 'nothing persisted');

  const history = listGenerationHistoryForArticle(draft.id);
  assert.equal(history[0]?.errorCode, 'paid_generation_blocked', 'the refusal is recorded');

  setPricing(0, 0); // restore free
});

test('COST SAFETY: production paid generation needs confirmation, then proceeds', async () => {
  policy.setGenerationMode('production');
  setPricing(0.000003, 0.000015);

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);

  await assert.rejects(
    () => generateArticle(draft.id, undefined, { confirmedCost: false }),
    (err: any) => err.code === 'cost_confirmation_required',
  );
  assert.equal(articles.getArticleById(draft.id)?.generated, null);

  const outcome = await generateArticle(draft.id, undefined, { confirmedCost: true });
  assert.ok(outcome.generation.content.length > 0, 'confirmed generation proceeds');

  setPricing(0, 0);
  policy.setGenerationMode('test');
});

test('preflight surfaces mode, cost class and the spend decision', () => {
  policy.setGenerationMode('test');
  setPricing(0, 0);

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  const pre = getGenerationPreflight(draft.id);

  assert.equal(pre.mode, 'test');
  assert.equal(pre.costClass, 'free');
  assert.equal(pre.cost?.totalCost, 0);
  assert.equal(pre.spend?.allowed, true);
  assert.equal(pre.ready, true);
  assert.ok(!JSON.stringify(pre).includes(process.env[KEY_VAR]!), 'preflight never exposes a key');
});

test('END TO END (mock): configuration -> prompt -> provider -> Article Draft', async () => {
  policy.setGenerationMode('test');
  setPricing(0, 0);
  nextContent = '# Generated Heading\n\nGenerated body from the mock provider.';

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  const callsBefore = providerCalls;

  const outcome = await generateArticle(draft.id);

  // 9. the provider received the expected request
  assert.equal(providerCalls, callsBefore + 1);
  assert.equal(lastRequestBody.model, 'mock-model');
  const sent = lastRequestBody.messages[0].content as string;
  assert.ok(sent.includes('EXPERTISE-MARKER'), 'persona reached the provider');
  assert.ok(sent.includes('EXCLUSIONS-MARKER'), 'topic guidance reached the provider');

  // 10/11. the response became an Article Draft with metadata
  const saved = articles.getArticleById(draft.id)!;
  assert.equal(saved.generated?.content, 'Generated body from the mock provider.');
  assert.equal(saved.generated?.title, 'Generated Heading');
  assert.equal(saved.status, 'draft', 'generation never publishes');
  assert.equal(saved.title, 'Working Title', 'working title is never overwritten');
  assert.equal(outcome.usage?.totalTokens, 300);

  // reproducibility
  assert.equal(saved.provenance?.themeName, 'Test Theme A');
  assert.equal(saved.provenance?.topicTitle, 'Topic In A');
  assert.equal(saved.provenance?.authorName, 'Author A');
  assert.equal(saved.provenance?.modelName, 'mock-model');
  assert.equal(saved.provenance?.promptVersion, PROMPT_VERSION);
  assert.equal(saved.provenance?.generationMode, 'test');

  // history
  const history = listGenerationHistoryForArticle(draft.id);
  assert.equal(history[0]?.status, 'success');
  assert.equal(history[0]?.totalTokens, 300);
});

test('Draft persistence survives a full close and reopen', async () => {
  policy.setGenerationMode('test');
  setPricing(0, 0);
  nextContent = '# Durable\n\nDurable body.';

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  await generateArticle(draft.id);

  dbModule.closeDatabase();
  dbModule.initializeDatabase();

  const reopened = articles.getArticleById(draft.id)!;
  assert.equal(reopened.generated?.content, 'Durable body.');
  assert.equal(reopened.status, 'draft');
  assert.ok(articles.listArticles({ status: 'draft' }).some((a) => a.id === draft.id));
});

test('renaming configuration does not rewrite an article history', async () => {
  policy.setGenerationMode('test');
  setPricing(0, 0);
  nextContent = '# Snapshot\n\nSnapshot body.';

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  await generateArticle(draft.id);

  content.updateTheme(themeA.id, { name: 'Renamed Theme A', description: null });
  const after = articles.getArticleById(draft.id)!;

  assert.equal(after.provenance?.themeName, 'Test Theme A', 'snapshot keeps the historical name');
  assert.equal(content.getThemeById(after.themeId!)!.name, 'Renamed Theme A', 'live reference follows the rename');

  content.updateTheme(themeA.id, { name: 'Test Theme A', description: 'Theme A guidance.' });
});

test('no API key material appears in the database', () => {
  const dump =
    JSON.stringify(db().prepare('SELECT * FROM generation_history').all()) +
    JSON.stringify(db().prepare('SELECT * FROM articles').all()) +
    JSON.stringify(db().prepare('SELECT * FROM ai_providers').all());

  assert.ok(!dump.includes(process.env[KEY_VAR]!), 'key value must never be persisted');
  assert.ok(dump.includes(KEY_VAR), 'only the env var NAME is stored');
});

/* =============== model selection & paid protection (M13) ================ */

test('MODEL SELECTION: an explicitly chosen model is the one that runs', async () => {
  policy.setGenerationMode('test');
  setPricing(0, 0);
  nextContent = '# Chosen\n\nChosen body.';

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  const outcome = await generateArticle(draft.id, undefined, { modelId });

  assert.equal(lastRequestBody.model, 'mock-model', 'the selected model reached the provider');
  assert.equal(outcome.generation.model, 'mock-model');

  const history = listGenerationHistoryForArticle(draft.id);
  const payload = JSON.parse(
    (db().prepare('SELECT payload FROM generation_history WHERE id = ?').get(history[0].id) as any).payload,
  );
  assert.equal(payload.modelSelection, 'explicit', 'the choice is recorded as deliberate');
});

test('MODEL SELECTION: a selected model that cannot run fails — it is never substituted', async () => {
  policy.setGenerationMode('test');
  setPricing(0, 0);

  // A second, free model that exists but is disabled.
  const disabledId = Number(
    db()
      .prepare(
        `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free)
         VALUES (?, 'disabled-model', 0, 0, 0, 1)`,
      )
      .run(providerId).lastInsertRowid,
  );
  registerCapability(disabledId, 'article_generation');

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  const before = providerCalls;

  await assert.rejects(
    () => generateArticle(draft.id, undefined, { modelId: disabledId }),
    (err: any) => err.code === 'provider_not_configured',
    'a disabled selection is an error, not a fallback',
  );

  assert.equal(providerCalls, before, 'no request was sent with any other model');
  assert.equal(articles.getArticleById(draft.id)?.generated, null, 'and nothing was generated');
});

test('COST SAFETY: choosing a paid model does not bypass the spend gate', async () => {
  policy.setGenerationMode('test');

  // A paid model the user could pick from the picker.
  const paidId = Number(
    db()
      .prepare(
        `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free)
         VALUES (?, 'paid-model', 1, 0.000003, 0.000015, 0)`,
      )
      .run(providerId).lastInsertRowid,
  );
  registerCapability(paidId, 'article_generation');

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  const before = providerCalls;

  await assert.rejects(
    () => generateArticle(draft.id, undefined, { modelId: paidId }),
    (err: any) => err.code === 'paid_generation_blocked',
    'selecting a paid model in Test mode is still refused',
  );
  assert.equal(providerCalls, before, 'no billable request was made');

  // And in Production it still needs the explicit confirmation.
  policy.setGenerationMode('production');
  await assert.rejects(
    () => generateArticle(draft.id, undefined, { modelId: paidId, confirmedCost: false }),
    (err: any) => err.code === 'cost_confirmation_required',
  );
  assert.equal(providerCalls, before, 'still no billable request');

  policy.setGenerationMode('test');
});

test('COST SAFETY: a free selection never becomes a paid one when it fails', async () => {
  policy.setGenerationMode('production'); // paid generation is possible at all
  setPricing(0, 0);

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);
  failNextRequest = true;
  const before = providerCalls;

  await assert.rejects(() => generateArticle(draft.id, undefined, { modelId }));

  assert.equal(providerCalls, before + 1, 'exactly one attempt was made — Cynth never retries on its own');
  assert.equal(lastRequestBody.model, 'mock-model', 'and never with a different model');

  const history = listGenerationHistoryForArticle(draft.id);
  assert.equal(history.length, 1, 'one attempt, one history row — no second model was tried');

  policy.setGenerationMode('test');
});

test('PREFLIGHT: previewing a specific model reports that model’s own cost', () => {
  policy.setGenerationMode('test');

  const paidId = Number(
    db()
      .prepare(
        `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free)
         VALUES (?, 'preview-paid-model', 1, 0.000003, 0.000015, 0)`,
      )
      .run(providerId).lastInsertRowid,
  );
  registerCapability(paidId, 'article_generation');

  const draft = makeDraft(themeA.id, topicA.id, authorA.id);

  setPricing(0, 0);
  const withDefault = getGenerationPreflight(draft.id);
  assert.equal(withDefault.costClass, 'free');
  assert.equal(withDefault.isExplicitSelection, false);

  const withSelection = getGenerationPreflight(draft.id, undefined, paidId);
  assert.equal(withSelection.costClass, 'paid', 'the chosen model’s pricing, not the default’s');
  assert.equal(withSelection.isExplicitSelection, true);
  assert.equal(withSelection.model?.modelName, 'preview-paid-model');
  assert.equal(withSelection.spend?.allowed, false, 'and the chosen model’s spend decision');
});
