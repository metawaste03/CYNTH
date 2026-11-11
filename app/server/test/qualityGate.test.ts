/**
 * QUALITY GATE and SEO STATUS (Milestone 15).
 *
 * NOTHING HERE CONTACTS A PROVIDER AND NOTHING HERE COSTS ANYTHING. The
 * Quality Gate is entirely deterministic, and the SEO status is derived from
 * results the SEO engine has already stored — so no test in this file needs a
 * model, a mock provider, or a credential.
 *
 * NOTHING HERE TOUCHES THE REAL DATABASE: CYNTH_DB_DIR points at a scratch
 * directory created and destroyed by this file.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* ------------------------------------------------------------------ setup */

const SCRATCH = path.join(os.tmpdir(), `cynth-quality-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;

const dbModule = await import('../src/shared/database/index.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const articles = await import('../src/features/articles/articles.repository.js');
const seoRepo = await import('../src/features/seo/seo.repository.js');
const analysis = await import('../src/features/seo/seoAnalysis.service.js');
const seoStatus = await import('../src/features/seo/seoStatus.service.js');
const gateService = await import('../src/features/quality-gate/qualityGate.service.js');
const gateRepo = await import('../src/features/quality-gate/qualityGate.repository.js');

dbModule.initializeDatabase();
const db = () => dbModule.getDatabase();

test.after(() => {
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

/* --------------------------------------------------------------- fixtures */

const project = content.getDefaultProject()!;

const theme = content.createTheme(project.id, { name: 'Hiking Gear', description: 'Gear guidance.' });
const topic = content.createTopic(theme.id, {
  title: 'Budget Backpacks',
  description: 'Affordable packs for multi-day hikes.',
  notes: null,
  scope: 'Packs under 100 USD.',
  keyAreas: 'Fit, capacity, durability.',
  considerations: 'Comfort over features.',
  exclusions: 'Ultralight racing packs.',
});
const author = authorsRepo.createAuthor({
  name: 'Test Author',
  shortBiography: 'A hiker.',
  expertise: 'Backpacking.',
  targetAudience: 'Weekend hikers.',
} as never);
content.setAuthorThemes(author.id, [theme.id]);

/**
 * A complete, well-formed article: headings, sections with content, a real
 * ending. Everything below varies ONE thing away from this, so a failing
 * check is unambiguously about the thing that changed.
 */
const GOOD_BODY = [
  '# Choosing a Budget Hiking Backpack',
  '',
  'A budget hiking backpack has to carry weight comfortably before it does anything else. This guide covers fit, capacity and durability for packs under one hundred dollars, and explains which compromises are worth making.',
  '',
  '## How torso length decides fit',
  '',
  'Measure from the seventh vertebra to the top of the hip bones. A pack sized to that measurement transfers load onto the hips, which is where it belongs. Getting this wrong makes an otherwise good pack unwearable.',
  '',
  'Most manufacturers publish a torso range for each size. Measure before buying rather than guessing from your height, because the two correlate loosely at best.',
  '',
  '## What capacity you actually need',
  '',
  'A day hike rarely needs more than thirty litres. Overnight trips start around forty five. Buying larger than you need adds weight you carry every step, and encourages packing things you will not use.',
  '',
  'Capacity is measured differently by different makers, so treat the number as a guide rather than a specification.',
  '',
  '## Where cheap packs cut corners',
  '',
  'Hip belts and shoulder straps are the first place cost is removed, and they are the parts that matter most under load. Zips and buckles are the second. Fabric weight is usually fine.',
  '',
  'Inspect the stitching where the shoulder straps meet the body of the pack. That join carries the most stress and fails first on a poorly made pack.',
  '',
  '## What to buy',
  '',
  'Fit first, capacity second, features last. A pack that fits properly at thirty five litres will serve better than a poorly fitting one with every feature listed on the label.',
  '',
  'Try the pack loaded. Most outdoor shops keep weighted bags for exactly this, and ten minutes walking around the shop with fifteen kilograms on your back tells you more than any specification sheet will.',
  '',
  '## Common mistakes',
  '',
  'Buying for the biggest trip you might one day take is the most expensive mistake, because you carry the extra fabric and frame on every trip you actually take. Buy for the trips you do now.',
  '',
  'Ignoring the hip belt is the second. On a loaded pack the belt carries most of the weight, and a thin unpadded belt makes an otherwise reasonable pack painful after an hour on the trail.',
  '',
  'Assuming a heavier pack is a sturdier one is the third. Weight in a budget pack usually comes from cheap fabric and unnecessary features rather than from durability where it actually counts.',
  '',
  '## Caring for a budget pack',
  '',
  'Empty it after every trip and let it dry properly. Damp storage destroys coatings faster than trail use does, and a pack stored wet will delaminate long before its fabric wears through.',
  '',
  'Wash it by hand with plain water. Detergents strip the durable water repellent finish, and a machine wash will damage the frame and the foam in the back panel beyond repair.',
  '',
  'Repair small tears early with adhesive fabric patches. A one centimetre tear becomes a ten centimetre one under load, and at that point the pack is finished for good.',
  '',
  'Try the pack loaded. Most outdoor shops keep weighted bags for exactly this, and ten minutes walking around the shop with fifteen kilograms on your back tells you more than any specification sheet will.',
  '',
  '## Common mistakes',
  '',
  'Buying for the biggest trip you might one day take is the most expensive mistake, because you carry the extra fabric and frame on every trip you actually take. Buy for the trips you do now.',
  '',
  'Ignoring the hip belt is the second. On a loaded pack the belt carries most of the weight, and a thin unpadded belt makes an otherwise reasonable pack painful after an hour on the trail.',
  '',
  'Assuming a heavier pack is a sturdier one is the third. Weight in a budget pack usually comes from cheap fabric and unnecessary features rather than from durability where it actually counts.',
  '',
  '## Caring for a budget pack',
  '',
  'Empty it after every trip and let it dry properly. Damp storage destroys coatings faster than trail use does, and a pack stored wet will delaminate long before its fabric wears through.',
  '',
  'Wash it by hand with plain water. Detergents strip the durable water repellent finish, and a machine wash will damage the frame and the foam in the back panel beyond repair.',
  '',
  'Repair small tears early with adhesive fabric patches. A one centimetre tear becomes a ten centimetre one under load, and at that point the pack is finished for good.',
].join('\n');

let articleCounter = 0;

interface ArticleOptions {
  title?: string | null;
  body?: string | null;
  articleTypeId?: number | null;
  authorId?: number | null;
  themeId?: number | null;
  topicId?: number | null;
  topic?: string | null;
  targetAudience?: string | null;
}

function makeArticle(options: ArticleOptions = {}) {
  articleCounter += 1;
  const title = options.title === undefined ? `Test Article ${articleCounter}` : options.title;

  const draft = articles.createArticleDraft({
    articleTypeId: options.articleTypeId === undefined ? 1 : options.articleTypeId,
    authorId: options.authorId === undefined ? author.id : options.authorId,
    productId: null,
    projectId: project.id,
    themeId: options.themeId === undefined ? theme.id : options.themeId,
    topicId: options.topicId === undefined ? topic.id : options.topicId,
    title,
    topic: options.topic === undefined ? 'Budget backpacks' : options.topic,
    targetAudience: options.targetAudience === undefined ? 'Weekend hikers' : options.targetAudience,
    searchIntent: 'Informational',
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: 'budget hiking backpack',
    secondaryKeywords: null,
  } as never);

  const body = options.body === undefined ? GOOD_BODY : options.body;
  if (body !== null) {
    articles.saveGeneratedArticle(draft.id, {
      title: title ?? 'Generated Title',
      content: body,
      provider: 'Test Provider',
      model: 'test-model',
    });
  }

  return articles.getArticleById(draft.id)!;
}

/** The outcome of one named check, so a test asserts about the check it means. */
function checkOutcome(decision: { groups: { checks: { key: string; outcome: string }[] }[] }, key: string) {
  const found = decision.groups.flatMap((group) => group.checks).find((check) => check.key === key);
  assert.ok(found, `expected a check named "${key}"`);
  return found!;
}

function checkDetail(decision: { groups: { checks: { key: string; detail: string }[] }[] }, key: string) {
  return decision.groups.flatMap((group) => group.checks).find((check) => check.key === key)!.detail;
}

/* ========================== the passing case ============================ */

test('QUALITY GATE: a complete article passes', () => {
  const article = makeArticle();
  const decision = gateService.evaluateQualityGate(article);

  assert.equal(decision.status, 'passed');
  assert.equal(decision.failedCount, 0);
  assert.equal(decision.warningCount, 0);
  assert.deepEqual(decision.blockingReasons, []);
  assert.ok(decision.passedCount > 10, 'a real gate runs a real number of checks');
});

test('QUALITY GATE: every check explains itself, passing or failing', () => {
  const decision = gateService.evaluateQualityGate(makeArticle());
  const all = decision.groups.flatMap((group) => group.checks);

  assert.ok(all.length > 0);
  for (const check of all) {
    assert.ok(check.label.length > 0, `${check.key} must have a label`);
    assert.ok(check.detail.length > 0, `${check.key} must say why it reached its outcome`);
  }
  assert.ok(
    decision.groups.length >= 3,
    'checks are grouped, so twenty rows do not arrive as one flat list',
  );
});

/* =========================== blocking failures ========================== */

test('QUALITY GATE: a missing title fails, and says so specifically', () => {
  const article = makeArticle({ title: '' });
  // saveGeneratedArticle stores its own title, so clear both to test the check.
  db().prepare('UPDATE articles SET title = NULL, generated_title = NULL WHERE id = ?').run(article.id);

  const decision = gateService.evaluateArticleById(article.id)!;

  assert.equal(decision.status, 'failed');
  assert.equal(checkOutcome(decision, 'title').outcome, 'failed');
  assert.match(checkDetail(decision, 'title'), /neither a working title nor a generated one/);
  assert.equal(checkOutcome(decision, 'content_present').outcome, 'passed', 'only the title is wrong');
});

test('QUALITY GATE: an ungenerated article fails, and does not pretend to check its body', () => {
  const decision = gateService.evaluateQualityGate(makeArticle({ body: null }));

  assert.equal(decision.status, 'failed');
  assert.equal(checkOutcome(decision, 'generated').outcome, 'failed');
  assert.equal(checkOutcome(decision, 'content_present').outcome, 'failed');
  assert.equal(
    checkOutcome(decision, 'structure').outcome,
    'not_applicable',
    'structure is reported as not applicable rather than silently passing',
  );
});

test('QUALITY GATE: empty content fails', () => {
  const article = makeArticle();
  db().prepare("UPDATE articles SET content = '   ' WHERE id = ?").run(article.id);

  const decision = gateService.evaluateArticleById(article.id)!;
  assert.equal(decision.status, 'failed');
  assert.equal(checkOutcome(decision, 'content_present').outcome, 'failed');
});

test('QUALITY GATE: a body cut off mid-sentence is blocking', () => {
  const truncated = `${GOOD_BODY.slice(0, GOOD_BODY.length - 120)} and the next thing to consider is how the load`;
  const decision = gateService.evaluateQualityGate(makeArticle({ body: truncated }));

  assert.equal(checkOutcome(decision, 'not_truncated').outcome, 'failed');
  assert.equal(decision.status, 'failed');
});

/**
 * The false positive that mattered: an article ending on an italicised
 * editor's note closes with `…publication.*`, whose final character is an
 * asterisk. A naive punctuation test reads that complete article as cut off.
 */
test('QUALITY GATE: an article ending in Markdown emphasis is NOT reported as cut off', () => {
  const body = `${GOOD_BODY}\n\n*Editor's note: prices were checked in March.*`;
  const decision = gateService.evaluateQualityGate(makeArticle({ body }));

  assert.equal(checkOutcome(decision, 'not_truncated').outcome, 'passed');
});

test('QUALITY GATE: an article ending on a heading or a list is NOT reported as cut off', () => {
  const endsOnHeading = gateService.evaluateQualityGate(makeArticle({ body: `${GOOD_BODY}\n\n## What comes next` }));
  assert.equal(checkOutcome(endsOnHeading, 'not_truncated').outcome, 'passed');

  const endsOnList = gateService.evaluateQualityGate(
    makeArticle({ body: `${GOOD_BODY}\n\n- Fit first\n- Capacity second` }),
  );
  assert.equal(checkOutcome(endsOnList, 'not_truncated').outcome, 'passed');
});

test('QUALITY GATE: unfilled placeholders are blocking, and are named', () => {
  const body = GOOD_BODY.replace('## What to buy', '## [Best Overall Pick]\n\n[To be completed]\n\n## What to buy');
  const decision = gateService.evaluateQualityGate(makeArticle({ body }));

  assert.equal(checkOutcome(decision, 'no_placeholders').outcome, 'failed');
  assert.match(checkDetail(decision, 'no_placeholders'), /\[To be completed\]|\[Best Overall Pick\]/);
  assert.match(checkDetail(decision, 'no_placeholders'), /publish them verbatim/);
  assert.equal(decision.status, 'failed');
});

test('QUALITY GATE: a placed product card is not an unfilled placeholder', () => {
  // The defect: `[[product:14]]` contains `[product:14]`, which the bracket
  // pattern read as an unfilled placeholder. The gate then BLOCKED the article
  // for placing the products it was asked to place — and the more products it
  // placed, the worse it scored.
  const body = `${GOOD_BODY}

[[product:14]]

And for smaller homes:

[[product:15]]`;
  const decision = gateService.evaluateQualityGate(makeArticle({ body }));

  assert.equal(checkOutcome(decision, 'no_placeholders').outcome, 'passed');
  assert.doesNotMatch(checkDetail(decision, 'no_placeholders'), /product:/);
});

test('QUALITY GATE: a real placeholder beside a product card is still caught', () => {
  // Removing markers must not blind the check to what it is actually for.
  const body = `${GOOD_BODY}

[[product:14]]

[To be completed]`;
  const decision = gateService.evaluateQualityGate(makeArticle({ body }));

  assert.equal(checkOutcome(decision, 'no_placeholders').outcome, 'failed');
  assert.match(checkDetail(decision, 'no_placeholders'), /\[To be completed\]/);
  assert.doesNotMatch(checkDetail(decision, 'no_placeholders'), /product:/, 'and the card is not named alongside it');
});

/** Markdown links are bracketed too. Flagging every link would make the check useless. */
test('QUALITY GATE: Markdown links and images are not mistaken for placeholders', () => {
  const body = `${GOOD_BODY}\n\nSee [our fit guide](https://example.org/fit) and ![a pack](https://example.org/p.jpg).`;
  const decision = gateService.evaluateQualityGate(makeArticle({ body }));

  assert.equal(checkOutcome(decision, 'no_placeholders').outcome, 'passed');
});

test('QUALITY GATE: a refusal or disclaimer instead of an article is blocking', () => {
  const refusal = gateService.evaluateQualityGate(
    makeArticle({ body: "I'm sorry, but I cannot write that article for you." }),
  );
  assert.equal(checkOutcome(refusal, 'no_generation_failure').outcome, 'failed');
  assert.match(checkDetail(refusal, 'no_generation_failure'), /refusal/);

  const disclaimer = gateService.evaluateQualityGate(
    makeArticle({ body: `As an AI language model, I should note the following.\n\n${GOOD_BODY}` }),
  );
  assert.equal(checkOutcome(disclaimer, 'no_generation_failure').outcome, 'failed');
});

/**
 * The same words mid-article are almost certainly the article discussing
 * them. Matching anywhere would make this check unusable on any piece about
 * AI or about writing.
 */
test('QUALITY GATE: failure phrases inside the body are not a failure', () => {
  const body = GOOD_BODY.replace(
    'Fit first, capacity second, features last.',
    'Fit first, capacity second, features last. If a shop assistant says "I cannot help with that", go elsewhere.',
  );
  const decision = gateService.evaluateQualityGate(makeArticle({ body }));

  assert.equal(checkOutcome(decision, 'no_generation_failure').outcome, 'passed');
});

/* ==================== editorial configuration =========================== */

test('QUALITY GATE: missing editorial configuration is reported per field', () => {
  const decision = gateService.evaluateQualityGate(
    makeArticle({ articleTypeId: null, authorId: null, topic: null, topicId: null }),
  );

  assert.equal(decision.status, 'failed');
  assert.equal(checkOutcome(decision, 'article_type').outcome, 'failed');
  assert.equal(checkOutcome(decision, 'author').outcome, 'failed');
  assert.equal(checkOutcome(decision, 'topic').outcome, 'failed');
  assert.equal(decision.blockingReasons.length >= 3, true, 'each missing field is its own reason');
});

/**
 * The content architecture is optional, so an article outside it is a warning
 * rather than a blocker. Getting this severity wrong in either direction
 * produces a gate that blocks real work or waves through empty pages.
 */
test('QUALITY GATE: a missing thematic area warns, and does not fail the article', () => {
  const decision = gateService.evaluateQualityGate(makeArticle({ themeId: null }));

  assert.equal(checkOutcome(decision, 'theme').outcome, 'failed');
  assert.equal(decision.status, 'passed_with_warnings', 'a warning never makes an article Failed');
  assert.equal(decision.failedCount, 0);
  assert.equal(decision.warningCount, 1);
});

test('QUALITY GATE: a short body warns rather than failing', () => {
  const decision = gateService.evaluateQualityGate({
    ...makeArticle({ body: '# A Title\n\nOne short paragraph, and then nothing else at all follows it here.' }),
  });

  assert.equal(checkOutcome(decision, 'content_substantial').outcome, 'failed');
  assert.equal(decision.failedCount, 0, 'length is never blocking — Cynth has no opinion about article length');
});

test('QUALITY GATE: a heading with nothing under it is reported by name', () => {
  const body = `${GOOD_BODY}\n\n## The section that never got written\n`;
  const decision = gateService.evaluateQualityGate(makeArticle({ body }));

  assert.equal(checkOutcome(decision, 'no_empty_sections').outcome, 'failed');
  assert.match(checkDetail(decision, 'no_empty_sections'), /never got written/);
});

/* ============================ persistence =============================== */

test('QUALITY GATE: an article that has never been evaluated reads as Not Evaluated', () => {
  const article = makeArticle();
  const stored = gateRepo.getStoredDecision(article.id);

  assert.equal(stored.status, 'not_evaluated');
  assert.equal(stored.evaluatedAt, null);
  assert.deepEqual(stored.groups, [], 'no result is invented to fill the screen');
});

test('QUALITY GATE: evaluating stores the result, and re-evaluating replaces it', () => {
  const article = makeArticle();

  const first = gateRepo.evaluateAndStore(article.id)!;
  assert.equal(first.status, 'passed');
  assert.ok(first.evaluatedAt, 'the evaluation is timestamped');
  assert.ok(first.groups.length > 0, 'the per-check detail survives the round trip');

  const rowCount = db()
    .prepare('SELECT COUNT(*) AS n FROM article_quality_gate WHERE article_id = ?')
    .get(article.id) as { n: number };
  gateRepo.evaluateAndStore(article.id);
  const after = db()
    .prepare('SELECT COUNT(*) AS n FROM article_quality_gate WHERE article_id = ?')
    .get(article.id) as { n: number };

  assert.equal(rowCount.n, 1);
  assert.equal(after.n, 1, 're-evaluating updates one row rather than accumulating history');
});

/**
 * A stored result that predates an edit is reported as stale rather than
 * silently re-run. An automatic refresh would hide that the answer changed.
 */
test('QUALITY GATE: a result that predates an edit is reported as stale', () => {
  const article = makeArticle();
  gateRepo.evaluateAndStore(article.id);
  assert.equal(gateRepo.getStoredDecision(article.id).isCurrent, true);

  articles.saveGeneratedArticle(article.id, {
    title: 'Rewritten',
    content: `${GOOD_BODY}\n\nAn additional closing paragraph that changes the article.`,
    provider: 'Test Provider',
    model: 'test-model',
  });

  const stored = gateRepo.getStoredDecision(article.id);
  assert.equal(stored.isCurrent, false, 'the stored verdict no longer describes this article');
  assert.equal(stored.status, 'passed', 'and it is NOT silently recomputed behind the reader');
});

test('QUALITY GATE: the gate writes nothing to the articles table', () => {
  const article = makeArticle();
  const before = db().prepare('SELECT * FROM articles WHERE id = ?').get(article.id);

  gateRepo.evaluateAndStore(article.id);
  gateService.evaluateArticleById(article.id);

  const after = db().prepare('SELECT * FROM articles WHERE id = ?').get(article.id);
  assert.deepEqual(after, before, 'the gate observes an article; it never edits one');
});

test('QUALITY GATE: list summaries omit articles that have never been evaluated', () => {
  const evaluated = makeArticle();
  const untouched = makeArticle();
  gateRepo.evaluateAndStore(evaluated.id);

  const summaries = gateRepo.summariesFor([evaluated.id, untouched.id]);
  assert.ok(summaries.has(evaluated.id));
  assert.ok(
    !summaries.has(untouched.id),
    'absent means Not Evaluated — a status is never invented to fill a column',
  );
});

/* ============================= SEO status =============================== */

test('SEO STATUS: an article that has never been analysed is Not Evaluated', () => {
  const article = makeArticle();
  const status = seoStatus.getSeoStatus(article);

  assert.equal(status.status, 'not_evaluated');
  assert.equal(status.score, null, 'no score is null, never zero');
  assert.equal(status.analysedAt, null);
  assert.match(status.detail, /never been analysed/);
});

test('SEO STATUS: a deterministic analysis produces a real status and a real score', async () => {
  const article = makeArticle();
  seoRepo.saveSeoConfiguration(article.id, {
    targetQuery: 'budget hiking backpack',
    searchIntent: 'informational',
    secondaryIntents: [],
    secondaryKeywords: ['torso length'],
    semanticTopics: [],
    targetAudience: 'Weekend hikers',
    geoTarget: null,
    seoObjectives: null,
    notes: null,
  } as never);
  seoRepo.saveSeoMetadata(article.id, {
    seoTitle: 'Choosing a Budget Hiking Backpack: Fit, Capacity and Durability',
    metaDescription:
      'How to choose a budget hiking backpack: measure torso length, pick the right capacity, and know where cheap packs cut corners.',
    seoSlug: 'choosing-a-budget-hiking-backpack',
    canonicalUrl: null,
    structuredDataTypes: [],
  } as never);

  await analysis.runSeoAnalysis(article.id, { includeAi: false, confirmedCost: false, force: false, modelId: null });

  const status = seoStatus.getSeoStatus(articles.getArticleById(article.id)!);
  assert.ok(['passed', 'needs_attention'].includes(status.status), 'a real analysis produces a real verdict');
  assert.ok(typeof status.score === 'number', 'and a real score');
  assert.ok(status.analysedAt, 'timestamped');
  assert.equal(status.aiAnalysisRan, false, 'the deterministic pass is honest about being deterministic');
  assert.equal(status.isCurrent, true);
});

test('SEO STATUS: editing the article after analysis moves it to In Progress', async () => {
  const article = makeArticle();
  await analysis.runSeoAnalysis(article.id, { includeAi: false, confirmedCost: false, force: false, modelId: null });
  assert.equal(seoStatus.getSeoStatus(articles.getArticleById(article.id)!).isCurrent, true);

  articles.saveGeneratedArticle(article.id, {
    title: 'Rewritten Again',
    content: `${GOOD_BODY}\n\nA new closing section that the stored analysis never saw.`,
    provider: 'Test Provider',
    model: 'test-model',
  });

  const status = seoStatus.getSeoStatus(articles.getArticleById(article.id)!);
  assert.equal(status.status, 'in_progress');
  assert.equal(status.isCurrent, false);
  assert.match(status.detail, /edited since/);
});

test('SEO STATUS: a failed analysis run reads as Failed, not as Not Evaluated', () => {
  const article = makeArticle();
  const runId = seoRepo.recordAnalysisRun({
    articleId: article.id,
    mode: 'ai',
    status: 'failure',
    provider: 'Test Provider',
    providerType: 'openai',
    model: 'test-model',
    costClass: 'free',
    generationMode: 'test',
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    durationMs: 10,
    errorCode: 'provider_error',
    errorMessage: 'The provider refused the request.',
    score: null,
    scoreBreakdown: null,
    contentFingerprint: null,
    configFingerprint: null,
  } as never);
  assert.ok(runId > 0);

  const status = seoStatus.getSeoStatus(articles.getArticleById(article.id)!);
  assert.equal(status.status, 'failed');
  assert.match(status.detail, /refused the request/);
});

/**
 * 'partial' means the deterministic pass succeeded and the AI pass did not.
 * Reporting that as a completed analysis would overstate what was checked.
 */
test('SEO STATUS: a partial run reads as In Progress, not as Passed', () => {
  const article = makeArticle();
  seoRepo.recordAnalysisRun({
    articleId: article.id,
    mode: 'combined',
    status: 'partial',
    provider: 'Test Provider',
    providerType: 'openai',
    model: 'test-model',
    costClass: 'free',
    generationMode: 'test',
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    durationMs: 10,
    errorCode: null,
    errorMessage: null,
    score: 80,
    scoreBreakdown: null,
    contentFingerprint: null,
    configFingerprint: null,
  } as never);

  const status = seoStatus.getSeoStatus(articles.getArticleById(article.id)!);
  assert.equal(status.status, 'in_progress');
  assert.match(status.detail, /AI pass did not/);
});

test('SEO STATUS: reading the status runs no analysis and writes nothing', async () => {
  const article = makeArticle();
  await analysis.runSeoAnalysis(article.id, { includeAi: false, confirmedCost: false, force: false, modelId: null });

  const runsBefore = db()
    .prepare('SELECT COUNT(*) AS n FROM seo_analysis_runs WHERE article_id = ?')
    .get(article.id) as { n: number };
  const seoBefore = db().prepare('SELECT * FROM article_seo WHERE article_id = ?').get(article.id);

  for (let i = 0; i < 5; i += 1) seoStatus.getSeoStatus(articles.getArticleById(article.id)!);

  const runsAfter = db()
    .prepare('SELECT COUNT(*) AS n FROM seo_analysis_runs WHERE article_id = ?')
    .get(article.id) as { n: number };
  assert.equal(runsAfter.n, runsBefore.n, 'reading a status must never trigger a chargeable analysis');
  assert.deepEqual(db().prepare('SELECT * FROM article_seo WHERE article_id = ?').get(article.id), seoBefore);
});

/* =================== quality and SEO are separate ======================= */

/**
 * THE STATE THE MILESTONE EXISTS TO MAKE POSSIBLE.
 *
 *     Quality: Passed     SEO: Needs Attention
 *
 * and its mirror image. Quality asks whether this is a finished article; SEO
 * asks whether it will perform in search. Conflating them into one verdict
 * would hide exactly the case a person needs to act on.
 */
test('READINESS: an article can pass Quality and still not be SEO ready', async () => {
  const article = makeArticle();

  const quality = gateRepo.evaluateAndStore(article.id)!;
  assert.equal(quality.status, 'passed');

  // No SEO analysis has been run, so the SEO answer is different from the
  // quality answer for the same article at the same moment.
  const seo = seoStatus.getSeoStatus(articles.getArticleById(article.id)!);
  assert.equal(seo.status, 'not_evaluated');
  assert.notEqual(quality.status, seo.status, 'two questions, two independent answers');
});

test('READINESS: an article can fail Quality while its SEO analysis passes', async () => {
  const body = GOOD_BODY.replace('## What to buy', '## [Best Overall Pick]\n\n[To be completed]\n\n## What to buy');
  const article = makeArticle({ body });

  await analysis.runSeoAnalysis(article.id, { includeAi: false, confirmedCost: false, force: false, modelId: null });

  const quality = gateRepo.evaluateAndStore(article.id)!;
  const seo = seoStatus.getSeoStatus(articles.getArticleById(article.id)!);

  assert.equal(quality.status, 'failed', 'the placeholders make it unfit to review');
  assert.ok(
    seo.status !== 'failed',
    'while the SEO engine, which asks a different question, has its own answer',
  );
});

test('READINESS: the Quality Gate reaches no conclusion about SEO, and vice versa', () => {
  const article = makeArticle();
  const decision = gateService.evaluateQualityGate(article);
  const keys = decision.groups.flatMap((group) => group.checks).map((check) => check.key);

  assert.ok(
    !keys.some((key) => /seo|meta_description|keyword|canonical/i.test(key)),
    'no SEO concern leaks into the Quality Gate',
  );
});
