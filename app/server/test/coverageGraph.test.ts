/**
 * The coverage graph — an article that repeats one already written is never
 * drafted, and an area widens only into subtopics a person has approved.
 *
 * What must hold:
 *   1. An article is cut into the points it makes, and only changed articles
 *      are embedded again.
 *   2. A proposed topic too close to an existing article is dropped before
 *      anyone can choose it; when nothing survives, the run stops.
 *   3. A topic in a new subtopic is held, and the subtopic waits for approval.
 *   4. A planned section that is already written is cut; a plan that is mostly
 *      repeats stops the run before drafting.
 *   5. A drafted section that repeats an existing article is found.
 *   6. When embedding is unavailable, the gate fails closed.
 *
 * NO REAL PROVIDER IS CONTACTED. Embeddings are the bag-of-words stand-in in
 * helpers/embeddingStub.ts, so "close" here means "shares most of its words".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { withEmbeddings } from './helpers/embeddingStub.js';

const SCRATCH = path.join(os.tmpdir(), `cynth-coverage-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const secrets = await import('../src/shared/secrets/secretStore.js');
const settings = await import('../src/shared/settings/settings.repository.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const roles = await import('../src/features/pipeline/roleRegistry.repository.js');
const repo = await import('../src/features/pipeline/pipeline.repository.js');
const orchestrator = await import('../src/features/pipeline/pipeline.orchestrator.js');
const graph = await import('../src/features/coverage-graph/coverageGraph.service.js');
const points = await import('../src/features/coverage-graph/points.js');
const gates = await import('../src/features/pipeline/stages/coverageStages.service.js');

dbModule.initializeDatabase();
const db = dbModule.getDatabase();

/* -------------------------------------------------------------- network --- */

let embeddingCalls = 0;
let embeddingsDown = false;
const realFetch = globalThis.fetch;
const embeddings = withEmbeddings((async () => new Response('{}', { status: 500 })) as typeof fetch);
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  embeddingCalls += 1;
  if (embeddingsDown) return new Response(JSON.stringify({ error: { message: 'down' } }), { status: 503 });
  return embeddings(input, init);
}) as typeof fetch;

/* ---------------------------------------------------------------- setup --- */

secrets.setSecret('CYNTH_COVERAGE_KEY', 'not-a-real-credential');
const providerId = Number(
  db
    .prepare(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
       VALUES ('Stub', 'openrouter', 'https://stub.test/api/v1', 'CYNTH_COVERAGE_KEY', 1)`,
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
for (const role of ['topic_research', 'keyword_research', 'title_selection', 'article_writer', 'article_reviewer', 'article_revision'] as const) {
  roles.setRoleAssignment(role, 'development', { primaryModelId: modelId, fallbackModelId: null });
}
settings.setSetting('generation.mode', 'test');

const project = content.getDefaultProject()!;
// Named as the real area is, so its scope list in coverageScope.ts is seeded.
const sleep = content.createTheme(project.id, { name: 'Sleep & Recovery', description: 'Sleep.' });
const author = authorsRepo.createAuthor({ name: 'Mara Quist' });
content.setAuthorThemes(author.id, [sleep.id]);

const CAFFEINE = [
  'This guide finds your caffeine cut-off before bed so coffee stops disturbing deep sleep.',
  '',
  '## Why caffeine disturbs sleep you never notice',
  'Caffeine blocks adenosine, the sleep pressure signal, so you fall asleep yet sleep shallower. The Drake six hour study found six hours before bed was still too late for a large dose of caffeine. Falling asleep easily therefore tells you very little about how deep and unbroken the rest of the night really was.',
  '',
  '## How to test your own cut-off',
  'Log every coffee, tea and energy drink for a week, then move your last caffeine two hours earlier and compare how rested you feel each morning across the following fortnight. Keep everything else the same, including bedtime, so the change you notice belongs to the caffeine and not to something else.',
].join('\n');

const caffeineArticle = Number(
  db
    .prepare(`INSERT INTO articles (project_id, theme_id, title, content, status) VALUES (?, ?, ?, ?, 'draft')`)
    .run(project.id, sleep.id, 'Caffeine cut-off before bed', CAFFEINE).lastInsertRowid,
);

function newPipeline(): { pipelineId: number; articleId: number } {
  const started = orchestrator.startArticlePipeline({ themeId: sleep.id, mode: 'development' });
  assert.ok(!('error' in started), 'error' in started ? started.error : '');
  return started as { pipelineId: number; articleId: number };
}

function candidate(topic: string, angle: string, subtopic?: string, coreIdeaServed?: string) {
  return {
    topic,
    theme: 'Sleep & Recovery',
    researchSummary: 'Summary.',
    whyNow: 'Evergreen.',
    audience: 'Adults',
    searchOpportunity: 'Steady.',
    commercialOpportunity: 'Low.',
    contentGap: 'Gap.',
    likelySearchIntent: 'informational',
    recommendedAngle: angle,
    competingContentObservations: [],
    researchSources: [],
    subtopic,
    coreIdeaServed,
  };
}

function keywordsWith(sections: { heading: string; covers: string }[]) {
  return {
    primaryKeyword: 'k',
    secondaryKeywords: [],
    longTailKeywords: [],
    semanticTerms: [],
    entities: [],
    relatedQuestions: [],
    searchIntent: 'informational',
    commercialIntent: 'low',
    titleCandidates: [],
    recommendedTitle: 'A title',
    recommendedHeadings: sections.map((s) => s.heading),
    recommendedSections: sections,
    seoNotes: [],
    sources: [],
  };
}

test.after(() => {
  globalThis.fetch = realFetch;
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

/* ---------------------------------------------------------------- tests --- */

test('POINTS: an article is cut at its headings, FAQ questions stand alone, and a stub section is folded in', () => {
  const split = points.splitIntoPoints(
    [
      'An introduction that sets the scene for the reader and explains what the article covers in a sentence or two, with enough words to stand.',
      '## First section',
      'Words '.repeat(60),
      '## Tiny',
      'Too short.',
      '## FAQ',
      '### Does it work?',
      'Answer '.repeat(50),
    ].join('\n'),
  );
  assert.deepEqual(
    split.map((p) => [p.heading, p.parentHeading]),
    [
      [points.INTRODUCTION_HEADING, null],
      ['First section', null],
      ['Does it work?', 'FAQ'],
    ],
  );
  assert.match(split[1].text, /Tiny: Too short\./, 'the stub section is kept, inside the one before');
});

test('SYNC: articles are embedded once, and again only when their text changes', async () => {
  const first = await graph.syncCoverageGraph();
  assert.ok(first.indexed.includes(caffeineArticle));
  assert.ok(first.subtopicsEmbedded > 0, 'the area scope is seeded and embedded');

  const before = embeddingCalls;
  const second = await graph.syncCoverageGraph();
  assert.equal(second.indexed.length, 0);
  assert.equal(embeddingCalls, before, 'nothing changed, so nothing was sent');

  db.prepare('UPDATE articles SET content = ? WHERE id = ?').run(`${CAFFEINE}\n\nOne more line about decaf.`, caffeineArticle);
  const third = await graph.syncCoverageGraph();
  assert.deepEqual(third.indexed, [caffeineArticle]);

  const covered = graph.subtopicCoverage(sleep.id).find((s) => s.name === 'Caffeine timing')!;
  assert.ok(covered.primaryArticles.some((a) => a.id === caffeineArticle), 'the article is about caffeine timing');
});

test('TOPIC GATE: a reworded duplicate is dropped, a new subtopic is held, and only the clear topic is offered', async () => {
  await graph.syncCoverageGraph();
  const { pipelineId } = newPipeline();

  const topicSet = {
    ...candidate('Caffeine cut-off before bed', 'Find your caffeine cut-off before bed so coffee stops disturbing deep sleep.', 'Caffeine timing'),
    candidates: [
      candidate('Caffeine cut-off before bed', 'Find your caffeine cut-off before bed so coffee stops disturbing deep sleep.', 'Caffeine timing'),
      candidate('Jet lag after long flights', 'Shift your body clock with light timing and melatonin when crossing time zones.', 'Jet lag'),
      candidate('Weighted blankets', 'Whether a weighted blanket calms anxious sleepers.', 'NEW: Weighted bedding', 'Behaviour before purchase.'),
    ],
    recommendedIndex: 0,
  };

  const { output } = await gates.runTopicScreen(pipelineId, topicSet);
  const outcome = (topic: string) => output.results.find((r) => r.topic.startsWith(topic))!.outcome;

  assert.equal(outcome('Caffeine'), 'dropped');
  assert.match(output.results[0].reason, /Too close to an existing article/);
  assert.equal(outcome('Jet lag'), 'offered');
  assert.equal(outcome('Weighted'), 'held');

  assert.deepEqual(output.screened!.candidates.map((c) => c.topic), ['Jet lag after long flights']);
  assert.equal(output.screened!.recommendedIndex, 0, 'the recommendation moves to a topic that survived');

  const proposed = graph.subtopicCoverage(sleep.id).find((s) => s.name === 'Weighted bedding')!;
  assert.equal(proposed.ring, 'proposed', 'the new subtopic waits for a person');
  assert.equal(proposed.coreIdea, 'Behaviour before purchase.');
});

test('TOPIC GATE: when nothing survives, the run stops and nothing is written', async () => {
  const { pipelineId } = newPipeline();
  const dup = candidate('Caffeine cut-off before bed', 'Find your caffeine cut-off before bed so coffee stops disturbing deep sleep.');
  const { output } = await gates.runTopicScreen(pipelineId, { ...dup, candidates: [dup], recommendedIndex: 0 });

  assert.equal(output.screened, null);
  assert.match(output.stopReason ?? '', /Nothing was written/);
  assert.equal(repo.getPipelineById(pipelineId)!.state, 'NEEDS_EDITORIAL_ATTENTION');
});

test('SCOPE: an approved subtopic is no longer held; a rejected one drops its topics', async () => {
  const proposed = graph.subtopicCoverage(sleep.id).find((s) => s.name === 'Weighted bedding')!;
  assert.equal(graph.decideSubtopic(proposed.id, 'approve'), true);
  assert.equal(graph.decideSubtopic(proposed.id, 'reject'), false, 'a decision is made once');

  const { pipelineId } = newPipeline();
  const weighted = candidate('Weighted blankets', 'Whether a weighted blanket calms anxious sleepers.', 'Weighted bedding');
  const approved = await gates.runTopicScreen(pipelineId, { ...weighted, candidates: [weighted], recommendedIndex: 0 });
  assert.equal(approved.output.results[0].outcome, 'offered');

  const naps = graph.findSubtopicByName(sleep.id, 'Naps')!;
  db.prepare(`UPDATE coverage_subtopics SET ring = 'rejected' WHERE id = ?`).run(naps.id);
  const second = newPipeline();
  const nap = candidate('Napping well', 'How long to nap.', 'Naps');
  const rejected = await gates.runTopicScreen(second.pipelineId, { ...nap, candidates: [nap], recommendedIndex: 0 });
  assert.equal(rejected.output.results[0].outcome, 'dropped');
  db.prepare(`UPDATE coverage_subtopics SET ring = 'core' WHERE id = ?`).run(naps.id);
});

test('SECTION GATE: a section already written is cut and becomes a link instruction', async () => {
  const { pipelineId } = newPipeline();
  const research = candidate('Jet lag after long flights', 'Shift your body clock with light timing and melatonin.');
  const keywords = keywordsWith([
    { heading: 'Why caffeine disturbs sleep you never notice', covers: 'Caffeine blocks adenosine, the sleep pressure signal, so you fall asleep yet sleep shallower; the Drake six hour study.' },
    { heading: 'Eastward versus westward travel', covers: 'Flying east shortens the day and is harder to adjust to than flying west.' },
    { heading: 'Light timing on arrival', covers: 'Seek morning daylight after flying east and evening light after flying west.' },
    { heading: 'Melatonin dose for jet lag', covers: 'Low doses of melatonin taken at the destination bedtime help the body clock shift.' },
  ]);

  const { output } = await gates.runSectionScreen(pipelineId, research, keywords);
  assert.equal(output.stopReason, null, 'one repeat in four is not a reason to stop');
  assert.deepEqual(output.sections.filter((s) => s.verdict === 'cut').map((s) => s.heading), ['Why caffeine disturbs sleep you never notice']);

  const coverage = gates.briefCoverageFrom(output)!;
  assert.equal(coverage.alreadyCovered[0].match.articleId, caffeineArticle);
  assert.match(gates.describeBriefCoverage(coverage), /Do not write a section on any of them/);
});

test('SECTION GATE: a plan that is mostly repeats stops the run before drafting', async () => {
  const { pipelineId } = newPipeline();
  const research = candidate('Jet lag after long flights', 'Shift your body clock with light timing and melatonin.');
  const keywords = keywordsWith([
    { heading: 'Why caffeine disturbs sleep you never notice', covers: 'Caffeine blocks adenosine, the sleep pressure signal, so you fall asleep yet sleep shallower; the Drake six hour study.' },
    { heading: 'How to test your own cut-off', covers: 'Log every coffee, tea and energy drink for a week, then move your last caffeine two hours earlier and compare how rested you feel.' },
    { heading: 'Melatonin dose for jet lag', covers: 'Low doses of melatonin taken at the destination bedtime help the body clock shift.' },
  ]);

  const { output } = await gates.runSectionScreen(pipelineId, research, keywords);
  assert.match(output.stopReason ?? '', /2 of 3 planned sections are already written/);
  assert.equal(repo.getPipelineById(pipelineId)!.state, 'NEEDS_EDITORIAL_ATTENTION');
});

test('DRAFT GATE: a drafted section that repeats an existing article is found, and blocks at validation', async () => {
  const { pipelineId, articleId } = newPipeline();
  const draft = [
    'A guide to jet lag for people crossing several time zones on long flights this year.',
    '',
    '## Why caffeine disturbs sleep you never notice',
    'Caffeine blocks adenosine, the sleep pressure signal, so you fall asleep yet sleep shallower. The Drake six hour study found six hours before bed was still too late for a large dose of caffeine. Falling asleep easily therefore tells you very little about how deep and unbroken the rest of the night really was.',
    '',
    '## Light timing on arrival',
    'Seek bright morning daylight after flying east and evening light after flying west, and keep the bedroom dark at the new local night so the body clock follows the sun.',
  ].join('\n');

  const { output } = await gates.runDraftScreen(pipelineId, draft);
  assert.deepEqual(output.overlaps.map((o) => o.heading), ['Why caffeine disturbs sleep you never notice']);
  assert.equal(output.overlaps[0].match.articleId, caffeineArticle);

  const issues = gates.coverageIssuesFor(output.overlaps);
  assert.equal(issues[0].severity, 'major', 'the reviewer cannot treat a measured repeat as optional');

  db.prepare('UPDATE articles SET content = ? WHERE id = ?').run(draft, articleId);
  const findings = await gates.finalCoverageFindings(pipelineId);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'blocking');
  db.prepare('UPDATE articles SET content = NULL WHERE id = ?').run(articleId);
});

test('FAIL CLOSED: when embedding is unavailable the gate fails the run rather than passing it', async () => {
  const { pipelineId } = newPipeline();
  const topic = candidate('Jet lag after long flights', 'Shift your body clock with light timing and melatonin.');
  embeddingsDown = true;
  try {
    await assert.rejects(gates.runTopicScreen(pipelineId, { ...topic, candidates: [topic], recommendedIndex: 0 }));
  } finally {
    embeddingsDown = false;
  }
  assert.equal(repo.getPipelineById(pipelineId)!.state, 'FAILED');
  assert.match(repo.getPipelineById(pipelineId)!.outcomeNote ?? '', /Coverage check could not run/);
});

test('PROMPT: topic research is shown what each article already says, and which parts of the scope are untouched', () => {
  const block = graph.buildGraphBlock(sleep.id, 'Sleep & Recovery');
  assert.match(block, /sections: Why caffeine disturbs sleep you never notice \| How to test your own cut-off/);
  assert.match(block, /Core subtopics NOT yet written about \(\d+\): .*Jet lag/);
  assert.match(block, /Core subtopics already covered \(\d+\): .*Caffeine timing/);
  assert.match(block, /name a NEW subtopic/);
});
