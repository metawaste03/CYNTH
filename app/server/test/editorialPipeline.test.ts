/**
 * Editorial pipeline tests (Milestone 20).
 *
 * These cover the guarantees that make Cynth a controlled engine rather than
 * an autonomous improvement loop. Each one is enforced in backend code, and
 * each one is asserted here rather than trusted to a prompt:
 *
 *   1. A completed paid stage is never re-run — not by a restart, not by a
 *      refresh, not by calling the stage again.
 *   2. There is exactly ONE automatic revision, and no second review.
 *   3. A technical failure may use a configured fallback; a poor-quality
 *      result may not.
 *   4. The fallback passes the spend gate on its own terms, so a free model
 *      can never fall back to a paid one in Test mode.
 *
 * NO REAL PROVIDER IS CONTACTED. The adapter transport is stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* ------------------------------------------------------------------ setup */

const SCRATCH = path.join(os.tmpdir(), `cynth-pipeline-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const secrets = await import('../src/shared/secrets/secretStore.js');
const constants = await import('../src/features/pipeline/pipeline.constants.js');
const repo = await import('../src/features/pipeline/pipeline.repository.js');
const roles = await import('../src/features/pipeline/roleRegistry.repository.js');
const runner = await import('../src/features/pipeline/stageRunner.service.js');
const articles = await import('../src/features/articles/articles.repository.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const settings = await import('../src/shared/settings/settings.repository.js');

dbModule.initializeDatabase();

const project = content.getDefaultProject()!;
const theme = content.createTheme(project.id, { name: 'Pipeline Theme', description: null });
const author = authorsRepo.createAuthor({ name: 'Pipeline Author' });

/* ------------------------------------------------------------ fetch stub */

let respondWith: (url: string) => { status: number; body: unknown } = () => ({
  status: 200,
  body: { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
});
const callLog: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  callLog.push(url);
  const { status, body } = respondWith(url);
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

/* --------------------------------------------------------- test fixtures */

secrets.setSecret('CYNTH_TEST_PIPELINE_KEY', 'not-a-real-credential');

const db = dbModule.getDatabase();

// Inserted directly rather than through the repository: this fixture cares
// about the registry shape the pipeline reads, not about the provider CRUD
// contract, which has its own tests.
const provider = {
  id: Number(
    db
      .prepare(
        `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
         VALUES ('Stub OpenRouter', 'openrouter', 'https://stub.test/api/v1', 'CYNTH_TEST_PIPELINE_KEY', 1)`,
      )
      .run().lastInsertRowid,
  ),
};

/** Registers a model directly: the pipeline reads the registry, not the catalogue. */
function addModel(name: string, opts: { free?: boolean; tier?: string; fallbackEligible?: boolean } = {}): number {
  const result = db
    .prepare(
      `INSERT INTO ai_provider_models (provider_id, model_name, display_name, is_enabled, prompt_price, completion_price, is_free, cost_tier, fallback_eligible)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .run(
      provider.id,
      name,
      name,
      opts.free ? 0 : 0.000003,
      opts.free ? 0 : 0.000015,
      opts.free ? 1 : 0,
      opts.tier ?? (opts.free ? 'free' : 'premium'),
      opts.fallbackEligible === false ? 0 : 1,
    );
  return Number(result.lastInsertRowid);
}

const premiumPrimary = addModel('anthropic/claude-opus-4.8');
const premiumFallback = addModel('openai/gpt-5.5');
const freeModel = addModel('stub/free-model', { free: true, tier: 'free' });

function makeArticle() {
  return articles.createArticleDraft({
    articleTypeId: 1,
    authorId: author.id,
    productId: null,
    projectId: project.id,
    themeId: theme.id,
    topicId: null,
    title: 'Pipeline Test Article',
    topic: 'A subject',
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

/** Production mode, so the spend gate permits a paid model with confirmation. */
function productionMode() {
  settings.setSetting('generation.mode', 'production');
}
function testMode() {
  settings.setSetting('generation.mode', 'test');
}

/* ----------------------------------------------------------- the caps --- */

test('CAP: the revision limit is one, and it is a constant not a setting', () => {
  assert.equal(constants.MAX_AUTOMATIC_REVISIONS, 1);
  assert.equal(constants.MAX_AUTOMATIC_REVIEWS, 1);
});

test('CAP: a second automatic revision is refused by the backend', () => {
  const article = makeArticle();
  const pipeline = repo.startPipeline({ articleId: article.id, mode: 'production', themeId: theme.id });

  const first = repo.canRevise(pipeline.id);
  assert.equal(first.allowed, true, 'the first revision is permitted');
  assert.match(first.reason, /1 of 1/);

  repo.incrementRevisionCount(pipeline.id);

  const second = repo.canRevise(pipeline.id);
  assert.equal(second.allowed, false, 'a second revision must be impossible');
  assert.match(second.reason, /already been used/i);
  assert.match(second.reason, /human editor/i, 'the user must be told what happens instead');

  // And it stays refused however many times it is asked.
  repo.incrementRevisionCount(pipeline.id);
  assert.equal(repo.canRevise(pipeline.id).allowed, false);
});

test('CAP: there is no second review — validation replaces it', () => {
  const article = makeArticle();
  const pipeline = repo.startPipeline({ articleId: article.id, mode: 'production' });

  assert.equal(repo.canReview(pipeline.id).allowed, true);
  repo.incrementReviewCount(pipeline.id);

  const second = repo.canReview(pipeline.id);
  assert.equal(second.allowed, false);
  assert.match(second.reason, /deterministic validation/i, 'the user must be told what runs instead');
});

/* ------------------------------------------------------ the state machine */

test('STATE: every transition is persisted and the run is resumable', () => {
  const article = makeArticle();
  const pipeline = repo.startPipeline({ articleId: article.id, mode: 'production' });

  repo.setState(pipeline.id, 'RESEARCHING', { stage: 'topic_research' });
  repo.setState(pipeline.id, 'RESEARCH_COMPLETE', { stage: 'topic_research' });
  repo.setState(pipeline.id, 'GENERATING', { stage: 'article_generation' });

  const transitions = repo.listTransitions(pipeline.id);
  assert.deepEqual(
    transitions.map((t) => t.toState),
    ['DRAFT', 'RESEARCHING', 'RESEARCH_COMPLETE', 'GENERATING'],
  );

  // Resumability: the current state is readable without replaying anything.
  assert.equal(repo.getCurrentPipeline(article.id)!.state, 'GENERATING');
});

test('STATE: terminal states are recognised and stamp a completion time', () => {
  const article = makeArticle();
  const pipeline = repo.startPipeline({ articleId: article.id, mode: 'production' });

  assert.equal(constants.isTerminal('READY'), true);
  assert.equal(constants.isTerminal('NEEDS_EDITORIAL_ATTENTION'), true);
  assert.equal(constants.isTerminal('REVIEWING'), false);

  repo.setState(pipeline.id, 'NEEDS_EDITORIAL_ATTENTION', { note: 'Issues remained after the one revision.' });
  const finished = repo.getPipelineById(pipeline.id)!;
  assert.ok(finished.completedAt, 'a terminal state records when it was reached');
  assert.match(finished.outcomeNote ?? '', /one revision/);
});

test('STATE: pressing start twice reuses the running pipeline rather than starting a second', () => {
  const article = makeArticle();
  const first = repo.startPipeline({ articleId: article.id, mode: 'production' });
  const second = repo.startPipeline({ articleId: article.id, mode: 'production' });

  assert.equal(second.id, first.id, 'a second start must not create a second run');
  assert.equal(repo.listPipelinesForArticle(article.id).length, 1);
});

/* -------------------------------------------------------- role registry */

test('ROLES: a role holds a primary and a fallback, per mode', () => {
  roles.setRoleAssignment('article_writer', 'production', {
    primaryModelId: premiumPrimary,
    fallbackModelId: premiumFallback,
  });
  roles.setRoleAssignment('article_writer', 'development', { primaryModelId: freeModel, fallbackModelId: null });

  const production = roles.getRoleAssignment('article_writer', 'production');
  assert.equal(production.primary?.modelName, 'anthropic/claude-opus-4.8');
  assert.equal(production.fallback?.modelName, 'openai/gpt-5.5');
  assert.equal(production.configured, true);

  // Development and Production are independent assignments over one pipeline.
  const development = roles.getRoleAssignment('article_writer', 'development');
  assert.equal(development.primary?.modelName, 'stub/free-model');
  assert.equal(development.fallback, null);
});

test('ROLES: a fallback identical to the primary is refused', () => {
  const result = roles.setRoleAssignment('article_reviewer', 'production', {
    primaryModelId: premiumPrimary,
    fallbackModelId: premiumPrimary,
  });
  assert.ok('error' in result);
  assert.match((result as { error: string }).error, /different model/i);
});

test('ROLES: an unconfigured role is reported before a run starts, not during', () => {
  const validation = roles.validateRoleConfiguration('production');
  assert.equal(validation.ready, false, 'not every role is assigned yet');
  assert.ok(validation.issues.some((issue) => /Topic Research/.test(issue)));
});

/* ------------------------------------------------------- the stage runner */

/** A stage request that succeeds, for the idempotency tests. */
function writerRequest(pipelineId: number, rerun = false) {
  return {
    pipelineId,
    stage: 'article_generation' as const,
    prompt: 'write something',
    parse: (text: string) => JSON.parse(text),
    timeoutMs: 5000,
    assumedCompletionTokens: 100,
    confirmedCost: true,
    rerun,
  };
}

test('IDEMPOTENCE: a completed paid stage is not re-run, and costs nothing the second time', async () => {
  productionMode();
  roles.setRoleAssignment('article_writer', 'production', {
    primaryModelId: premiumPrimary,
    fallbackModelId: premiumFallback,
  });

  const article = makeArticle();
  const pipeline = repo.startPipeline({ articleId: article.id, mode: 'production' });

  callLog.length = 0;
  const first = await runner.runStage(writerRequest(pipeline.id));
  assert.equal(first.reused, false);
  assert.deepEqual(first.output, { ok: true });
  assert.equal(callLog.length, 1, 'the first run calls the model once');

  // The second call is what a restart, a refresh or a reopened article does.
  const second = await runner.runStage(writerRequest(pipeline.id));
  assert.equal(second.reused, true, 'the stored result must be returned');
  assert.deepEqual(second.output, { ok: true });
  assert.equal(callLog.length, 1, 'NO second provider call — the stage must not be paid for twice');
});

test('IDEMPOTENCE: an explicit rerun is the only thing that repeats a stage', async () => {
  productionMode();
  const article = makeArticle();
  const pipeline = repo.startPipeline({ articleId: article.id, mode: 'production' });

  await runner.runStage(writerRequest(pipeline.id));
  callLog.length = 0;

  const rerun = await runner.runStage(writerRequest(pipeline.id, true));
  assert.equal(rerun.reused, false);
  assert.equal(callLog.length, 1, 'an explicit rerun does call the model again');

  const runs = repo.listStageRuns(pipeline.id).filter((r) => r.stage === 'article_generation');
  assert.equal(runs.length, 2, 'both attempts are recorded');
  assert.deepEqual(runs.map((r) => r.attempt), [1, 2]);
});

test('IDEMPOTENCE: a new pipeline version re-runs stages, and keeps the old results readable', async () => {
  productionMode();
  const article = makeArticle();
  const first = repo.startPipeline({ articleId: article.id, mode: 'production' });
  await runner.runStage(writerRequest(first.id));

  repo.setState(first.id, 'READY');
  const second = repo.startNewVersion(article.id, 'production') as { id: number; version: number };

  assert.equal(second.version, 2);
  assert.equal(
    repo.findCompletedStage(second.id, second.version, 'article_generation'),
    null,
    'version 2 has not run the stage yet',
  );
  assert.ok(
    repo.findCompletedStage(first.id, first.version, 'article_generation'),
    "version 1's result is still readable",
  );
});

/* ------------------------------------------------------------- fallback */

test('FALLBACK: a technical failure uses the configured fallback, and records that it did', async () => {
  productionMode();
  roles.setRoleAssignment('article_writer', 'production', {
    primaryModelId: premiumPrimary,
    fallbackModelId: premiumFallback,
  });

  const article = makeArticle();
  const pipeline = repo.startPipeline({ articleId: article.id, mode: 'production' });

  let calls = 0;
  respondWith = () => {
    calls += 1;
    // The primary fails with a transport-class error; the fallback answers.
    if (calls === 1) return { status: 503, body: { error: { message: 'upstream unavailable' } } };
    return {
      status: 200,
      body: { choices: [{ message: { content: '{"ok":"from-fallback"}' } }], usage: { prompt_tokens: 8, completion_tokens: 4 } },
    };
  };

  const result = await runner.runStage(writerRequest(pipeline.id));
  assert.deepEqual(result.output, { ok: 'from-fallback' });
  assert.equal(result.run.wasFallback, true, 'a fallback must be recorded, never silent');
  assert.equal(result.run.actualModel, 'openai/gpt-5.5');
  assert.equal(result.run.requestedModel, 'anthropic/claude-opus-4.8', 'what was asked for is kept too');

  respondWith = () => ({
    status: 200,
    body: { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  });
});

test('FALLBACK: an unreadable reply is NOT a technical failure and never pays a second model', async () => {
  productionMode();
  const article = makeArticle();
  const pipeline = repo.startPipeline({ articleId: article.id, mode: 'production' });

  // A successful call whose content cannot be parsed: an editorial/format
  // problem, which must not buy a second opinion from another model.
  respondWith = () => ({
    status: 200,
    body: { choices: [{ message: { content: 'not json at all' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
  });
  callLog.length = 0;

  await assert.rejects(() => runner.runStage(writerRequest(pipeline.id)));
  assert.equal(callLog.length, 1, 'exactly one provider call — no fallback for a bad result');

  respondWith = () => ({
    status: 200,
    body: { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  });
});

test('FALLBACK: the fallback passes the spend gate on its own terms', async () => {
  // Test mode: free models only. A free primary that fails must NOT fall back
  // onto a paid model, because that would be exactly the silent free-to-paid
  // drift the spend gate exists to prevent.
  testMode();
  roles.setRoleAssignment('article_writer', 'development', {
    primaryModelId: freeModel,
    fallbackModelId: premiumFallback,
  });

  const article = makeArticle();
  const pipeline = repo.startPipeline({ articleId: article.id, mode: 'development' });

  callLog.length = 0;
  respondWith = () => ({ status: 503, body: { error: { message: 'upstream unavailable' } } });

  await assert.rejects(
    () => runner.runStage({ ...writerRequest(pipeline.id), confirmedCost: false }),
    'the paid fallback must be refused in Test mode',
  );

  const runs = repo.listStageRuns(pipeline.id);
  const failed = runs.find((r) => r.stage === 'article_generation')!;
  assert.equal(failed.status, 'failure');
  assert.match(failed.errorMessage ?? '', /was not used/i, 'the refusal must say the fallback was not used');
  assert.equal(callLog.length, 1, 'only the free primary was called');

  respondWith = () => ({
    status: 200,
    body: { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  });
  productionMode();
});

/* ------------------------------------------------------------- costing */

test('COST: the breakdown reports per stage, and never counts unknown pricing as free', async () => {
  productionMode();
  roles.setRoleAssignment('article_writer', 'production', {
    primaryModelId: premiumPrimary,
    fallbackModelId: premiumFallback,
  });

  const article = makeArticle();
  const pipeline = repo.startPipeline({ articleId: article.id, mode: 'production' });
  await runner.runStage(writerRequest(pipeline.id));

  const breakdown = repo.getCostBreakdown(pipeline.id)!;
  assert.equal(breakdown.stages.length, 1);
  assert.equal(breakdown.stages[0].stage, 'article_generation');
  assert.equal(breakdown.stages[0].model, 'anthropic/claude-opus-4.8');
  assert.ok((breakdown.stages[0].estimatedCost ?? 0) > 0, 'a priced model produces a cost');
  assert.equal(breakdown.revisionCount, 0);
  assert.equal(breakdown.maxRevisions, 1, 'the cap travels with the cost report');
});

test.after(() => {
  globalThis.fetch = realFetch;
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
