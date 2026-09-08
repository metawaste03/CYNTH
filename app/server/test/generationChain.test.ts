/**
 * Write -> review -> one revision -> validation (Milestone 22).
 *
 * The whole point of this chain is that it TERMINATES. What must hold:
 *   1. A passing review triggers no revision.
 *   2. A failing review triggers exactly ONE revision, and a second is
 *      impossible — including when a caller asks for it directly.
 *   3. No second review ever happens; deterministic validation replaces it.
 *   4. Validation reaches READY or NEEDS_EDITORIAL_ATTENTION, and both are
 *      terminal.
 *   5. The media matcher ranks by theme and description, and explains itself.
 *
 * NO REAL PROVIDER IS CONTACTED.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-chain-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');

const dbModule = await import('../src/shared/database/index.js');
const secrets = await import('../src/shared/secrets/secretStore.js');
const repo = await import('../src/features/pipeline/pipeline.repository.js');
const roles = await import('../src/features/pipeline/roleRegistry.repository.js');
const gen = await import('../src/features/pipeline/stages/generationStages.service.js');
const validation = await import('../src/features/pipeline/stages/validation.service.js');
const media = await import('../src/features/media/media.repository.js');
const suggest = await import('../src/features/media/mediaSuggest.service.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const articles = await import('../src/features/articles/articles.repository.js');
const settings = await import('../src/shared/settings/settings.repository.js');
const templates = await import('../src/features/templates/templates.repository.js');
const length = await import('../src/features/templates/articleLength.service.js');

dbModule.initializeDatabase();

const project = content.getDefaultProject()!;
const theme = content.createTheme(project.id, { name: 'Workspace', description: 'Desks and light.' });
const otherTheme = content.createTheme(project.id, { name: 'Pet Care', description: 'Animals.' });
const author = authorsRepo.createAuthor({ name: 'Theo' });

let reply = '{}';
/** Every prompt actually sent, so a test can assert on what the model was told. */
const prompts: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  prompts.push(String(body?.messages?.[0]?.content ?? ''));

  return new Response(
    JSON.stringify({
      choices: [{ message: { content: reply } }],
      usage: { prompt_tokens: 900, completion_tokens: 1200, total_tokens: 2100 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}) as typeof fetch;

secrets.setSecret('CYNTH_CHAIN_KEY', 'not-a-real-credential');
const db = dbModule.getDatabase();
const providerId = Number(
  db
    .prepare(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
       VALUES ('Stub', 'openrouter', 'https://stub.test/api/v1', 'CYNTH_CHAIN_KEY', 1)`,
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
for (const role of ['article_writer', 'article_reviewer', 'article_revision'] as const) {
  roles.setRoleAssignment(role, 'development', { primaryModelId: modelId, fallbackModelId: null });
}
settings.setSetting('generation.mode', 'test');

const BRIEF = {
  theme: 'Workspace',
  themeGuidance: '',
  topic: 'Monitor light bars',
  topicResearch: {} as never,
  audience: 'Desk workers',
  author: { name: 'Theo', personaSummary: '', skillNames: [] },
  primaryKeyword: 'monitor light bar',
  secondaryKeywords: [],
  entities: [],
  searchIntent: 'commercial',
  commercialIntent: 'high',
  articleType: 'how-to',
  articleTypeConfidence: 0.9,
  recommendedAngle: 'Mechanism first',
  contentGap: 'No mechanism explained',
  title: 'How To Set Up A Monitor Light Bar',
  recommendedHeadings: [],
  evidenceRequirements: 'x',
  affiliateOpportunities: '',
  template: {
    templateId: 'how-to-v1',
    // The seeded version, not a literal: publishing a new template version
    // must not silently detach this fixture from the registry.
    templateVersion: templates.getTemplate('how-to-v1')!.version,
    name: 'How-To',
    articleTypeSlug: 'how-to',
    borrowed: false,
    sectionKeys: ['hero', 'introduction', 'what_you_need', 'steps', 'faq', 'conclusion'],
  },
  editorialRules: '',
};

/** A complete article satisfying how-to-v1's required sections. */
function article(overrides: Partial<gen.GeneratedArticle> = {}): string {
  return JSON.stringify({
    title: 'How To Set Up A Monitor Light Bar',
    excerpt: 'A short guide.',
    sections: [
      { key: 'hero', heading: 'Hero', body: 'A monitor light bar fixes a specific problem.' },
      { key: 'introduction', heading: 'Introduction', body: 'A monitor light bar reduces contrast between screen and room. '.repeat(12) },
      { key: 'what_you_need', heading: "What you'll need", body: 'A monitor light bar and a free USB port.' },
      { key: 'steps', heading: 'Steps', body: 'Clip it on. Angle it down. Set the brightness to match the room. '.repeat(20) },
      { key: 'conclusion', heading: 'Conclusion', body: 'You should now have even light across the desk.' },
    ],
    faq: [{ question: 'Do they cause glare?', answer: 'Not if angled away from the screen.' }],
    sources: [],
    ...overrides,
  });
}

function makePipeline() {
  const draft = articles.createArticleDraft({
    articleTypeId: 1,
    authorId: author.id,
    productId: null,
    projectId: project.id,
    themeId: theme.id,
    topicId: null,
    title: 'Working title',
    topic: 'Monitor light bars',
    targetAudience: null,
    searchIntent: null,
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: 'monitor light bar',
    secondaryKeywords: null,
  } as never);

  const pipeline = repo.startPipeline({ articleId: draft.id, mode: 'development', themeId: theme.id });
  db.prepare('UPDATE articles SET article_type_slug = ?, template_id = ?, template_version = ? WHERE id = ?').run(
    'how-to',
    'how-to-v1',
    templates.getTemplate('how-to-v1')!.version,
    draft.id,
  );
  return { draft, pipeline };
}

/* ------------------------------------------------------------ generation */

test('WRITE: the article is stored structured AND as markdown', async () => {
  const { draft, pipeline } = makePipeline();
  reply = article();

  const result = await gen.runArticleGeneration(pipeline.id, BRIEF as never);
  const written = result.output as gen.GeneratedArticle;
  assert.equal(written.sections.length, 5);

  const row = db.prepare('SELECT content, structured_content, generated_title FROM articles WHERE id = ?').get(draft.id) as any;
  assert.ok(row.structured_content, 'structured content is stored for validation and WordPress');
  assert.match(row.content, /## Steps/, 'markdown is stored for the CMS push and SEO engine');
  assert.equal(row.generated_title, 'How To Set Up A Monitor Light Bar');
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'GENERATED');
});

test('WRITE: the writer is given a length BAND, not just a floor', async () => {
  // Given only a minimum, a model has one direction to push in, and every
  // article came out long. The ceiling is what makes this publication
  // short-form, so it has to reach the model that writes.
  const { pipeline } = makePipeline();
  reply = article();
  prompts.length = 0;

  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  const writerPrompt = prompts[prompts.length - 1];
  const band = length.lengthBandFor(templates.getTemplate('how-to-v1')!.contentSchema);
  assert.match(writerPrompt, new RegExp(`between ${band.minWords} and ${band.maxWords} words`));
  assert.match(writerPrompt, /hard ceiling/i);
  assert.ok(band.maxWords <= 1500, 'and the ceiling honours the house maximum');
});

/* ---------------------------------------------------------------- review */

const PASSING_REVIEW = JSON.stringify({
  revision_required: false,
  overall_score: 0.86,
  summary: 'Clear, accurate and correctly structured.',
  strengths: ['Explains the mechanism before recommending'],
  product_assessment: 'No products in this article.',
  issues: [],
  preserve_sections: [],
});

const FAILING_REVIEW = JSON.stringify({
  revision_required: true,
  overall_score: 0.52,
  summary: 'One unsupported claim.',
  strengths: ['Good structure'],
  product_assessment: 'No products.',
  issues: [
    {
      severity: 'major',
      section: 'introduction',
      problem: 'Claims a 40% reduction in eye strain with no source.',
      required_change: 'Remove the figure, or attribute it.',
      scope: 'passage',
      passage: 'reduces contrast between screen and room',
    },
  ],
  preserve_sections: ['steps', 'conclusion'],
});

test('REVIEW: a passing review triggers no revision', async () => {
  const { pipeline } = makePipeline();
  reply = article();
  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  reply = PASSING_REVIEW;
  const result = await gen.runArticleReview(pipeline.id, BRIEF as never, JSON.parse(article()));
  const review = result.output as gen.ArticleReview;

  assert.equal(review.revisionRequired, false);
  assert.equal(review.overallScore, 0.86);
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'REVIEW_COMPLETE');
  assert.equal(repo.getPipelineById(pipeline.id)!.revisionCount, 0);
});

test('REVIEW: a reviewer asking for a revision without specifying one is not trusted', async () => {
  const { pipeline } = makePipeline();
  reply = article();
  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  // revision_required true, but no actionable issues — the one revision must
  // not be spent on nothing.
  reply = JSON.stringify({ revision_required: true, overall_score: 0.4, summary: 'Not great.', issues: [] });
  const result = await gen.runArticleReview(pipeline.id, BRIEF as never, JSON.parse(article()));
  assert.equal((result.output as gen.ArticleReview).revisionRequired, false);
});

test('REVIEW: an issue with no required change is dropped as unactionable', async () => {
  const { pipeline } = makePipeline();
  reply = article();
  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  reply = JSON.stringify({
    revision_required: true,
    overall_score: 0.5,
    summary: 'Vague.',
    issues: [
      { severity: 'major', section: 'steps', problem: 'Could be better', required_change: '' },
      { severity: 'minor', section: 'introduction', problem: 'Wordy', required_change: 'Cut the second paragraph.' },
    ],
  });
  const review = (await gen.runArticleReview(pipeline.id, BRIEF as never, JSON.parse(article())))
    .output as gen.ArticleReview;

  assert.equal(review.issues.length, 1, 'only the actionable issue survives');
  assert.equal(review.issues[0].requiredChange, 'Cut the second paragraph.');
});

/* --------------------------------------------------------- the hard cap */

test('CAP: exactly one revision runs, and a second is impossible even when asked for directly', async () => {
  const { pipeline } = makePipeline();
  reply = article();
  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  reply = FAILING_REVIEW;
  const review = (await gen.runArticleReview(pipeline.id, BRIEF as never, JSON.parse(article())))
    .output as gen.ArticleReview;
  assert.equal(review.revisionRequired, true);
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'REVISION_REQUIRED');

  // The one permitted revision.
  reply = article({ sections: JSON.parse(article()).sections });
  await gen.runArticleRevision(pipeline.id, JSON.parse(article()), review);

  const after = repo.getPipelineById(pipeline.id)!;
  assert.equal(after.revisionCount, 1);
  assert.equal(after.state, 'FINAL_VALIDATION');

  // A second revision, asked for explicitly. There is no rerun escape here.
  await assert.rejects(
    () => gen.runArticleRevision(pipeline.id, JSON.parse(article()), review),
    (error: any) => /already been used/i.test(error.message),
    'a second automatic revision must be impossible',
  );
  assert.equal(repo.getPipelineById(pipeline.id)!.revisionCount, 1, 'the count did not increase');
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'NEEDS_EDITORIAL_ATTENTION');
});

test('CAP: no second review is possible after the first', async () => {
  const { pipeline } = makePipeline();
  reply = article();
  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  reply = PASSING_REVIEW;
  await gen.runArticleReview(pipeline.id, BRIEF as never, JSON.parse(article()));
  assert.equal(repo.getPipelineById(pipeline.id)!.reviewCount, 1);

  assert.equal(repo.canReview(pipeline.id).allowed, false);
  assert.match(repo.canReview(pipeline.id).reason, /deterministic validation/i);
});

/* ------------------------------------------------------------ validation */

test('VALIDATION: a complete article reaches READY', async () => {
  const { pipeline } = makePipeline();
  reply = article();
  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  const result = validation.runFinalValidation(pipeline.id)!;
  assert.equal(result.output.passed, true, JSON.stringify(result.output.findings));
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'READY');
  assert.ok(result.output.checked.includes('required sections'));
  assert.ok(result.output.checked.includes('product references'));
});

test('VALIDATION: a missing required section blocks and hands over to a person', async () => {
  const { pipeline } = makePipeline();
  const parsed = JSON.parse(article());
  parsed.sections = parsed.sections.filter((s: any) => s.key !== 'steps');
  reply = JSON.stringify(parsed);
  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  const result = validation.runFinalValidation(pipeline.id)!;
  assert.equal(result.output.passed, false);
  assert.ok(result.output.findings.some((f) => f.severity === 'blocking' && /Steps/.test(f.detail)));
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'NEEDS_EDITORIAL_ATTENTION');
});

test('VALIDATION: placeholders, bad links and unattached products all block', async () => {
  const { pipeline } = makePipeline();
  const parsed = JSON.parse(article());
  parsed.sections[1].body = 'Costs about [INSERT PRICE] and see [the study](javascript:alert(1)).';
  parsed.sections[3].body += '\n\n[[product:9999]]\n';
  reply = JSON.stringify(parsed);
  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  const result = validation.runFinalValidation(pipeline.id)!;
  assert.equal(result.output.passed, false);

  const details = result.output.findings.map((f) => f.detail).join(' | ');
  assert.match(details, /placeholder text/i);
  assert.match(details, /not a usable link target/i);
  assert.match(details, /product 9999/i);
});

test('VALIDATION: a missing FAQ blocks when the template requires one', async () => {
  const { pipeline } = makePipeline();
  reply = article({ faq: [] });
  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  const result = validation.runFinalValidation(pipeline.id)!;
  assert.equal(result.output.passed, false);
  assert.ok(result.output.findings.some((f) => /requires an FAQ/i.test(f.detail)));
});

test('VALIDATION: warnings alone do not block', async () => {
  const { pipeline } = makePipeline();
  // No excerpt is a warning; everything required is present.
  reply = article({ excerpt: '' });
  await gen.runArticleGeneration(pipeline.id, BRIEF as never);

  const result = validation.runFinalValidation(pipeline.id)!;
  assert.equal(result.output.passed, true);
  assert.ok(result.output.findings.some((f) => f.severity === 'warning' && /excerpt/i.test(f.detail)));
  assert.equal(repo.getPipelineById(pipeline.id)!.state, 'READY');
});

/* --------------------------------------------------------- media matching */

test('MEDIA: the theme filter is what makes a large library tractable', () => {
  media.createMedia({ filePath: 'uploads/media/a.jpg', title: 'Desk with light bar', description: 'A monitor light bar above a desk', themeId: theme.id, kind: 'featured', tags: 'desk, lighting' });
  media.createMedia({ filePath: 'uploads/media/b.jpg', title: 'Tidy workspace', description: 'A clean desk setup', themeId: theme.id, kind: 'featured', tags: 'desk' });
  media.createMedia({ filePath: 'uploads/media/c.jpg', title: 'Cat with feeder', description: 'A cat eating', themeId: otherTheme.id, kind: 'featured', tags: 'pet' });
  media.createMedia({ filePath: 'uploads/media/d.jpg', title: 'Unfiled photo', description: null, themeId: null, kind: 'featured', tags: null });

  const { draft } = makePipeline();
  const result = suggest.suggestMedia(draft.id)!;

  const titles = result.suggestions.map((s) => s.asset.title);
  assert.ok(!titles.includes('Cat with feeder'), 'another area must never be considered');
  assert.equal(result.suggestions[0].asset.title, 'Desk with light bar', 'the description match ranks first');
  assert.ok(result.suggestions[0].reasons.some((r) => /Filed under Workspace/.test(r)));
  assert.ok(result.suggestions[0].reasons.some((r) => /Matches:/.test(r)));
});

test('MEDIA: an image with no description says why it can only match on its area', () => {
  const { draft } = makePipeline();
  const result = suggest.suggestMedia(draft.id)!;

  const unfiled = result.suggestions.find((s) => s.asset.title === 'Unfiled photo');
  assert.ok(unfiled, 'an unfiled image is still offered rather than hidden forever');
  assert.ok(unfiled!.reasons.some((r) => /matched on its area alone/i.test(r)));
});

test('MEDIA: nothing is attached automatically — suggesting and attaching are separate', () => {
  const { draft } = makePipeline();
  suggest.suggestMedia(draft.id);
  assert.equal(media.listArticleMedia(draft.id).length, 0, 'suggesting must attach nothing');

  const asset = media.listMedia({ themeId: theme.id })[0];
  const attached = media.attachMedia({ articleId: draft.id, mediaId: asset.id, role: 'featured', origin: 'suggested' });
  assert.ok(!('error' in attached));
  assert.equal(media.getFeaturedImage(draft.id)!.id, asset.id);
  assert.equal(media.listArticleMedia(draft.id)[0].origin, 'suggested', 'an accepted suggestion stays distinguishable');
});

test('MEDIA: an article has at most one featured image', () => {
  const { draft } = makePipeline();
  const assets = media.listMedia({ themeId: theme.id });

  media.attachMedia({ articleId: draft.id, mediaId: assets[0].id, role: 'featured' });
  media.attachMedia({ articleId: draft.id, mediaId: assets[1].id, role: 'featured' });

  const featured = media.listArticleMedia(draft.id).filter((entry) => entry.role === 'featured');
  assert.equal(featured.length, 1, 'the second replaces the first rather than adding a hidden duplicate');
  assert.equal(featured[0].mediaId, assets[1].id);
});

test.after(() => {
  globalThis.fetch = realFetch;
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
