/**
 * Template registry and research-stage tests (Milestone 21).
 *
 * What must hold:
 *   1. Templates are versioned and NEVER overwritten — an article written to
 *      v1 still means what it meant.
 *   2. Every article type resolves to a template, and the type/template pair
 *      travels with the article for WordPress.
 *   3. Research output is structured, validated and persisted — and a reply
 *      Cynth cannot validate fails the stage rather than being salvaged.
 *   4. The classifier cannot invent an article type outside the list.
 *
 * NO REAL PROVIDER IS CONTACTED.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-stages-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const secrets = await import('../src/shared/secrets/secretStore.js');
const templates = await import('../src/features/templates/templates.repository.js');
const definitions = await import('../src/features/templates/templates.definitions.js');
const repo = await import('../src/features/pipeline/pipeline.repository.js');
const roles = await import('../src/features/pipeline/roleRegistry.repository.js');
const research = await import('../src/features/pipeline/stages/researchStages.service.js');
const brief = await import('../src/features/pipeline/stages/briefStages.service.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const articles = await import('../src/features/articles/articles.repository.js');
const settings = await import('../src/shared/settings/settings.repository.js');

const init = dbModule.initializeDatabase();

const project = content.getDefaultProject()!;
const theme = content.createTheme(project.id, {
  name: 'Productive Workspace Setups',
  description: 'Desks, chairs, light and the small changes that make work sustainable.',
});
const author = authorsRepo.createAuthor({ name: 'Theo Lindqvist', expertise: 'Workspace ergonomics' } as never);

/* ------------------------------------------------------------ fetch stub */

let reply = '{}';
let status = 200;
const calls: string[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: string | URL | Request) => {
  calls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: reply } }],
      usage: { prompt_tokens: 500, completion_tokens: 400, total_tokens: 900 },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}) as typeof fetch;

secrets.setSecret('CYNTH_STAGES_TEST_KEY', 'not-a-real-credential');
const db = dbModule.getDatabase();

const providerId = Number(
  db
    .prepare(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
       VALUES ('Stub', 'openrouter', 'https://stub.test/api/v1', 'CYNTH_STAGES_TEST_KEY', 1)`,
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

for (const role of ['topic_research', 'keyword_research', 'article_writer'] as const) {
  roles.setRoleAssignment(role, 'development', { primaryModelId: modelId, fallbackModelId: null });
}
settings.setSetting('generation.mode', 'test');

function makePipeline() {
  const article = articles.createArticleDraft({
    articleTypeId: 1,
    authorId: author.id,
    productId: null,
    projectId: project.id,
    themeId: theme.id,
    topicId: null,
    title: 'Working title',
    topic: 'Workspace lighting',
    targetAudience: null,
    searchIntent: null,
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: null,
    secondaryKeywords: null,
  } as never);
  return { article, pipeline: repo.startPipeline({ articleId: article.id, mode: 'development', themeId: theme.id }) };
}

/* ------------------------------------------------------------ templates */

test('TEMPLATES: the eight initial templates are seeded on startup', () => {
  assert.equal(init.templatesSeeded, definitions.TEMPLATE_DEFINITIONS.length);
  const all = templates.listTemplates();
  assert.equal(all.length, 8);
  assert.deepEqual(
    all.map((t) => t.templateId).sort(),
    [
      'buying-guide-v1',
      'comparison-v1',
      'evidence-analysis-v1',
      'how-to-v1',
      'listicle-v1',
      'product-review-v1',
      'trend-analysis-v1',
      'ultimate-guide-v1',
    ],
  );
});

test('TEMPLATES: seeding is idempotent and never overwrites an existing version', () => {
  // Reads the seeded version rather than assuming 1. What is being protected
  // is that seeding does not overwrite, not which version happens to ship.
  const before = templates.getTemplate('how-to-v1')!;
  const seededVersion = before.version;

  // Simulate an edit the user made to a seeded template.
  db.prepare('UPDATE article_templates SET name = ? WHERE template_id = ? AND version = ?').run(
    'How-To (edited)',
    'how-to-v1',
    seededVersion,
  );

  const result = templates.seedTemplates();
  assert.equal(result.seeded, 0, 'nothing is re-seeded');
  assert.equal(result.existing, 8);
  assert.equal(
    templates.getTemplate('how-to-v1', seededVersion)!.name,
    'How-To (edited)',
    'the edit survives seeding',
  );

  db.prepare('UPDATE article_templates SET name = ? WHERE template_id = ? AND version = ?').run(
    before.name,
    'how-to-v1',
    seededVersion,
  );
});

test('TEMPLATES: editing creates a new version, leaving the old one intact', () => {
  const current = templates.getTemplate('listicle-v1')!;
  const currentVersion = current.version;

  const next = templates.saveTemplateVersion({
    templateId: 'listicle-v1',
    name: 'Listicle',
    articleTypeSlug: 'listicle',
    contentSchema: { ...current.contentSchema, minWords: 2500 },
    isDefault: true,
  });

  assert.equal(next.version, currentVersion + 1, 'the version advances by one');
  assert.equal(
    templates.getTemplate('listicle-v1', currentVersion)!.contentSchema.minWords,
    current.contentSchema.minWords,
    'the previous version is unchanged',
  );
  assert.equal(templates.getTemplate('listicle-v1')!.version, currentVersion + 1, 'the newest is what resolves');
});

test('TEMPLATES: every article type resolves to a template, including ones with none of their own', () => {
  const withOwn = templates.getDefaultTemplateForType('buying-guide')!;
  assert.equal(withOwn.templateId, 'buying-guide-v1');

  // explainer has no template of its own and borrows the guide structure.
  const borrowed = templates.getDefaultTemplateForType('explainer')!;
  assert.equal(borrowed.templateId, 'ultimate-guide-v1');

  for (const slug of ['how-to', 'comparison', 'product-review', 'case-study', 'myth-vs-fact', 'problem-solution']) {
    assert.ok(templates.getDefaultTemplateForType(slug), `${slug} must resolve to a template`);
  }
});

test('TEMPLATES: required sections match the specification', () => {
  const buyingGuide = templates.getDefaultTemplateForType('buying-guide')!;
  const keys = buyingGuide.contentSchema.sections.map((s) => s.key);
  for (const required of ['hero', 'what_to_consider', 'recommended_products', 'best_for_users', 'final_recommendation']) {
    assert.ok(keys.includes(required), `buying guide must contain ${required}`);
  }

  // The evidence template must demand its uncertainty section — the one most
  // often omitted, which is why it is required rather than optional.
  const evidence = templates.getDefaultTemplateForType('evidence-based-analysis')!;
  const uncertainty = evidence.contentSchema.sections.find((s) => s.key === 'what_remains_uncertain')!;
  assert.equal(uncertainty.required, true);
  assert.equal(evidence.contentSchema.requiresSources, true, 'an evidence article must cite');
});

/* -------------------------------------------------------- topic research */

const TOPIC_REPLY = JSON.stringify({
  topic: 'Whether monitor light bars actually reduce eye strain',
  theme: 'Productive Workspace Setups',
  research_summary: 'Coverage is dominated by affiliate roundups with no mechanism explanation.',
  why_now: 'Prices have fallen enough that the category is mainstream.',
  audience: 'Desk workers who already have a decent monitor',
  search_opportunity: 'Steady informational demand; no reliable volume figure available.',
  commercial_opportunity: 'Strong — the category is genuinely purchasable and comparison is useful.',
  content_gap: 'Nobody explains what the light actually does to contrast.',
  likely_search_intent: 'commercial',
  recommended_angle: 'Explain the mechanism first, then recommend.',
  competing_content_observations: ['Mostly listicles', 'Little primary testing'],
  research_sources: [{ url: 'https://example.test/study', title: 'A study', note: 'Contrast findings' }],
});

test('RESEARCH: topic research returns structured, persisted data', async () => {
  const { pipeline } = makePipeline();
  reply = TOPIC_REPLY;

  const result = await research.runTopicResearch(pipeline.id, { seedTopic: 'monitor light bars' });
  const output = result.output as research.TopicResearch;

  assert.equal(output.topic, 'Whether monitor light bars actually reduce eye strain');
  assert.equal(output.recommendedAngle, 'Explain the mechanism first, then recommend.');
  assert.deepEqual(output.competingContentObservations, ['Mostly listicles', 'Little primary testing']);
  assert.equal(output.researchSources[0].url, 'https://example.test/study');

  // Persisted, not discarded — a later stage reads this rather than re-deriving it.
  const stored = repo.findCompletedStage(pipeline.id, pipeline.version, 'topic_research')!;
  assert.equal((stored.output as research.TopicResearch).topic, output.topic);
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'RESEARCH_COMPLETE');
});

test('RESEARCH: a reply missing a required field fails the stage rather than being salvaged', async () => {
  const { pipeline } = makePipeline();
  reply = JSON.stringify({ topic: 'Something', research_summary: 'x' }); // no recommended_angle

  await assert.rejects(() => research.runTopicResearch(pipeline.id));
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'FAILED');
  assert.equal(repo.findCompletedStage(pipeline.id, pipeline.version, 'topic_research'), null);
});

/* ------------------------------------------------------ keyword & title */

const KEYWORD_REPLY = JSON.stringify({
  primary_keyword: 'monitor light bar',
  secondary_keywords: ['screen bar', 'monitor lamp'],
  long_tail_keywords: ['do monitor light bars reduce eye strain'],
  semantic_terms: ['contrast', 'ambient light'],
  entities: ['BenQ ScreenBar'],
  related_questions: ['Do they cause glare?'],
  search_intent: 'commercial',
  commercial_intent: 'high',
  title_candidates: ['Do Monitor Light Bars Actually Work?', 'Monitor Light Bars, Explained'],
  recommended_title: 'Do Monitor Light Bars Actually Reduce Eye Strain?',
  recommended_headings: ['What a light bar does', 'When it helps'],
  seo_notes: ['Avoid stuffing the primary keyword in every heading'],
  sources: [],
});

test('SEO: keyword research consumes the topic research and produces a title', async () => {
  const { pipeline } = makePipeline();
  reply = TOPIC_REPLY;
  const topic = (await research.runTopicResearch(pipeline.id)).output as research.TopicResearch;

  reply = KEYWORD_REPLY;
  const result = await research.runKeywordResearch(pipeline.id, topic);
  const output = result.output as research.KeywordResearch;

  assert.equal(output.primaryKeyword, 'monitor light bar');
  assert.equal(output.recommendedTitle, 'Do Monitor Light Bars Actually Reduce Eye Strain?');
  assert.deepEqual(output.entities, ['BenQ ScreenBar']);
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'SEO_COMPLETE');
});

/* ------------------------------------------------------- classification */

test('CLASSIFY: the type must come from the list — an invented one fails the stage', async () => {
  const { pipeline } = makePipeline();
  reply = TOPIC_REPLY;
  const topic = (await research.runTopicResearch(pipeline.id)).output as research.TopicResearch;
  reply = KEYWORD_REPLY;
  const keywords = (await research.runKeywordResearch(pipeline.id, topic)).output as research.KeywordResearch;

  reply = JSON.stringify({ article_type: 'thought-leadership-hot-take', confidence: 0.9 });
  await assert.rejects(
    () => research.runClassification(pipeline.id, topic, keywords),
    'a type outside the list must not be coerced into one',
  );
});

test('CLASSIFY -> TEMPLATE -> BRIEF: the type and template travel with the article', async () => {
  const { article, pipeline } = makePipeline();

  reply = TOPIC_REPLY;
  const topic = (await research.runTopicResearch(pipeline.id)).output as research.TopicResearch;
  reply = KEYWORD_REPLY;
  const keywords = (await research.runKeywordResearch(pipeline.id, topic)).output as research.KeywordResearch;

  reply = JSON.stringify({
    article_type: 'buying-guide',
    confidence: 0.82,
    primary_intent: 'commercial',
    secondary_intent: 'informational',
    reasoning_summary: 'The reader wants to choose one.',
  });
  const classification = (await research.runClassification(pipeline.id, topic, keywords))
    .output as research.ArticleClassification;
  assert.equal(classification.articleType, 'buying-guide');
  assert.equal(classification.confidence, 0.82);

  // Template selection costs nothing and calls nothing.
  const callsBefore = calls.length;
  const selection = brief.selectTemplate(pipeline.id, classification);
  assert.equal(calls.length, callsBefore, 'template selection must not call a model');
  assert.equal(selection.output.templateId, 'buying-guide-v1');
  assert.equal(selection.output.borrowed, false);

  // WordPress compatibility: the article itself carries the pair.
  const stored = dbModule
    .getDatabase()
    .prepare('SELECT article_type_slug, template_id, template_version FROM articles WHERE id = ?')
    .get(article.id) as any;
  assert.equal(stored.article_type_slug, 'buying-guide');
  assert.equal(stored.template_id, 'buying-guide-v1');
  assert.equal(stored.template_version, templates.getTemplate('buying-guide-v1')!.version);

  // The brief is assembled from what is already stored, with no model call.
  const briefCallsBefore = calls.length;
  const built = brief.buildBrief(pipeline.id, topic, keywords, classification, selection.output);
  assert.equal(calls.length, briefCallsBefore, 'brief assembly must not call a model');
  assert.equal(built.output.title, 'Do Monitor Light Bars Actually Reduce Eye Strain?');
  assert.equal(built.output.primaryKeyword, 'monitor light bar');
  assert.equal(built.output.articleType, 'buying-guide');
  assert.equal(built.output.author.name, 'Theo Lindqvist');
  assert.equal(built.output.template.templateId, 'buying-guide-v1');
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'BRIEF_READY');
});

test('BRIEF: with no captured sources, the brief says so rather than inviting citations', async () => {
  const { pipeline } = makePipeline();

  reply = JSON.stringify({ ...JSON.parse(TOPIC_REPLY), research_sources: [] });
  const topic = (await research.runTopicResearch(pipeline.id)).output as research.TopicResearch;
  reply = KEYWORD_REPLY;
  const keywords = (await research.runKeywordResearch(pipeline.id, topic)).output as research.KeywordResearch;
  reply = JSON.stringify({ article_type: 'explainer', confidence: 0.7, reasoning_summary: 'x' });
  const classification = (await research.runClassification(pipeline.id, topic, keywords))
    .output as research.ArticleClassification;

  const selection = brief.selectTemplate(pipeline.id, classification);
  assert.equal(selection.output.borrowed, true, 'explainer borrows the guide template');

  const built = brief.buildBrief(pipeline.id, topic, keywords, classification, selection.output);
  assert.match(built.output.evidenceRequirements, /do not manufacture citations/i);
});

test('OVERRIDE: a human type change is recorded as an override', () => {
  const { article, pipeline } = makePipeline();
  void pipeline;

  const result = brief.overrideArticleType(article.id, 'comparison');
  assert.ok('ok' in result);

  const stored = dbModule
    .getDatabase()
    .prepare('SELECT article_type_slug, template_id, article_type_override FROM articles WHERE id = ?')
    .get(article.id) as any;
  assert.equal(stored.article_type_slug, 'comparison');
  assert.equal(stored.template_id, 'comparison-v1');
  assert.equal(stored.article_type_override, 1, 'the override must be distinguishable from the classifier');
});

test.after(() => {
  globalThis.fetch = realFetch;
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
