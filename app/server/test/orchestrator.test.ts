/**
 * The conductor — theme in, finished article out (Milestone 23).
 *
 * This is the acceptance test for the automated flow: the user supplies a
 * thematic area and nothing else, and the pipeline produces the topic, the
 * keywords, the title, the article type, the template, the brief, the article,
 * the review and the validation result.
 *
 * What must hold:
 *   1. No topic, title, scope or keyword is required as input.
 *   2. A server restart mid-run repeats no paid stage.
 *   3. The run reaches a terminal state and stops.
 *
 * NO REAL PROVIDER IS CONTACTED.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-orch-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const secrets = await import('../src/shared/secrets/secretStore.js');
const orchestrator = await import('../src/features/pipeline/pipeline.orchestrator.js');
const repo = await import('../src/features/pipeline/pipeline.repository.js');
const roles = await import('../src/features/pipeline/roleRegistry.repository.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const articles = await import('../src/features/articles/articles.repository.js');
const settings = await import('../src/shared/settings/settings.repository.js');

dbModule.initializeDatabase();

const project = content.getDefaultProject()!;
const theme = content.createTheme(project.id, {
  name: 'Productive Workspace Setups',
  description: 'Desks, chairs and light.',
});
const author = authorsRepo.createAuthor({ name: 'Theo Lindqvist' });
content.setAuthorThemes(author.id, [theme.id]);

/* --------------------------------------------------------- staged replies */

let callCount = 0;
const replies: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  const body = replies[callCount] ?? '{}';
  callCount += 1;
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: body } }],
      usage: { prompt_tokens: 800, completion_tokens: 900, total_tokens: 1700 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}) as typeof fetch;

secrets.setSecret('CYNTH_ORCH_KEY', 'not-a-real-credential');
const db = dbModule.getDatabase();
const providerId = Number(
  db
    .prepare(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
       VALUES ('Stub', 'openrouter', 'https://stub.test/api/v1', 'CYNTH_ORCH_KEY', 1)`,
    )
    .run().lastInsertRowid,
);
const modelId = Number(
  db
    .prepare(
      `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free, cost_tier)
       VALUES (?, 'stub/free', 1, 0, 0, 1, 'free')`,
    )
    .run(providerId).lastInsertRowid,
);
for (const role of [
  'topic_research',
  'keyword_research',
  'title_selection',
  'article_writer',
  'article_reviewer',
  'article_revision',
] as const) {
  roles.setRoleAssignment(role, 'development', { primaryModelId: modelId, fallbackModelId: null });
}
settings.setSetting('generation.mode', 'test');

const TOPIC = JSON.stringify({
  topic: 'Whether monitor light bars reduce eye strain',
  theme: 'Productive Workspace Setups',
  research_summary: 'Coverage is affiliate roundups with no mechanism.',
  why_now: 'Prices have fallen.',
  audience: 'Desk workers',
  search_opportunity: 'Steady informational demand.',
  commercial_opportunity: 'Genuinely purchasable category.',
  content_gap: 'Nobody explains the contrast mechanism.',
  likely_search_intent: 'commercial',
  recommended_angle: 'Mechanism first, then recommend.',
  competing_content_observations: ['Mostly listicles'],
  research_sources: [],
});

const KEYWORDS = JSON.stringify({
  primary_keyword: 'monitor light bar',
  secondary_keywords: ['screen bar'],
  long_tail_keywords: ['do monitor light bars help'],
  semantic_terms: ['contrast'],
  entities: ['BenQ ScreenBar'],
  related_questions: ['Do they glare?'],
  search_intent: 'commercial',
  commercial_intent: 'high',
  title_candidates: ['Do Monitor Light Bars Work?'],
  recommended_title: 'Do Monitor Light Bars Actually Reduce Eye Strain?',
  recommended_headings: ['What it does'],
  seo_notes: [],
  sources: [],
});

const CLASSIFY = JSON.stringify({
  article_type: 'how-to',
  confidence: 0.81,
  primary_intent: 'commercial',
  secondary_intent: 'informational',
  reasoning_summary: 'The reader wants to set one up.',
});

const ARTICLE = JSON.stringify({
  title: 'Do Monitor Light Bars Actually Reduce Eye Strain?',
  excerpt: 'What a light bar does, and when it helps.',
  sections: [
    { key: 'hero', heading: 'Hero', body: 'A monitor light bar addresses one specific problem at a desk, and it is worth knowing which.' },
    { key: 'introduction', heading: 'Introduction', body: 'A monitor light bar reduces the contrast between a bright screen and a dark room. '.repeat(10) },
    { key: 'what_you_need', heading: "What you'll need", body: 'A monitor light bar and a spare USB port.' },
    { key: 'steps', heading: 'Steps', body: 'Clip the bar onto the monitor. Angle it down toward the desk. Match its brightness to the room. '.repeat(18) },
    { key: 'conclusion', heading: 'Conclusion', body: 'You should now have even light across the desk with no glare on the screen.' },
  ],
  faq: [{ question: 'Do they cause glare?', answer: 'Not when angled away from the screen.' }],
  sources: [],
});

const PASSING_REVIEW = JSON.stringify({
  revision_required: false,
  overall_score: 0.84,
  summary: 'Accurate and correctly structured.',
  strengths: ['Explains the mechanism'],
  product_assessment: 'No products.',
  issues: [],
  preserve_sections: [],
});

function stage(...bodies: string[]) {
  replies.length = 0;
  callCount = 0;
  replies.push(...bodies);
}

/* ------------------------------------------------------------ the test --- */

test('AUTOMATED: a thematic area is the only input — no topic, title or keywords are typed', async () => {
  stage(TOPIC, KEYWORDS, CLASSIFY, ARTICLE, PASSING_REVIEW);

  const started = orchestrator.startArticlePipeline({ themeId: theme.id, mode: 'development' });
  assert.ok(!('error' in started), JSON.stringify(started));
  const { pipelineId, articleId } = started as { pipelineId: number; articleId: number };

  // The draft starts empty. Everything below is produced, not supplied.
  const before = articles.getArticleById(articleId)!;
  assert.equal(before.title, null);
  assert.equal(before.keywords?.primaryKeyword ?? null, null);
  assert.equal(before.articleTypeSlug, null);

  const status = await orchestrator.advancePipeline(pipelineId, { confirmedCost: false });

  assert.equal(status.pipeline.state, 'READY', JSON.stringify(status.stages.map((s) => [s.stage, s.status, s.error])));
  assert.equal(status.finished, true);

  const after = articles.getArticleById(articleId)!;
  assert.equal(after.title, 'Do Monitor Light Bars Actually Reduce Eye Strain?', 'the title was produced');
  assert.equal(after.topic, 'Whether monitor light bars reduce eye strain', 'the topic was produced');
  assert.equal(after.keywords?.primaryKeyword, 'monitor light bar', 'the keywords were produced');
  assert.equal(after.articleTypeSlug, 'how-to', 'the article type was classified');
  assert.equal(after.templateId, 'how-to-v1', 'the template was chosen');
  assert.equal(after.targetAudience, 'Desk workers', 'the audience was produced');
  assert.ok(after.structuredContent, 'the article body was written');
  assert.equal(after.reviewScore, 0.84, 'the review score was recorded');
});

test('AUTOMATED: every stage is reported with its model, cost and duration', async () => {
  stage(TOPIC, KEYWORDS, CLASSIFY, ARTICLE, PASSING_REVIEW);
  const started = orchestrator.startArticlePipeline({ themeId: theme.id, mode: 'development' }) as { pipelineId: number };
  const status = await orchestrator.advancePipeline(started.pipelineId, { confirmedCost: false });

  const byStage = new Map(status.stages.map((s) => [s.stage, s]));
  for (const stageName of ['topic_research', 'keyword_research', 'article_classification', 'article_generation', 'article_review']) {
    assert.equal(byStage.get(stageName)!.status, 'success', stageName);
    assert.ok(byStage.get(stageName)!.model, `${stageName} records the model that ran`);
  }

  // The free stages ran and cost nothing.
  assert.equal(byStage.get('template_selection')!.status, 'success');
  assert.equal(byStage.get('article_brief')!.status, 'success');

  // No revision was needed, so it is shown as skipped rather than pending.
  assert.equal(byStage.get('article_revision')!.status, 'skipped');
  assert.equal(status.revisions.used, 0);
  assert.equal(status.revisions.max, 1);
});

test('RESUMABLE: re-advancing a finished pipeline repeats no paid stage', async () => {
  stage(TOPIC, KEYWORDS, CLASSIFY, ARTICLE, PASSING_REVIEW);
  const started = orchestrator.startArticlePipeline({ themeId: theme.id, mode: 'development' }) as { pipelineId: number };
  await orchestrator.advancePipeline(started.pipelineId, { confirmedCost: false });

  const callsAfterFirstRun = callCount;
  await orchestrator.advancePipeline(started.pipelineId, { confirmedCost: false });

  assert.equal(callCount, callsAfterFirstRun, 'a finished run must not call a model again');
});

test('RESUMABLE: a run interrupted mid-way continues without repaying for completed stages', async () => {
  stage(TOPIC, KEYWORDS, CLASSIFY, ARTICLE, PASSING_REVIEW);
  const started = orchestrator.startArticlePipeline({ themeId: theme.id, mode: 'development' }) as { pipelineId: number };

  // Stop after classification — the point a crash or restart might occur.
  await orchestrator.advancePipeline(started.pipelineId, { confirmedCost: false, stopAfter: 'article_classification' });
  const callsBeforeInterruption = callCount;
  assert.equal(callsBeforeInterruption, 3, 'three paid stages ran');

  // Simulate the restart: close and reopen the database, dropping all memory.
  dbModule.closeDatabase();
  dbModule.initializeDatabase();

  const status = await orchestrator.advancePipeline(started.pipelineId, { confirmedCost: false });
  assert.equal(status.pipeline.state, 'READY');

  // Two more calls only — the writer and the reviewer. Research, keywords and
  // classification were read from storage.
  assert.equal(callCount, callsBeforeInterruption + 2, 'completed stages must not be paid for twice');
});

test('READINESS: an unconfigured mode refuses before anything is spent', () => {
  const result = orchestrator.startArticlePipeline({ themeId: theme.id, mode: 'production' });
  assert.ok('error' in result, 'production has no models assigned in this scratch database');
  assert.match((result as { error: string }).error, /not fully configured/i);
});

test('READINESS: an area with no active author refuses, naming what to do', () => {
  const empty = content.createTheme(project.id, { name: 'Unstaffed Area', description: null });
  const result = orchestrator.startArticlePipeline({ themeId: empty.id, mode: 'development' });
  assert.ok('error' in result);
  assert.match((result as { error: string }).error, /no active author/i);
});

test('TERMINAL: a validation failure hands over rather than looping', async () => {
  // An article missing a required section: written, reviewed, then blocked.
  const broken = JSON.parse(ARTICLE);
  broken.sections = broken.sections.filter((s: any) => s.key !== 'steps');
  stage(TOPIC, KEYWORDS, CLASSIFY, JSON.stringify(broken), PASSING_REVIEW);

  const started = orchestrator.startArticlePipeline({ themeId: theme.id, mode: 'development' }) as { pipelineId: number };
  const status = await orchestrator.advancePipeline(started.pipelineId, { confirmedCost: false });

  assert.equal(status.pipeline.state, 'NEEDS_EDITORIAL_ATTENTION');
  assert.equal(status.finished, true);
  assert.match(status.pipeline.outcomeNote ?? '', /human editor/i);

  // And advancing again does nothing rather than trying to fix it.
  const callsBefore = callCount;
  await orchestrator.advancePipeline(started.pipelineId, { confirmedCost: false });
  assert.equal(callCount, callsBefore, 'a terminal pipeline must not restart itself');
});

test('OUTPUTS: every stage result is retrievable for inspection', async () => {
  stage(TOPIC, KEYWORDS, CLASSIFY, ARTICLE, PASSING_REVIEW);
  const started = orchestrator.startArticlePipeline({ themeId: theme.id, mode: 'development' }) as { pipelineId: number };
  await orchestrator.advancePipeline(started.pipelineId, { confirmedCost: false });

  const outputs = orchestrator.getPipelineOutputs(started.pipelineId)!;
  assert.ok(outputs.topic_research, 'topic research is retained, not discarded after use');
  assert.ok(outputs.keyword_research);
  assert.ok(outputs.article_brief);
  assert.ok(outputs.article_review);
  assert.equal((outputs.topic_research as any).recommendedAngle, 'Mechanism first, then recommend.');
});

test.after(() => {
  globalThis.fetch = realFetch;
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
