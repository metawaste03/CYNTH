/**
 * Guided generation — the checkpoints (Milestone 24).
 *
 * What must hold:
 *   1. Topic research produces a SHORTLIST, and the recommendation is
 *      readable at the top level so an automatic run is unaffected by it.
 *   2. A guided run STOPS at a checkpoint and calls nothing further. Pausing
 *      must not cost money, and must not half-run the next stage.
 *   3. A decision actually changes what is written — choosing topic 2 means
 *      the article is about topic 2, not about the recommendation.
 *   4. A decision cannot select something that does not exist.
 *   5. A custom topic is never presented as researched.
 *   6. Switching to automatic settles outstanding decisions AS AUTOMATIC, so
 *      the history never claims a person approved something they did not.
 *   7. An answered checkpoint cannot be re-answered.
 *   8. The revision cap holds in guided mode: a person may decline the
 *      revision, or request one the reviewer did not ask for, but neither
 *      path reaches a second.
 *   9. An automatic run opens no checkpoints at all.
 *
 * NO REAL PROVIDER IS CONTACTED.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-guided-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const secrets = await import('../src/shared/secrets/secretStore.js');
const repo = await import('../src/features/pipeline/pipeline.repository.js');
const roles = await import('../src/features/pipeline/roleRegistry.repository.js');
const orchestrator = await import('../src/features/pipeline/pipeline.orchestrator.js');
const checkpoints = await import('../src/features/pipeline/checkpoints.service.js');
const research = await import('../src/features/pipeline/stages/researchStages.service.js');
const templates = await import('../src/features/templates/templates.repository.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const settings = await import('../src/shared/settings/settings.repository.js');
const products = await import('../src/features/products/products.repository.js');
const skillsRepo = await import('../src/features/authors/authorSkills.repository.js');
const articleProducts = await import('../src/features/articles/articleProducts.repository.js');

dbModule.initializeDatabase();
const db = dbModule.getDatabase();

const project = content.getDefaultProject()!;
const theme = content.createTheme(project.id, {
  name: 'Trail Running',
  description: 'Shoes, routes and the things that go wrong on them.',
});
const otherTheme = content.createTheme(project.id, { name: 'Desk Work', description: 'Chairs and screens.' });
const author = authorsRepo.createAuthor({ name: 'Ines Okafor', expertise: 'Endurance sport' } as never);
content.setAuthorThemes(author.id, [theme.id]);

/* ------------------------------------------------------------ the stub --- */

const calls: string[] = [];
const prompts: string[] = [];
let replies: ((prompt: string) => string) | null = null;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  const prompt = String(body?.messages?.[0]?.content ?? '');
  calls.push(prompt.slice(0, 60));
  prompts.push(prompt);

  return new Response(
    JSON.stringify({
      choices: [{ message: { content: replies ? replies(prompt) : '{}' } }],
      usage: { prompt_tokens: 400, completion_tokens: 600, total_tokens: 1000 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}) as typeof fetch;

secrets.setSecret('CYNTH_GUIDED_TEST_KEY', 'not-a-real-credential');

const providerId = Number(
  db
    .prepare(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
       VALUES ('Stub', 'openrouter', 'https://stub.test/api/v1', 'CYNTH_GUIDED_TEST_KEY', 1)`,
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

/* ------------------------------------------------------------- replies --- */

function topicCandidate(name: string, angle: string) {
  return {
    topic: name,
    theme: 'Trail Running',
    research_summary: `Research for ${name}.`,
    why_now: 'Evergreen.',
    audience: 'New trail runners',
    search_opportunity: 'Steady informational demand.',
    commercial_opportunity: 'Shoes and packs are purchasable.',
    content_gap: 'Nobody explains the mechanism.',
    likely_search_intent: 'informational',
    recommended_angle: angle,
    competing_content_observations: ['Mostly listicles'],
    research_sources: [{ url: 'https://example.test/s', title: 'A source', note: 'useful' }],
  };
}

const SHORTLIST = JSON.stringify({
  recommended_index: 1,
  topics: [
    topicCandidate('How to choose trail shoes', 'Fit before lugs.'),
    topicCandidate('Why trail runners roll ankles', 'Mechanism, then prevention.'),
    topicCandidate('Fuelling a first ultra', 'Calories per hour, honestly.'),
    topicCandidate('Night running kit', 'Light, not gadgets.'),
  ],
});

const KEYWORDS = JSON.stringify({
  primary_keyword: 'trail running ankle injuries',
  secondary_keywords: ['ankle roll', 'trail stability'],
  long_tail_keywords: ['how to stop rolling your ankle trail running'],
  semantic_terms: ['proprioception'],
  entities: ['Salomon Speedcross'],
  related_questions: ['Do ankle braces help?'],
  search_intent: 'informational',
  commercial_intent: 'medium',
  title_candidates: ['Why Trail Runners Roll Ankles', 'The Ankle Roll, Explained', 'Stop Rolling Your Ankle'],
  recommended_title: 'Why Trail Runners Roll Ankles',
  recommended_headings: ['What actually happens', 'What helps'],
  seo_notes: ['Do not stuff the keyword'],
  sources: [],
});

const OPPORTUNITIES = JSON.stringify({
  assessment: 'This article can carry footwear and support products honestly.',
  opportunities: [
    {
      product_type: 'Trail running shoes with rock plates',
      why_suited: 'The article explains how underfoot protection changes ankle load.',
      section_key: 'recommended_products',
      search_terms: ['trail running shoes rock plate', 'protective trail shoes'],
      priority: 'high',
    },
    {
      product_type: 'Ankle braces',
      why_suited: 'Readers recovering from a roll want something immediate.',
      // A section this template does not have. It must not be coerced.
      section_key: 'a_section_that_does_not_exist',
      search_terms: ['lace-up ankle brace running'],
      priority: 'medium',
    },
    {
      // No product_type: not a usable suggestion, and must be dropped.
      why_suited: 'Nothing identifiable.',
      section_key: 'comparison',
      priority: 'low',
    },
  ],
});

const CLASSIFICATION = JSON.stringify({
  article_type: 'buying-guide',
  confidence: 0.8,
  primary_intent: 'commercial',
  secondary_intent: 'informational',
  reasoning_summary: 'The reader wants to choose shoes.',
});

function articleReply(): string {
  // Written to the real template so the sections actually match, rather than
  // to keys invented by the test.
  const template = templates.getDefaultTemplateForType('buying-guide')!;
  return JSON.stringify({
    title: 'Why Trail Runners Roll Ankles',
    excerpt: 'What happens, and what helps.',
    sections: template.contentSchema.sections.map((section) => ({
      key: section.key,
      heading: section.key,
      body: 'Body text that is long enough to be a real paragraph in the draft. '.repeat(20),
    })),
    faq: [{ question: 'Do braces help?', answer: 'Sometimes.' }],
    sources: [{ url: 'https://example.test/s', title: 'A source' }],
  });
}

function reviewReply(revisionRequired: boolean): string {
  return JSON.stringify({
    revision_required: revisionRequired,
    overall_score: revisionRequired ? 0.6 : 0.9,
    summary: 'An assessment of the draft.',
    strengths: ['Clear structure'],
    product_assessment: 'No products.',
    issues: revisionRequired
      ? [
          {
            severity: 'major',
            section: 'introduction',
            problem: 'The opening claim is unsupported.',
            required_change: 'Attribute it or remove it.',
            scope: 'passage',
          },
        ]
      : [],
    preserve_sections: [],
  });
}

/** Routes a reply by which stage is asking. */
function router(options: { revisionRequired?: boolean } = {}) {
  return (prompt: string): string => {
    if (prompt.includes('senior editorial researcher')) return SHORTLIST;
    if (prompt.includes('You are an SEO analyst')) return KEYWORDS;
    if (prompt.includes('classifying an article')) return CLASSIFICATION;
    if (prompt.includes('independent editor reviewing')) return reviewReply(options.revisionRequired === true);
    if (prompt.includes('what kinds of product an article should be able to recommend')) return OPPORTUNITIES;
    return articleReply();
  };
}

/** A reasonable answer to each checkpoint, for tests walking through to a later one. */
function decisionFor(kind: 'topic' | 'keywords_title' | 'template' | 'products'): unknown {
  switch (kind) {
    case 'topic':
      return { index: 0 };
    case 'keywords_title':
      return {
        title: 'Why Trail Runners Roll Ankles',
        primaryKeyword: 'trail running ankle injuries',
        secondaryKeywords: ['ankle roll'],
        longTailKeywords: [],
      };
    case 'template':
      return { articleType: null };
    case 'products':
      // No products. The common answer, and the one that proves an article
      // reaches the writer without any.
      return { productIds: [] };
  }
}

function startGuided(seedTopic: string | null = null) {
  const started = orchestrator.startArticlePipeline({
    themeId: theme.id,
    mode: 'development',
    runMode: 'guided',
    seedTopic,
  });
  assert.ok('pipelineId' in started, 'the run should start');
  return started as { pipelineId: number; articleId: number };
}

/* ---------------------------------------------------------- the shape --- */

test('SHORTLIST: topic research returns four options and flattens the recommendation', async () => {
  replies = router();
  const { pipelineId } = startGuided();

  const status = await orchestrator.advancePipeline(pipelineId);
  const output = repo.findCompletedStage(
    status.pipeline.id,
    status.pipeline.version,
    'topic_research',
  )!.output as research.TopicResearchSet;

  assert.equal(output.candidates.length, 4);
  assert.equal(output.recommendedIndex, 1);
  // The recommendation is also the top level, which is what keeps every
  // downstream stage and the automatic path unchanged.
  assert.equal(output.topic, 'Why trail runners roll ankles');
  assert.equal(output.recommendedAngle, 'Mechanism, then prevention.');
});

test('SHORTLIST: a single-topic reply is read as a shortlist of one, not rejected', async () => {
  // A model that concludes only one topic here is worth producing has given a
  // legitimate answer to the question asked, not a malformed one.
  replies = () => JSON.stringify(topicCandidate('The only topic worth doing', 'One angle.'));

  const { pipelineId } = startGuided();
  const status = await orchestrator.advancePipeline(pipelineId);

  const options = status.checkpoint!.options as ReturnType<typeof checkpoints.buildTopicOptions>;
  assert.equal(options.candidates.length, 1);
  assert.equal(options.recommendedIndex, 0);
  assert.equal(options.candidates[0].topic, 'The only topic worth doing');
});

test('SHORTLIST: a topic missing a required field still fails the stage', async () => {
  // Accepting a shorter list is not leniency about a broken one.
  replies = () => JSON.stringify({ topics: [{ topic: 'Something', research_summary: 'x' }] });

  const { pipelineId } = startGuided();
  await assert.rejects(() => orchestrator.advancePipeline(pipelineId));
  assert.equal(repo.getPipelineById(pipelineId)!.state, 'FAILED');
});

test('SHORTLIST: a recommendation pointing outside the list falls back to the first', async () => {
  replies = () =>
    JSON.stringify({ recommended_index: 9, topics: [topicCandidate('Only option', 'An angle.')] });

  const { pipelineId } = startGuided();
  const status = await orchestrator.advancePipeline(pipelineId);
  const output = repo.findCompletedStage(
    status.pipeline.id,
    status.pipeline.version,
    'topic_research',
  )!.output as research.TopicResearchSet;

  assert.equal(output.recommendedIndex, 0);
  assert.equal(output.topic, 'Only option');
});

/* --------------------------------------------------------- the pausing --- */

test('GUIDED: the run stops at the topic checkpoint and calls nothing further', async () => {
  replies = router();
  const { pipelineId } = startGuided();

  const before = calls.length;
  const status = await orchestrator.advancePipeline(pipelineId);
  const madeCalls = calls.length - before;

  assert.equal(madeCalls, 1, 'exactly one stage ran: topic research');
  assert.ok(status.checkpoint, 'the run is waiting');
  assert.equal(status.checkpoint!.kind, 'topic');
  assert.equal(status.finished, false);

  // The next stage has not begun. Pausing must not leave half a stage behind.
  assert.equal(repo.findCompletedStage(pipelineId, 1, 'keyword_research'), null);

  // And asking again does not run anything else either.
  const again = await orchestrator.advancePipeline(pipelineId);
  assert.equal(calls.length - before, 1, 'advancing a waiting run costs nothing');
  assert.equal(again.checkpoint!.kind, 'topic');
});

test('GUIDED: the options offered are the four topics, with the recommendation marked', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  const status = await orchestrator.advancePipeline(pipelineId);

  const options = status.checkpoint!.options as ReturnType<typeof checkpoints.buildTopicOptions>;
  assert.equal(options.candidates.length, 4);
  assert.equal(options.recommendedIndex, 1);
  assert.equal(options.candidates[2].topic, 'Fuelling a first ultra');
  assert.equal(options.candidates[0].sourceCount, 1);
});

/* -------------------------------------------------------- the deciding --- */

test('DECIDE: choosing a topic other than the recommendation is what gets written', async () => {
  replies = router();
  const { pipelineId, articleId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);

  const decided = orchestrator.decide(pipelineId, 'topic', { index: 2 });
  assert.ok('pipeline' in decided);

  // Answering does not advance: the next stage costs money.
  assert.equal(repo.findCompletedStage(pipelineId, 1, 'keyword_research'), null);

  const status = await orchestrator.advancePipeline(pipelineId);
  assert.equal(status.checkpoint!.kind, 'keywords_title', 'it moved on to the next question');

  const stored = db.prepare('SELECT topic FROM articles WHERE id = ?').get(articleId) as { topic: string | null };
  assert.equal(stored.topic, null, 'the article topic is written after classification, not at the checkpoint');

  // The keyword stage was asked about the CHOSEN topic, not the recommended
  // one. This is the assertion that matters: a decision that does not reach
  // the next prompt is not a decision.
  const keywordPrompt = prompts[prompts.length - 1];
  assert.match(keywordPrompt, /Fuelling a first ultra/, 'the chosen topic was carried into keyword research');
  assert.doesNotMatch(keywordPrompt, /Why trail runners roll ankles/, 'the recommendation was not used');
  assert.ok(repo.findCompletedStage(pipelineId, 1, 'keyword_research'), 'keyword research ran');
});

test('DECIDE: an index outside the shortlist is refused rather than rounded', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);

  const result = orchestrator.decide(pipelineId, 'topic', { index: 11 });
  assert.ok('error' in result);
  assert.match((result as { error: string }).error, /no topic 11/i);

  // Still waiting, and still answerable.
  assert.equal(orchestrator.getPipelineStatus(pipelineId)!.checkpoint!.kind, 'topic');
});

test('DECIDE: a topic of your own is never presented as researched', () => {
  const set = JSON.parse(SHORTLIST);
  const parsed = {
    ...set.topics[1],
    topic: set.topics[1].topic,
    recommendedAngle: set.topics[1].recommended_angle,
    researchSummary: set.topics[1].research_summary,
    whyNow: 'Evergreen.',
    contentGap: 'A gap.',
    researchSources: [{ url: 'https://example.test/s', title: 'x', note: 'y' }],
    competingContentObservations: ['listicles'],
    candidates: [],
    recommendedIndex: 0,
  } as never;

  const applied = checkpoints.applyTopicDecision(
    { ...(parsed as object), candidates: [parsed], recommendedIndex: 0 } as never,
    { customTopic: 'Something I thought of myself' },
  );

  assert.ok(!('error' in applied));
  const topic = applied as { topic: string; researchSummary: string; researchSources: unknown[]; whyNow: string };
  assert.equal(topic.topic, 'Something I thought of myself');
  assert.equal(topic.researchSources.length, 0, 'sources for another topic do not carry over');
  assert.equal(topic.whyNow, '', 'timing found for another topic does not carry over');
  assert.match(topic.researchSummary, /set by the editor/i);
  assert.match(topic.researchSummary, /not been researched/i);
});

test('DECIDE: an answered checkpoint cannot be quietly re-answered', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);

  assert.ok('pipeline' in orchestrator.decide(pipelineId, 'topic', { index: 0 }));
  const second = orchestrator.decide(pipelineId, 'topic', { index: 3 });
  assert.ok('error' in second);
  assert.match((second as { error: string }).error, /already been made/i);
});

test('DECIDE: taking the recommendation is recorded as accepted, not as a choice', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);

  orchestrator.decide(pipelineId, 'topic', { index: 1 }, { accepted: true });
  const status = orchestrator.getPipelineStatus(pipelineId)!;
  const decision = status.decisions.find((entry) => entry.kind === 'topic')!;
  assert.equal(decision.resolution, 'accepted');
});

/* ------------------------------------------------------- handing back --- */

test('AUTOMATIC: switching mid-run settles outstanding decisions as automatic, never as accepted', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);
  assert.equal(orchestrator.getPipelineStatus(pipelineId)!.checkpoint!.kind, 'topic');

  const switched = orchestrator.changeRunMode(pipelineId, 'automatic');
  assert.ok('pipeline' in switched);

  const status = orchestrator.getPipelineStatus(pipelineId)!;
  assert.equal(status.runMode, 'automatic');
  assert.equal(status.checkpoint, null);

  const topicDecision = status.decisions.find((entry) => entry.kind === 'topic')!;
  assert.equal(topicDecision.resolution, 'automatic', 'nobody approved this — Cynth settled it');
  assert.equal(topicDecision.decision, null);

  // And it runs to the end without asking again.
  const finished = await orchestrator.advancePipeline(pipelineId);
  assert.equal(finished.checkpoint, null);
  assert.ok(finished.finished, 'the run completed once nobody was being asked');
});

test('AUTOMATIC: a run started automatically opens no checkpoints at all', async () => {
  replies = router();
  const started = orchestrator.startArticlePipeline({ themeId: theme.id, mode: 'development' });
  assert.ok('pipelineId' in started);
  const { pipelineId } = started as { pipelineId: number };

  const status = await orchestrator.advancePipeline(pipelineId);
  assert.equal(status.runMode, 'automatic');
  assert.equal(status.checkpoint, null);
  assert.equal(repo.listCheckpoints(pipelineId).length, 0, 'nothing was ever opened');
  assert.ok(status.finished);
});

/* -------------------------------------------------------- the revision --- */

test('REVIEW: declining the revision the reviewer asked for leaves the draft as written', async () => {
  replies = router({ revisionRequired: true });
  const { pipelineId } = startGuided();

  // Walk to the review checkpoint, taking the recommendation each time.
  for (const kind of ['topic', 'keywords_title', 'template', 'products'] as const) {
    const status = await orchestrator.advancePipeline(pipelineId);
    assert.equal(status.checkpoint!.kind, kind);
    assert.ok('pipeline' in orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true }));
  }

  const atReview = await orchestrator.advancePipeline(pipelineId);
  assert.equal(atReview.checkpoint!.kind, 'review');
  const options = atReview.checkpoint!.options as { revisionRequired: boolean; revisionsRemaining: number };
  assert.equal(options.revisionRequired, true);
  assert.equal(options.revisionsRemaining, 1);

  orchestrator.decide(pipelineId, 'review', { action: 'accept' });
  const finished = await orchestrator.advancePipeline(pipelineId);

  assert.equal(finished.revisions.used, 0, 'the revision was declined, so none was spent');
  assert.equal(repo.findCompletedStage(pipelineId, 1, 'article_revision'), null);
  assert.ok(finished.finished);
});

test('REVIEW: the cap holds — a requested revision runs once and there is no second', async () => {
  replies = router({ revisionRequired: true });
  const { pipelineId } = startGuided();

  for (const kind of ['topic', 'keywords_title', 'template', 'products'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }

  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'review', { action: 'revise' });
  const finished = await orchestrator.advancePipeline(pipelineId);

  assert.equal(finished.revisions.used, 1);
  assert.equal(finished.revisions.max, 1);
  assert.equal(repo.canRevise(pipelineId).allowed, false, 'there is no second revision to reach');
});

/* ------------------------------------------------------------- reruns --- */

test('RERUN: a non-generated decision cannot be asked again, because the answer would not change', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'topic', { index: 0 }, { accepted: true });
  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(
    pipelineId,
    'keywords_title',
    { title: 'A title', primaryKeyword: 'a keyword', secondaryKeywords: [], longTailKeywords: [] },
    { accepted: true },
  );
  await orchestrator.advancePipeline(pipelineId);

  const result = await orchestrator.rerunForCheckpoint(pipelineId, 'template');
  assert.ok('error' in result);
  assert.match((result as { error: string }).error, /decided by Cynth/i);
});

test('RERUN: asking for different topics runs the stage again and keeps the first attempt', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);

  const before = calls.length;
  replies = () =>
    JSON.stringify({
      recommended_index: 0,
      topics: [topicCandidate('A completely different topic', 'A different angle.')],
    });

  const result = await orchestrator.rerunForCheckpoint(pipelineId, 'topic', { confirmedCost: true });
  assert.ok('pipeline' in result);
  assert.equal(calls.length - before, 1, 'exactly one more call was made');

  const status = orchestrator.getPipelineStatus(pipelineId)!;
  const options = status.checkpoint!.options as ReturnType<typeof checkpoints.buildTopicOptions>;
  assert.equal(options.candidates[0].topic, 'A completely different topic', 'the new options are shown');

  // The first attempt is still on record: money spent on options nobody chose
  // was still spent, and the cost breakdown must keep saying so.
  const attempts = repo.listStageRuns(pipelineId, 1).filter((run) => run.stage === 'topic_research');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].attempt, 1);
  assert.equal(attempts[1].attempt, 2);
});

test('RERUN: a decision that is already made cannot have its options replaced underneath it', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'topic', { index: 0 });

  const result = await orchestrator.rerunForCheckpoint(pipelineId, 'topic', { confirmedCost: true });
  assert.ok('error' in result);
  assert.match((result as { error: string }).error, /not open/i);
});

/* -------------------------------------------------------------- resume --- */

test('RESUME: a failed stage does not throw away the stages that succeeded', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'topic', { index: 0 }, { accepted: true });

  // The SEO stage fails the way a flaky provider actually fails.
  replies = (prompt) => (prompt.includes('You are an SEO analyst') ? 'not json at all' : router()(prompt));
  await assert.rejects(() => orchestrator.advancePipeline(pipelineId));
  assert.equal(repo.getPipelineById(pipelineId)!.state, 'FAILED');

  // Which, before this, was the end of the run: advancing a terminal pipeline
  // returns immediately, so the only way on was a new version that re-runs and
  // re-charges the research that already succeeded.
  const stuck = await orchestrator.advancePipeline(pipelineId);
  assert.equal(stuck.pipeline.state, 'FAILED');

  const resumed = orchestrator.resumeAfterFailure(pipelineId);
  assert.ok('pipeline' in resumed);
  assert.equal((resumed as { pipeline: { state: string } }).pipeline.state, 'RESEARCH_COMPLETE');

  const before = calls.length;
  replies = router();
  const resumedStatus = await orchestrator.advancePipeline(pipelineId);

  // It is a guided run, so it carries on to the NEXT question rather than to
  // the end — which is exactly the point: the run continued from where it
  // broke instead of starting over.
  assert.equal(resumedStatus.checkpoint!.kind, 'keywords_title');
  assert.ok(repo.findCompletedStage(pipelineId, 1, 'keyword_research'), 'the failed stage succeeded on the retry');
  // The proof that nothing was paid for twice: topic research still has one
  // successful attempt, and the retry did not add another.
  const topicRuns = repo
    .listStageRuns(pipelineId, 1)
    .filter((run) => run.stage === 'topic_research' && run.status === 'success');
  assert.equal(topicRuns.length, 1, 'the research that succeeded was reused, not repeated');
  assert.ok(calls.length - before >= 1, 'the failed stage did run again');

  // And the decision made before the failure survived it.
  const decision = orchestrator.getPipelineStatus(pipelineId)!.decisions.find((entry) => entry.kind === 'topic')!;
  assert.equal(decision.resolution, 'accepted');
});

test('RESUME: a run that has not failed is not reopened', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);

  const result = orchestrator.resumeAfterFailure(pipelineId);
  assert.ok('error' in result);
  assert.match((result as { error: string }).error, /has not failed/i);
});

/* ------------------------------------------------------------ products --- */

function makeProduct(title: string, options: { themeId?: number | null; useCase?: string; problemSolved?: string } = {}) {
  const product = products.createProduct({
    title,
    affiliateLink: `https://example.test/${encodeURIComponent(title)}`,
    themeId: options.themeId ?? null,
    useCase: options.useCase,
    problemSolved: options.problemSolved,
  } as never);
  return product;
}

test('PRODUCTS: the checkpoint offers this area first, and everything else second', async () => {
  const mine = makeProduct('Trail Shoe A', { themeId: theme.id, useCase: 'Running on loose rock' });
  const elsewhere = makeProduct('Office Chair', { themeId: otherTheme.id, useCase: 'Sitting' });
  const unfiled = makeProduct('Unfiled Thing');

  replies = router();
  const { pipelineId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }

  const status = await orchestrator.advancePipeline(pipelineId);
  assert.equal(status.checkpoint!.kind, 'products');

  const options = status.checkpoint!.options as {
    themeId: number | null;
    themeName: string | null;
    inTheme: { productId: number; readiness: string }[];
    others: { productId: number }[];
    placementSlots: number;
  };

  // Named from the area itself, so an area with no products yet still reports
  // which area it is rather than reading as "no area".
  assert.equal(options.themeId, theme.id);
  assert.equal(options.themeName, 'Trail Running');

  assert.deepEqual(
    options.inTheme.map((entry) => entry.productId),
    [mine.id],
    'only this area is offered first',
  );

  const otherIds = options.others.map((entry) => entry.productId);
  assert.ok(otherIds.includes(elsewhere.id), 'a product filed elsewhere stays reachable');
  assert.ok(otherIds.includes(unfiled.id), 'so does an unfiled one');

  // The template's real product slots, not a number typed into the UI.
  assert.ok(options.placementSlots > 0, 'a buying guide has somewhere to put a product');
});

test('PRODUCTS: a product with nothing recorded about its purpose is flagged BEFORE it is chosen', async () => {
  const thin = makeProduct('Mystery Gadget', { themeId: theme.id });
  const ready = makeProduct('Explained Gadget', {
    themeId: theme.id,
    useCase: 'Keeping feet dry',
    problemSolved: 'Wet socks on river crossings',
  });

  replies = router();
  const { pipelineId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }
  const status = await orchestrator.advancePipeline(pipelineId);

  const options = status.checkpoint!.options as {
    inTheme: { productId: number; readiness: string; readinessNote: string | null }[];
  };
  const thinEntry = options.inTheme.find((entry) => entry.productId === thin.id)!;
  const readyEntry = options.inTheme.find((entry) => entry.productId === ready.id)!;

  assert.equal(thinEntry.readiness, 'thin');
  assert.match(thinEntry.readinessNote!, /no basis for placing it/i);
  assert.equal(readyEntry.readiness, 'ready');
  assert.equal(readyEntry.readinessNote, null);
});

test('PRODUCTS: what is chosen is attached, and what is not is detached', async () => {
  const first = makeProduct('Pack A', { themeId: theme.id, useCase: 'Day hikes' });
  const second = makeProduct('Pack B', { themeId: theme.id, useCase: 'Overnights' });

  replies = router();
  const { pipelineId, articleId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }
  await orchestrator.advancePipeline(pipelineId);

  // Something attached beforehand that the editor does NOT choose.
  articleProducts.attachProduct(articleId, { productId: second.id });

  orchestrator.decide(pipelineId, 'products', { productIds: [first.id] });
  await orchestrator.advancePipeline(pipelineId);

  const attached = articleProducts.listArticleProducts(articleId).map((row) => row.productId);
  assert.deepEqual(attached, [first.id], 'the decision is exact, not additive');

  // The product itself survives being detached — it is a shared record.
  assert.ok(products.getProductById(second.id), 'unchoosing a product does not delete it');
});

test('PRODUCTS: what the editor chose reaches the writer, with what it is FOR', async () => {
  const chosen = makeProduct('Gaiter Pro', {
    themeId: theme.id,
    useCase: 'Keeping grit out of low-cut shoes',
    problemSolved: 'Stopping every mile to empty a shoe',
  });

  replies = router();
  const { pipelineId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }
  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'products', { productIds: [chosen.id] });

  const before = prompts.length;
  await orchestrator.advancePipeline(pipelineId);

  const writerPrompt = prompts.slice(before).find((prompt) => prompt.includes('=== PRODUCTS AVAILABLE ==='))!;
  assert.ok(writerPrompt, 'the writer was given a product block');
  assert.match(writerPrompt, /Gaiter Pro/);
  assert.match(writerPrompt, /What it is for: Keeping grit out of low-cut shoes/);
  assert.match(writerPrompt, /Problem it addresses: Stopping every mile to empty a shoe/);
  // The framing that stops a placement being forced.
  assert.match(writerPrompt, /Options, not requirements/);
  assert.match(writerPrompt, /Leaving a product out is a correct outcome/);
});

test('PRODUCTS: choosing none is a real answer, and the run continues without a product block', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }
  await orchestrator.advancePipeline(pipelineId);

  assert.ok('pipeline' in orchestrator.decide(pipelineId, 'products', { productIds: [] }));

  const before = prompts.length;
  const status = await orchestrator.advancePipeline(pipelineId);
  assert.equal(status.checkpoint!.kind, 'review', 'it moved on');

  const writerPrompt = prompts.slice(before).find((prompt) => prompt.includes('=== TEMPLATE:'))!;
  assert.ok(!writerPrompt.includes('=== PRODUCTS AVAILABLE ==='), 'no product block at all');
});

test('PRODUCTS: an automatic run never asks, and attaches nothing', async () => {
  makeProduct('Never Chosen', { themeId: theme.id, useCase: 'x' });

  replies = router();
  const started = orchestrator.startArticlePipeline({ themeId: theme.id, mode: 'development' });
  const { pipelineId, articleId } = started as { pipelineId: number; articleId: number };

  const status = await orchestrator.advancePipeline(pipelineId);
  assert.equal(status.checkpoint, null);
  assert.equal(
    articleProducts.listArticleProducts(articleId).length,
    0,
    'nothing is attached by a run that was never asked',
  );
});

/* ------------------------------------------------- product opportunities --- */

test('OPPORTUNITY: the checkpoint proposes what to shop for, from the article itself', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }

  const status = await orchestrator.advancePipeline(pipelineId);
  assert.equal(status.checkpoint!.kind, 'products');

  const options = status.checkpoint!.options as {
    opportunities: { productType: string; sectionKey: string | null; searchTerms: string[]; priority: string }[];
    opportunityAssessment: string | null;
  };

  assert.equal(options.opportunityAssessment, 'This article can carry footwear and support products honestly.');
  assert.equal(options.opportunities.length, 2, 'a suggestion with no product type is dropped as unusable');

  const first = options.opportunities[0];
  assert.equal(first.productType, 'Trail running shoes with rock plates');
  assert.equal(first.sectionKey, 'recommended_products');
  assert.deepEqual(first.searchTerms, ['trail running shoes rock plate', 'protective trail shoes']);
  assert.equal(first.priority, 'high');

  // A section the template does not have is recorded as null rather than
  // coerced to the nearest one — the suggestion is still useful, but it must
  // not claim a place it does not have.
  assert.equal(options.opportunities[1].sectionKey, null);
});

test('OPPORTUNITY: an automatic run is never charged for a shopping list nobody reads', async () => {
  replies = router();
  const started = orchestrator.startArticlePipeline({ themeId: theme.id, mode: 'development' });
  const { pipelineId } = started as { pipelineId: number };

  const status = await orchestrator.advancePipeline(pipelineId);

  assert.equal(repo.findCompletedStage(pipelineId, 1, 'product_opportunity'), null, 'the stage never ran');
  const stage = status.stages.find((entry) => entry.stage === 'product_opportunity')!;
  assert.equal(stage.status, 'skipped', 'and the progress list says so rather than implying work still to come');
});

test('OPPORTUNITY: the suggestions never reach the article writer', async () => {
  // Categories are a brief for the editor. A category in the writer's prompt
  // is an invitation to describe a product nobody owns.
  replies = router();
  const { pipelineId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }
  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'products', { productIds: [] });

  const before = prompts.length;
  await orchestrator.advancePipeline(pipelineId);

  const writerPrompt = prompts.slice(before).find((prompt) => prompt.includes('=== TEMPLATE:'))!;
  assert.ok(writerPrompt, 'the writer ran');
  assert.ok(
    !writerPrompt.includes('Trail running shoes with rock plates'),
    'a category the editor did not buy must not reach the writer',
  );
});

test('OPPORTUNITY: the prompt asks for categories and forbids named products', async () => {
  replies = router();
  const { pipelineId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }

  const before = prompts.length;
  await orchestrator.advancePipeline(pipelineId);

  const prompt = prompts
    .slice(before)
    .find((entry) => entry.includes('what kinds of product an article should be able to recommend'))!;

  assert.ok(prompt, 'the stage ran');
  assert.match(prompt, /Propose CATEGORIES of product, never specific products/);
  assert.match(prompt, /Do not state prices, brands, model numbers or availability/);
  assert.match(prompt, /return an empty list and say why/);
  // It is given the skeleton, which is the whole point of asking it here.
  assert.match(prompt, /=== THE SKELETON:/);
  assert.match(prompt, /- recommended_products/);
});

/* ---------------------------------------------------------- the spend gate --- */

test('SPEND: declining to pay does NOT fail the run', async () => {
  // The bug this covers: a refused cost confirmation was treated as a failed
  // stage, which moved the pipeline to FAILED — a terminal state. Answering
  // "not now" to a question therefore ended the run, and the only way forward
  // was to start over and pay for everything again.
  const paidModel = Number(
    db
      .prepare(
        `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free, cost_tier)
         VALUES (?, 'stub/paid', 1, 0.000003, 0.000015, 0, 'standard')`,
      )
      .run(providerId).lastInsertRowid,
  );
  roles.setRoleAssignment('topic_research', 'development', { primaryModelId: paidModel, fallbackModelId: null });
  settings.setSetting('generation.mode', 'production');

  replies = router();
  const { pipelineId } = startGuided();

  const before = calls.length;
  await assert.rejects(
    () => orchestrator.advancePipeline(pipelineId),
    (error: { code?: string }) => error.code === 'cost_confirmation_required',
  );

  assert.equal(calls.length, before, 'nothing was sent, so nothing was charged');
  assert.notEqual(
    repo.getPipelineById(pipelineId)!.state,
    'FAILED',
    'a question the user has not answered is not a failure',
  );
  // And it is put back where it was, rather than left reading as in-progress
  // while it waits for an answer.
  assert.equal(repo.getPipelineById(pipelineId)!.state, 'DRAFT', 'the run is where it was before the stage started');
  assert.equal(orchestrator.getPipelineStatus(pipelineId)!.finished, false, 'the run is still alive');

  // And confirming afterwards carries straight on, with no new version and no
  // repeated work.
  const status = await orchestrator.advancePipeline(pipelineId, { confirmedCost: true });
  assert.equal(status.checkpoint!.kind, 'topic', 'it ran and stopped at the first question');

  roles.setRoleAssignment('topic_research', 'development', { primaryModelId: modelId, fallbackModelId: null });
  settings.setSetting('generation.mode', 'test');
});

test('SPEND: the refusal states what it would cost, so there is something to confirm', async () => {
  const paidModel = Number(
    db
      .prepare(
        `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free, cost_tier)
         VALUES (?, 'stub/priced', 1, 0.000003, 0.000015, 0, 'standard')`,
      )
      .run(providerId).lastInsertRowid,
  );
  roles.setRoleAssignment('topic_research', 'development', { primaryModelId: paidModel, fallbackModelId: null });
  settings.setSetting('generation.mode', 'production');

  replies = router();
  const { pipelineId } = startGuided();

  await assert.rejects(
    () => orchestrator.advancePipeline(pipelineId),
    (error: { code?: string; spend?: Record<string, unknown> }) => {
      assert.equal(error.code, 'cost_confirmation_required');
      assert.ok(error.spend, 'the refusal carries the figure');
      assert.equal(error.spend!.stage, 'topic_research');
      assert.equal(error.spend!.stageLabel, 'Topic Research');
      assert.equal(error.spend!.model, 'stub/priced');
      assert.equal(error.spend!.costClass, 'paid');
      assert.equal(typeof error.spend!.estimatedCost, 'number', 'and it is a real number, not a promise of one');
      assert.ok((error.spend!.estimatedCost as number) > 0);
      return true;
    },
  );

  roles.setRoleAssignment('topic_research', 'development', { primaryModelId: modelId, fallbackModelId: null });
  settings.setSetting('generation.mode', 'test');
});

test('SPEND: free and paid models can be mixed in one run, and only the paid one asks', async () => {
  // The cost lever this proves: "Production mode" does not mean "every stage
  // is paid". A role is resolved at the moment its stage runs, so a free model
  // assigned to a role runs for nothing in Production, and the gate trips only
  // at the stages that actually cost something.
  const paidModel = Number(
    db
      .prepare(
        `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free, cost_tier)
         VALUES (?, 'stub/expensive', 1, 0.000005, 0.000025, 0, 'premium')`,
      )
      .run(providerId).lastInsertRowid,
  );

  // Free research, paid writing — the shape of a real cost-saving setup.
  roles.setRoleAssignment('topic_research', 'development', { primaryModelId: modelId, fallbackModelId: null });
  roles.setRoleAssignment('keyword_research', 'development', { primaryModelId: modelId, fallbackModelId: null });
  roles.setRoleAssignment('article_writer', 'development', { primaryModelId: paidModel, fallbackModelId: null });
  settings.setSetting('generation.mode', 'production');

  replies = router();
  const { pipelineId } = startGuided();

  // The free stages run with no confirmation at all.
  const atTopic = await orchestrator.advancePipeline(pipelineId);
  assert.equal(atTopic.checkpoint!.kind, 'topic', 'topic research ran without asking to spend');
  assert.ok(repo.findCompletedStage(pipelineId, 1, 'topic_research'), 'and it really ran');

  for (const kind of ['topic', 'keywords_title', 'template', 'products'] as const) {
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
    if (kind !== 'products') await orchestrator.advancePipeline(pipelineId);
  }

  // The paid one, and only the paid one, stops for authorisation.
  await assert.rejects(
    () => orchestrator.advancePipeline(pipelineId),
    (error: { code?: string; spend?: Record<string, unknown> }) => {
      assert.equal(error.code, 'cost_confirmation_required');
      assert.equal(error.spend!.stage, 'article_generation', 'the writer is where the money is');
      assert.equal(error.spend!.model, 'stub/expensive');
      return true;
    },
  );

  // Everything before it is already done and is not paid for again.
  assert.ok(repo.findCompletedStage(pipelineId, 1, 'keyword_research'));
  assert.ok(repo.findCompletedStage(pipelineId, 1, 'article_classification'));

  roles.setRoleAssignment('article_writer', 'development', { primaryModelId: modelId, fallbackModelId: null });
  settings.setSetting('generation.mode', 'test');
});

/* ------------------------------------------------ picking a run back up --- */

test('RESUME: a run left part-way through is listed, with what it is waiting on', async () => {
  // The gap this covers: a run was reachable only by the redirect that followed
  // starting it. Walk away — to change a model in Settings, which is exactly
  // what a failed stage invites — and a live run holding paid research became
  // unreachable. It read as an empty draft, and the only apparent way on was to
  // start again and pay for the same research twice.
  replies = router();
  const { pipelineId, articleId } = startGuided();

  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'topic', decisionFor('topic'), { accepted: true });
  await orchestrator.advancePipeline(pipelineId);

  const run = orchestrator.listResumableRuns().find((entry) => entry.pipelineId === pipelineId);
  assert.ok(run, 'a run with work left in it is offered');
  assert.equal(run!.articleId, articleId);
  assert.equal(run!.failed, false);

  // The identity comes from the run's own output. The article row has no title
  // and no topic yet — that is precisely why the draft looked empty.
  assert.ok(run!.topic, 'it knows what it is about');
  assert.equal(
    db.prepare('SELECT topic FROM articles WHERE id = ?').get(articleId).topic,
    null,
    'and the article row still does not, which is the reason this list exists',
  );

  assert.equal(run!.waitingFor, 'Title and keywords', 'it says which question is open');
  assert.equal(run!.themeName, theme.name);
});

test('RESUME: a finished run is not offered, and a failed one is', async () => {
  // Two different meanings of "terminal". READY has finished and there is
  // nothing to pick up. FAILED runs nothing further on its own, but is exactly
  // the state a person acts on — so it must still be reachable.
  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);

  const listed = () => orchestrator.listResumableRuns().find((entry) => entry.pipelineId === pipelineId);

  repo.setState(pipelineId, 'READY', { stage: null });
  assert.equal(listed(), undefined, 'a finished run is not offered');

  repo.setState(pipelineId, 'NEEDS_EDITORIAL_ATTENTION', { stage: null });
  assert.equal(listed(), undefined, 'nor is one waiting on a human editor rather than a stage');

  repo.setState(pipelineId, 'FAILED', { stage: null, note: 'The model returned nothing.' });
  const failed = listed();
  assert.ok(failed, 'a failed run IS offered — it is the one a person can act on');
  assert.equal(failed!.failed, true);
  assert.equal(failed!.note, 'The model returned nothing.');
  assert.equal(failed!.nextStage, 'Keyword & Title Research', 'and it says what continuing would try');
});

test('RESUME: continuing after swapping the model keeps the paid work already done', async () => {
  // The reported case, end to end: a stage fails, the model is changed in
  // Settings, and the run carries on from where it stopped. The point is what
  // is NOT re-run — the research above it is never called a second time.
  const swapped = Number(
    db
      .prepare(
        `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free, cost_tier)
         VALUES (?, 'stub/replacement', 1, 0, 0, 1, 'free')`,
      )
      .run(providerId).lastInsertRowid,
  );

  replies = router();
  const { pipelineId } = startGuided();
  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'topic', decisionFor('topic'), { accepted: true });

  const researchRun = repo.findCompletedStage(pipelineId, 1, 'topic_research')!;
  repo.setState(pipelineId, 'FAILED', { stage: null, note: 'Keyword research failed.' });

  // What the user does next: change the model for the role that broke.
  roles.setRoleAssignment('keyword_research', 'development', {
    primaryModelId: swapped,
    fallbackModelId: null,
  });

  const reopened = orchestrator.resumeAfterFailure(pipelineId);
  assert.ok(!('error' in reopened), 'the run reopens rather than needing a new version');

  replies = router();
  const status = await orchestrator.advancePipeline(pipelineId);

  // The research stage was not run again: same row, same cost, same output.
  const afterResearch = repo.findCompletedStage(pipelineId, 1, 'topic_research')!;
  assert.equal(afterResearch.id, researchRun.id, 'the research that was paid for is kept, not repeated');

  // And the stage that failed ran on the model that replaced the broken one.
  assert.equal(repo.findCompletedStage(pipelineId, 1, 'keyword_research')!.actualModel, 'stub/replacement');
  assert.equal(status.checkpoint!.kind, 'keywords_title', 'and the run carries on from where it stopped');

  roles.setRoleAssignment('keyword_research', 'development', { primaryModelId: modelId, fallbackModelId: null });
});

/* ------------------------------------------------------- the author voice --- */

const PERSONA_BODY = [
  '# Voice: Ines Okafor',
  'Open on the failure, never on the definition. The reader already knows what a trail shoe is.',
  'Never use the phrase "in today\'s fast-paced world". Never open with a rhetorical question.',
  'Sentences run short after a long one. That is the rhythm.',
].join('\n');

const SHARED_BODY = [
  '# EveryFiveDays house style',
  'We do not write listicles that pad to ten when six are worth having.',
  'Say what a thing costs and who should not buy it.',
].join('\n');

const personaSkill = skillsRepo.createSkill({
  authorId: author.id,
  scope: 'author',
  name: 'Author Persona: Trail Running',
  body: PERSONA_BODY,
  sourceFilename: 'persona-trail.md',
  position: 0,
  isActive: true,
} as never) as { id: number };

const sharedSkill = skillsRepo.createSkill({
  authorId: null,
  scope: 'shared',
  name: 'Shared Editorial Philosophy',
  body: SHARED_BODY,
  sourceFilename: 'shared.md',
  position: 0,
  isActive: true,
} as never) as { id: number };

test('VOICE: the writer is given the persona documents themselves, not their filenames', async () => {
  // The bug this covers: the prompt said "the author's full voice documents
  // (X, Y) govern tone, structure and vocabulary — follow them exactly", and
  // then never included X or Y. The model was told to obey a filename. The
  // documents were loaded here and discarded, and every article came out
  // sounding like a competent model rather than like the author.
  replies = router();
  const before = prompts.length;
  const { pipelineId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }
  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'products', { productIds: [] });
  await orchestrator.advancePipeline(pipelineId);

  const writerPrompt = prompts.slice(before).find((prompt) => prompt.includes('=== TEMPLATE:'))!;
  assert.ok(writerPrompt, 'the writer ran');

  // The actual text, not the name of the file it lives in.
  assert.ok(
    writerPrompt.includes('Open on the failure, never on the definition.'),
    'the persona body reaches the writer',
  );
  assert.ok(
    writerPrompt.includes('We do not write listicles that pad to ten'),
    'and so does the shared editorial philosophy',
  );

  // Naming a document the model cannot read is the exact defect. If the prompt
  // ever goes back to listing names without bodies, this fails.
  assert.ok(
    !/full voice documents \([^)]*\) govern/.test(writerPrompt),
    'the prompt no longer points at documents it has not supplied',
  );

  // And the conflict rule is stated, so a 500-character summary cannot quietly
  // outrank 5,000 characters of voice.
  assert.match(writerPrompt, /documents win/i);
});

test('VOICE: the reviewer and the reviser see the same documents as the writer', async () => {
  // Both matter for different reasons. The reviewer is asked to assess "author
  // voice" — against a name, that is not an assessment. The reviser is the one
  // stage allowed to rewrite prose, so without the voice it corrects sentences
  // into its own default register and quietly undoes the writer.
  replies = router({ revisionRequired: true });
  const before = prompts.length;
  const { pipelineId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }
  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'products', { productIds: [] });
  await orchestrator.advancePipeline(pipelineId);
  await orchestrator.advancePipeline(pipelineId);

  const since = prompts.slice(before);
  const reviewerPrompt = since.find((prompt) => prompt.includes('independent editor reviewing'))!;
  assert.ok(reviewerPrompt, 'the reviewer ran');
  assert.ok(
    reviewerPrompt.includes('Open on the failure, never on the definition.'),
    'the reviewer can actually judge the voice it is asked to judge',
  );

  orchestrator.decide(pipelineId, 'review', { action: 'revise' }, { accepted: false });
  await orchestrator.advancePipeline(pipelineId);

  const reviserPrompt = prompts.slice(before).find((prompt) => prompt.includes('applying a specific list'))!;
  assert.ok(reviserPrompt, 'the reviser ran');
  assert.ok(
    reviserPrompt.includes('Open on the failure, never on the definition.'),
    'a correction is written in the author\'s voice, not the reviser\'s',
  );
});

test('VOICE: deactivating a document takes it out of generation', async () => {
  // Deactivating is how a document is withdrawn without deleting it, and that
  // has to hold for the pipeline too — otherwise "inactive" means nothing here.
  skillsRepo.setSkillActiveStatus(personaSkill.id, false);
  skillsRepo.setSkillActiveStatus(sharedSkill.id, false);

  replies = router();
  const before = prompts.length;
  const { pipelineId } = startGuided();
  for (const kind of ['topic', 'keywords_title', 'template'] as const) {
    await orchestrator.advancePipeline(pipelineId);
    orchestrator.decide(pipelineId, kind, decisionFor(kind), { accepted: true });
  }
  await orchestrator.advancePipeline(pipelineId);
  orchestrator.decide(pipelineId, 'products', { productIds: [] });
  await orchestrator.advancePipeline(pipelineId);

  const writerPrompt = prompts.slice(before).find((prompt) => prompt.includes('=== TEMPLATE:'))!;
  assert.ok(!writerPrompt.includes('Open on the failure'), 'an inactive document is not sent');
  assert.ok(!writerPrompt.includes('=== VOICE DOCUMENTS ==='), 'and the section is omitted rather than left empty');

  skillsRepo.setSkillActiveStatus(personaSkill.id, true);
  skillsRepo.setSkillActiveStatus(sharedSkill.id, true);
});

/* --------------------------------------------------------- the exact idea --- */

test('IDEA: an exact subject is researched, not replaced with something adjacent', async () => {
  // The gap this covers: a steer was always a DIRECTION. "Write about the
  // healthiest snacks for cats recovering from illness" produced a shortlist of
  // other articles near that idea, and the one thing the editor actually asked
  // for was only ever one option among them.
  const idea = 'the healthiest snacks for cats recovering from a health problem';

  replies = router();
  const before = prompts.length;
  const started = orchestrator.startArticlePipeline({
    themeId: theme.id,
    mode: 'development',
    runMode: 'guided',
    seedTopic: idea,
    topicMode: 'exact',
  });
  assert.ok('pipelineId' in started);
  const { pipelineId } = started as { pipelineId: number };

  await orchestrator.advancePipeline(pipelineId);

  const researchPrompt = prompts.slice(before).find((prompt) => prompt.includes('senior editorial researcher'))!;
  assert.ok(researchPrompt.includes(idea), 'the idea reaches the researcher verbatim');
  assert.match(researchPrompt, /already decided the subject/);
  assert.match(researchPrompt, /Do not propose alternatives/);
  assert.match(researchPrompt, /Return exactly one topic/);

  // It must NOT be asked for a shortlist at the same time — the two
  // instructions together are how a model ends up doing neither properly.
  assert.ok(
    !/Propose \d+ distinct topics/.test(researchPrompt),
    'and it is not simultaneously asked to propose alternatives',
  );

  // Honest research is still required. Being told what to write is not a
  // licence to pretend the idea is good.
  assert.match(researchPrompt, /say so plainly in the research summary/);

  // The mode is on the run, so a resume days later is still faithful to it.
  assert.equal(repo.getPipelineById(pipelineId)!.topicMode, 'exact');
});

test('IDEA: exploring stays the behaviour when the editor wants angles', async () => {
  replies = router();
  const before = prompts.length;
  const started = orchestrator.startArticlePipeline({
    themeId: theme.id,
    mode: 'development',
    runMode: 'guided',
    seedTopic: 'anything about trail shoes',
    topicMode: 'explore',
  });
  const { pipelineId } = started as { pipelineId: number };
  await orchestrator.advancePipeline(pipelineId);

  const researchPrompt = prompts.slice(before).find((prompt) => prompt.includes('senior editorial researcher'))!;
  assert.match(researchPrompt, /proposed this direction/);
  assert.ok(!/already decided the subject/.test(researchPrompt), 'exploring is untouched by the exact path');
});

test('IDEA: exact without an idea is meaningless, and is not honoured', async () => {
  // Nothing to be faithful to. Recording 'exact' here would produce a run whose
  // stored intent contradicts its own prompt.
  const started = orchestrator.startArticlePipeline({
    themeId: theme.id,
    mode: 'development',
    runMode: 'guided',
    seedTopic: '   ',
    topicMode: 'exact',
  });
  const { pipelineId } = started as { pipelineId: number };
  assert.equal(repo.getPipelineById(pipelineId)!.topicMode, 'explore');
});

test.after(() => {
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
