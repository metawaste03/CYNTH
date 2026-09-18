/**
 * SEO Engine tests (Milestone 14).
 *
 * NO REAL AI PROVIDER IS EVER CONTACTED and NO MONEY IS EVER SPENT: the
 * provider is a local mock on 127.0.0.1, the API key is a literal test
 * string, and the mock model is priced at zero so the cost gate treats it as
 * free. The tests that exercise paid behaviour do so by editing the stored
 * price, never by calling anything real.
 *
 * NOTHING HERE TOUCHES THE REAL DATABASE: CYNTH_DB_DIR points at a scratch
 * directory created and destroyed by this file.
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

const SCRATCH = path.join(os.tmpdir(), `cynth-seo-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;

const KEY_VAR = 'CYNTH_SEO_TEST_KEY';
process.env[KEY_VAR] = 'test-key-not-a-real-credential';

const dbModule = await import('../src/shared/database/index.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const articles = await import('../src/features/articles/articles.repository.js');
const policy = await import('../src/features/generation/generationPolicy.service.js');

const seoRepo = await import('../src/features/seo/seo.repository.js');
const { parseSeoDocument, countPhraseOccurrences } = await import('../src/features/seo/seoDocument.js');
const { runDeterministicAnalysis } = await import('../src/features/seo/seoDeterministic.service.js');
const { SEO_DIMENSION_WEIGHTS } = await import('../src/features/seo/seo.constants.js');
const { calculateSeoScore } = await import('../src/features/seo/seoScore.service.js');
const { parseSeoAnalysisResponse, extractJsonObject, SeoResponseParseError } = await import(
  '../src/features/seo/seoAi.parse.js'
);
const { assessStructuredData, buildFaqSchema } = await import('../src/features/seo/seoStructuredData.service.js');
const { findInternalLinkOpportunities } = await import('../src/features/seo/seoLinks.service.js');
const gate = await import('../src/features/seo/seoGate.service.js');
const analysis = await import('../src/features/seo/seoAnalysis.service.js');
const { buildSeoAnalysisPrompt } = await import('../src/features/seo/seoPrompt.service.js');
const { contextFromArticle } = await import('../src/features/generation/generationContext.service.js');
const webRepo = await import('../src/features/web-intelligence/webSources.repository.js');
const retrievers = await import('../src/features/web-intelligence/retrievers/index.js');
const { buildCmsSeoMetadata, listSeoFieldMappings } = await import('../src/features/cms/seoAdapter.js');

/* ---------------------------------------------------------- mock provider */

let providerCalls = 0;
let lastPrompt = '';
/** What the mock returns next. Tests set this to exercise the parser. */
let nextResponse = '{}';

const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    providerCalls += 1;
    try {
      const body = JSON.parse(raw);
      lastPrompt = body.messages?.[0]?.content ?? '';
    } catch {
      lastPrompt = raw;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'mock-model',
        choices: [{ message: { content: nextResponse }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 900, completion_tokens: 400, total_tokens: 1300 },
      }),
    );
  });
});
await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
const MOCK_BASE = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

/* --------------------------------------------------------------- fixtures */

dbModule.initializeDatabase();
const db = () => dbModule.getDatabase();
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

const providerId = Number(
  db()
    .prepare(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
       VALUES ('Mock Provider', 'openai', ?, ?, 1)`,
    )
    .run(MOCK_BASE, KEY_VAR).lastInsertRowid,
);
/** Priced at zero, so every AI test in this file runs on a FREE model. */
const seoModelId = Number(
  db()
    .prepare(
      `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled,
        prompt_price, completion_price, is_free)
       VALUES (?, 'mock-seo-model', 1, 0, 0, 1)`,
    )
    .run(providerId).lastInsertRowid,
);
// Capabilities are a set (Milestone 15) — this model is the SEO reviewer.
db()
  .prepare(
    `INSERT INTO ai_model_capabilities (model_id, purpose, is_default_for_purpose)
     VALUES (?, 'seo_review', 1)`,
  )
  .run(seoModelId);

const setSeoModelPricing = (prompt: number | null, completion: number | null) =>
  db()
    .prepare('UPDATE ai_provider_models SET prompt_price = ?, completion_price = ? WHERE id = ?')
    .run(prompt, completion, seoModelId);

const GOOD_BODY = [
  '# Choosing a Budget Hiking Backpack',
  '',
  'A budget hiking backpack has to carry weight comfortably before it does anything else. This guide covers fit, capacity and durability for packs under one hundred dollars.',
  '',
  '## How torso length decides fit',
  '',
  'Measure from the seventh vertebra to the top of the hip bones. A pack sized to that measurement transfers load onto the hips, which is where it belongs.',
  '',
  '## What capacity you actually need',
  '',
  'For a two-night trip, forty to fifty litres is usually enough. Larger packs invite you to carry more than you need.',
  '',
  '- Weekend: 40-50L',
  '- Week-long: 60L and up',
  '',
  '## Where cheap packs fail',
  '',
  'Stitching at the shoulder straps and the hip belt takes the most load. Check both before a long trip.',
  '',
  'A budget hiking backpack that fits will outperform an expensive one that does not.',
].join('\n');

function makeArticle(title: string, body: string | null) {
  const draft = articles.createArticleDraft({
    articleTypeId: 1,
    authorId: author.id,
    productId: null,
    projectId: project.id,
    themeId: theme.id,
    topicId: topic.id,
    title,
    topic: 'Budget backpacks',
    targetAudience: 'Weekend hikers',
    searchIntent: 'Informational',
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: 'budget hiking backpack',
    secondaryKeywords: null,
  } as never);

  if (body !== null) {
    articles.saveGeneratedArticle(draft.id, {
      title,
      content: body,
      provider: 'Mock Provider',
      model: 'mock-model',
    });
  }
  return articles.getArticleById(draft.id)!;
}

function configure(articleId: number, overrides: Record<string, unknown> = {}) {
  return seoRepo.saveSeoConfiguration(articleId, {
    targetQuery: 'budget hiking backpack',
    searchIntent: 'informational',
    secondaryIntents: [],
    secondaryKeywords: ['torso length', 'pack capacity'],
    semanticTopics: [],
    targetAudience: 'Weekend hikers',
    geoTarget: null,
    seoObjectives: null,
    notes: null,
    ...overrides,
  } as never);
}

/** Deterministic input for one article, assembled the way the engine does. */
function deterministicFor(articleId: number) {
  const article = articles.getArticleById(articleId)!;
  return runDeterministicAnalysis({
    article,
    seo: seoRepo.getArticleSeo(articleId),
    context: contextFromArticle(article),
    document: parseSeoDocument(article.generated?.content ?? ''),
    hasCmsCopy: false,
    hasPublishedCmsCopy: false,
    publishedSlug: null,
  });
}

const codes = (findings: { code: string }[]) => findings.map((finding) => finding.code);

test.after(() => {
  mock.close();
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

/* ====================== the document model ============================== */

test('DOCUMENT: the body parses into headings, sections and addressable paragraphs', () => {
  const document = parseSeoDocument(GOOD_BODY);

  assert.equal(document.headings.length, 4, 'one H1 and three H2s');
  assert.equal(document.headings[0].level, 1);
  assert.equal(document.headings[1].path[0], 'Choosing a Budget Hiking Backpack', 'ancestry is tracked');
  assert.ok(document.paragraphs.length > 4);
  assert.ok(document.wordCount > 100);

  // Offsets must actually point at the passage, so a finding can highlight it.
  const paragraph = document.paragraphs[0];
  assert.ok(
    GOOD_BODY.slice(paragraph.startOffset, paragraph.endOffset).includes('carry weight comfortably'),
    'paragraph offsets locate the real text',
  );
});

test('DOCUMENT: list items are separate paragraphs, so a finding points at one bullet', () => {
  const document = parseSeoDocument(GOOD_BODY);
  const items = document.paragraphs.filter((paragraph) => paragraph.isListItem);
  assert.equal(items.length, 2);
  assert.match(items[0].text, /Weekend/);
});

test('DOCUMENT: phrase matching is exact, and honest about being exact', () => {
  assert.equal(countPhraseOccurrences('a budget hiking backpack is good', 'budget hiking backpack'), 1);
  assert.equal(countPhraseOccurrences('the pack, and the pack', 'pack'), 2, 'punctuation between words is tolerated');
  assert.equal(countPhraseOccurrences('packages of gear', 'pack'), 0, '"packages" is not "pack"');

  // No stemming: "packs" does not match "pack". This is exactly why the
  // deterministic keyword check is reported as a diagnostic and why judging
  // whether a CONCEPT is covered is left to the AI pass.
  assert.equal(countPhraseOccurrences('two packs', 'pack'), 0);
});

/* ====================== deterministic analysis ========================== */

test('DETERMINISTIC: a missing title is blocking, and missing content is blocking', () => {
  const article = makeArticle('', null);
  const findings = deterministicFor(article.id).findings;

  const blocking = findings.filter((finding) => finding.severity === 'blocking');
  assert.ok(codes(blocking).includes('title_missing'), 'no title is blocking');
  assert.ok(codes(blocking).includes('content_missing'), 'no content is blocking');
  assert.ok(
    blocking.every((finding) => finding.origin === 'deterministic' && finding.confidence === 1),
    'a deterministic finding is a fact, not a judgement',
  );
});

test('DETERMINISTIC: an over-long title and a missing meta description are reported precisely', () => {
  const article = makeArticle(
    'The Complete And Utterly Exhaustive Guide To Choosing A Budget Hiking Backpack In Every Season',
    GOOD_BODY,
  );
  configure(article.id);
  const findings = deterministicFor(article.id).findings;

  assert.ok(codes(findings).includes('seo_title_too_long'));
  assert.ok(codes(findings).includes('meta_description_missing'));

  const title = findings.find((finding) => finding.code === 'seo_title_too_long')!;
  assert.equal(title.severity, 'warning');
  assert.equal(title.element, 'title');
  assert.match(title.summary, /\d+ characters/, 'the finding states the actual length');
});

test('DETERMINISTIC: heading hierarchy problems are found and located', () => {
  const article = makeArticle(
    'Heading Problems In A Budget Hiking Backpack Guide',
    ['# One', '', 'Body text here to give the section some content and weight.', '', '#### Four', '', 'More body text under the skipped level so the section is not empty.', '', '# Another One', '', 'Text.'].join('\n'),
  );
  configure(article.id);
  const findings = deterministicFor(article.id).findings;

  assert.ok(codes(findings).includes('multiple_h1'));
  const skipped = findings.find((finding) => finding.code === 'heading_level_skipped')!;
  assert.ok(skipped, 'a jump from H1 to H4 is reported');
  assert.equal(skipped.locator?.heading, 'Four', 'and it names the heading it is about');
});

test('DETERMINISTIC: a generic heading is a recommendation, not a fault', () => {
  const article = makeArticle(
    'Generic Headings In A Budget Hiking Backpack Guide',
    ['# Guide', '', 'Opening text that is long enough to count as prose.', '', '## Introduction', '', 'Some words under the generic heading so the section is not flagged as empty instead.'].join('\n'),
  );
  configure(article.id);
  const finding = deterministicFor(article.id).findings.find((entry) => entry.code === 'heading_generic')!;

  assert.ok(finding);
  assert.equal(finding.severity, 'recommendation');
  assert.equal(finding.locator?.heading, 'Introduction');
});

test('DETERMINISTIC: an empty section is reported against its heading', () => {
  const article = makeArticle(
    'Empty Sections In A Budget Hiking Backpack Guide',
    ['# Guide', '', 'Opening prose with enough words to be a real paragraph of content.', '', '## A Promise Not Kept', '', '## Another Section', '', 'This one has real content beneath it, unlike the section above.'].join('\n'),
  );
  configure(article.id);
  const finding = deterministicFor(article.id).findings.find((entry) => entry.code === 'section_empty')!;

  assert.ok(finding);
  assert.equal(finding.locator?.heading, 'A Promise Not Kept');
});

test('DETERMINISTIC: slug format and length are checked', () => {
  const article = makeArticle('Slug Test For A Budget Hiking Backpack', GOOD_BODY);
  seoRepo.saveSeoMetadata(article.id, {
    seoTitle: null,
    metaDescription: null,
    seoSlug: 'the-very-best-and-most-complete-guide-to-the-budget-hiking-backpack-for-you',
    canonicalUrl: null,
    structuredDataTypes: [],
    structuredData: null,
  });
  configure(article.id);

  const findings = deterministicFor(article.id).findings;
  const slug = findings.find((finding) => finding.code === 'slug_too_long')!;
  assert.ok(slug, 'a long slug is reported');
  assert.match(slug.explanation!, /add nothing to the meaning/, 'and the stopwords are named');
});

test('DETERMINISTIC: duplicate SEO metadata across articles is detected', () => {
  const first = makeArticle('First Duplicate Metadata Article', GOOD_BODY);
  const second = makeArticle('Second Duplicate Metadata Article', GOOD_BODY);

  const shared = {
    seoTitle: 'The Same SEO Title On Two Articles',
    metaDescription: null,
    seoSlug: null,
    canonicalUrl: null,
    structuredDataTypes: [],
    structuredData: null,
  };
  seoRepo.saveSeoMetadata(first.id, shared);
  seoRepo.saveSeoMetadata(second.id, shared);
  configure(second.id);

  const findings = deterministicFor(second.id).findings;
  assert.ok(codes(findings).includes('seo_title_duplicate'));
});

test('DETERMINISTIC: an image with no alt text is a warning that names the image', () => {
  const article = makeArticle(
    'Images In A Budget Hiking Backpack Guide',
    ['# Packs', '', 'Some real prose before the image so the paragraph has content.', '', '![](/uploads/img_01.jpg)', '', 'And prose after it.'].join('\n'),
  );
  configure(article.id);
  const result = deterministicFor(article.id);

  const finding = result.findings.find((entry) => entry.code === 'image_missing_alt')!;
  assert.ok(finding);
  assert.match(finding.summary, /img_01\.jpg/);

  assert.ok(codes(result.findings).includes('image_filename_generic'));

  // An image requirement row is created for the image that exists, with no
  // alt text invented for it.
  assert.equal(result.imageRequirements.length, 1);
  assert.equal(result.imageRequirements[0].existingSource, '/uploads/img_01.jpg');
  assert.equal(result.imageRequirements[0].altText, null, 'no alt text is invented');
});

/* ====================== keywords are diagnostics ======================== */

test('KEYWORDS: density is reported as a diagnostic and is never a target', () => {
  const article = makeArticle('Keyword Diagnostics For A Budget Hiking Backpack', GOOD_BODY);
  configure(article.id);
  const result = deterministicFor(article.id);

  const primary = result.diagnostics.keywordUsage.find((usage) => usage.role === 'primary')!;
  assert.ok(primary, 'the target query is measured');
  assert.ok(primary.occurrences >= 1);
  assert.ok(primary.density !== null && primary.density > 0);

  // Nothing in the findings rewards a density figure.
  const densityFindings = result.findings.filter((finding) => /density/i.test(finding.summary));
  assert.equal(densityFindings.length, 0, 'no finding is generated for hitting a density');
});

test('KEYWORDS: overuse is a warning, and a merely-absent phrase is not treated as a missing concept', () => {
  const stuffed = [
    '# Budget Hiking Backpack',
    '',
    Array.from({ length: 12 }, () => 'A budget hiking backpack is a budget hiking backpack.').join(' '),
  ].join('\n');

  const article = makeArticle('Overused Query Budget Hiking Backpack Guide', stuffed);
  configure(article.id);
  const overuse = deterministicFor(article.id).findings.find((entry) => entry.code === 'target_query_overused')!;

  assert.ok(overuse, 'overuse is caught');
  assert.equal(overuse.severity, 'warning');

  // And when the phrase is simply absent, the finding says so honestly rather
  // than claiming the concept is missing.
  const other = makeArticle('A Guide With Different Wording Entirely For Hikers', GOOD_BODY);
  configure(other.id, { targetQuery: 'cheap rucksack for trekking' });
  const absent = deterministicFor(other.id).findings.find(
    (entry) => entry.code === 'target_query_absent_from_body',
  )!;
  assert.ok(absent);
  assert.match(absent.explanation!, /exact-phrase check/, 'the finding admits what it can and cannot see');
});

/* ====================== readability ===================================== */

test('READABILITY: extremes are located, and the check is not a grade level', () => {
  const longSentence = `${Array.from({ length: 70 }, (_, index) => `word${index}`).join(' ')}.`;
  const article = makeArticle(
    'Readability Extremes In A Budget Hiking Backpack Guide',
    ['# Guide', '', longSentence, '', 'A short one.'].join('\n'),
  );
  configure(article.id);
  const result = deterministicFor(article.id);

  const finding = result.findings.find((entry) => entry.code === 'sentence_very_long')!;
  assert.ok(finding);
  assert.equal(finding.severity, 'recommendation', 'prose length is advice, never blocking');
  assert.equal(finding.locator?.paragraphIndex, 0, 'and it points at the paragraph');

  // Reading time states the assumption it rests on.
  assert.equal(result.diagnostics.readingSpeedWpm, 225);
});

/* ====================== the score ======================================= */

test('SCORE: dimensions that were not examined are excluded, not assumed', () => {
  const score = calculateSeoScore({ findings: [], aiAnalysisRan: false, hasContent: true });

  const intent = score.dimensions.find((entry) => entry.dimension === 'search_intent')!;
  assert.equal(intent.evaluated, false, 'search intent needs a model');
  assert.equal(intent.score, null, 'and is neither credited nor punished');
  assert.ok(score.coverage < 1, 'coverage says how much was actually assessed');
  assert.ok(score.notEvaluated.length >= 3);
  assert.match(score.explanation, /excluded from the average/);
});

test('SCORE: a diagnostic alone does not make an unexamined dimension count as examined', () => {
  // A single info finding in an AI-only dimension. It contributes no evidence
  // about whether that dimension is in good shape, so the dimension must stay
  // "not assessed" rather than quietly scoring 100.
  const diagnostic = [
    {
      code: 'secondary_terms_unused',
      category: 'keywords',
      dimension: 'topical_coverage',
      severity: 'info',
      origin: 'deterministic',
      summary: 'Some secondary terms do not appear verbatim.',
      explanation: null,
      recommendation: null,
      element: null,
      locator: null,
      confidence: 1,
    },
  ];

  const score = calculateSeoScore({ findings: diagnostic as never, aiAnalysisRan: false, hasContent: true });
  const coverage = score.dimensions.find((entry) => entry.dimension === 'topical_coverage')!;

  assert.equal(coverage.evaluated, false, 'a diagnostic is not an assessment');
  assert.equal(coverage.score, null);
  assert.ok(score.notEvaluated.some((entry) => entry.dimension === 'topical_coverage'));
});

test('SCORE: an info finding costs nothing', () => {
  const base = { category: 'keywords', dimension: 'on_page', origin: 'deterministic', summary: 's', explanation: null, recommendation: null, element: null, locator: null, confidence: 1 } as never;

  const clean = calculateSeoScore({ findings: [], aiAnalysisRan: true, hasContent: true });
  const withInfo = calculateSeoScore({
    findings: [{ ...(base as object), code: 'x', severity: 'info' } as never],
    aiAnalysisRan: true,
    hasContent: true,
  });

  assert.equal(clean.overall, withInfo.overall, 'a diagnostic does not move the number');
});

test('SCORE: an AI penalty is weighted by the model’s own confidence', () => {
  const make = (origin: string, confidence: number) => [
    {
      code: 'x',
      category: 'topical_coverage',
      dimension: 'topical_coverage',
      severity: 'warning',
      origin,
      summary: 's',
      explanation: null,
      recommendation: null,
      element: null,
      locator: null,
      confidence,
    },
  ] as never;

  const certain = calculateSeoScore({ findings: make('deterministic', 1), aiAnalysisRan: true, hasContent: true });
  const unsure = calculateSeoScore({ findings: make('ai', 0.2), aiAnalysisRan: true, hasContent: true });

  const certainDimension = certain.dimensions.find((entry) => entry.dimension === 'topical_coverage')!;
  const unsureDimension = unsure.dimensions.find((entry) => entry.dimension === 'topical_coverage')!;

  assert.ok(
    unsureDimension.score! > certainDimension.score!,
    'a judgement the model is unsure about costs less than a fact',
  );
});

test('SCORE: a dismissed finding stops costing points', () => {
  const finding = {
    code: 'x',
    category: 'headings',
    dimension: 'structure',
    severity: 'warning',
    origin: 'deterministic',
    summary: 's',
    explanation: null,
    recommendation: null,
    element: null,
    locator: null,
    confidence: 1,
  };

  const open = calculateSeoScore({ findings: [finding] as never, aiAnalysisRan: true, hasContent: true });
  const dismissed = calculateSeoScore({
    findings: [{ ...finding, status: 'dismissed' }] as never,
    aiAnalysisRan: true,
    hasContent: true,
  });

  assert.ok(dismissed.overall! > open.overall!);
});

test('SCORE: the score explains itself and separates SEO readiness from article quality', () => {
  const score = calculateSeoScore({ findings: [], aiAnalysisRan: true, hasContent: true });
  assert.match(score.explanation, /SEO readiness/);
  assert.match(score.explanation, /says nothing about whether the article is well written/);
});

/* ====================== structured data ================================= */

test('SCHEMA: eligibility follows the data Cynth holds, not the article’s subject', () => {
  const article = makeArticle('Structured Data For A Budget Hiking Backpack', GOOD_BODY);
  const opportunities = assessStructuredData({
    article,
    document: parseSeoDocument(GOOD_BODY),
    context: contextFromArticle(article),
    hasAuthorName: true,
    hasPublishedDate: true,
  });

  const articleSchema = opportunities.find((entry) => entry.type === 'Article')!;
  assert.equal(articleSchema.eligible, true);

  const product = opportunities.find((entry) => entry.type === 'Product')!;
  assert.equal(product.eligible, false, 'Product schema needs offer or review data Cynth does not hold');
  assert.ok(product.unmetRequirements.some((entry) => /price/i.test(entry)));

  const faq = opportunities.find((entry) => entry.type === 'FAQPage')!;
  assert.equal(faq.eligible, false, 'this article has no question-and-answer pairs');
});

test('SCHEMA: a bullet listicle is not a procedure, and does not qualify for HowTo', () => {
  const listicle = [
    '# 7 Best Budget Packs',
    '',
    'Opening prose that introduces the roundup and what it covers for the reader.',
    '',
    '## The picks',
    '',
    '- The first pack, a comfortable option for weekend trips under fifty litres',
    '- The second pack, a heavier option that carries more weight comfortably',
    '- The third pack, the cheapest of the three and the least durable of them',
    '- The fourth pack, a compromise between the price and the build quality',
  ].join('\n');

  const article = makeArticle('7 Best Budget Packs', listicle);
  const howTo = assessStructuredData({
    article: articles.getArticleById(article.id)!,
    document: parseSeoDocument(listicle),
    context: contextFromArticle(articles.getArticleById(article.id)!),
    hasAuthorName: true,
    hasPublishedDate: true,
  }).find((entry) => entry.type === 'HowTo')!;

  assert.equal(howTo.eligible, false, 'bullet points are not ordered steps');
  assert.match(howTo.unmetRequirements[0], /ordered steps; this article has 0/);

  // A genuinely numbered procedure does qualify.
  const procedure = [
    '# Fitting a pack',
    '',
    'Opening prose describing the process before the steps begin in earnest.',
    '',
    '1. Measure your torso from the seventh vertebra to the top of the hip bones',
    '2. Match that measurement against the pack maker’s own sizing chart',
    '3. Load the pack with fifteen kilograms and walk with it for ten minutes',
  ].join('\n');

  const procedureArticle = makeArticle('Fitting a pack', procedure);
  const qualified = assessStructuredData({
    article: articles.getArticleById(procedureArticle.id)!,
    document: parseSeoDocument(procedure),
    context: contextFromArticle(articles.getArticleById(procedureArticle.id)!),
    hasAuthorName: true,
    hasPublishedDate: true,
  }).find((entry) => entry.type === 'HowTo')!;

  assert.equal(qualified.eligible, true, 'an ordered list of steps does qualify');
});

test('SCHEMA: an FAQ document is built only from questions the article really answers', () => {
  const faqBody = [
    '# Pack Questions',
    '',
    'Opening prose.',
    '',
    '## What size pack do I need?',
    '',
    'For a two-night trip, forty to fifty litres is usually enough for most hikers carrying standard gear.',
    '',
    '## How do I measure torso length?',
    '',
    'Measure from the seventh vertebra down to the top of the hip bones, then match that to the pack size chart.',
  ].join('\n');

  const schema = buildFaqSchema(parseSeoDocument(faqBody))!;
  assert.ok(schema);
  assert.equal((schema.mainEntity as unknown[]).length, 2);

  // And an article without them produces null rather than an empty structure.
  assert.equal(buildFaqSchema(parseSeoDocument(GOOD_BODY)), null);
});

/* ====================== internal links ================================== */

test('INTERNAL LINKS: candidates are real articles, ranked with a stated reason', () => {
  const target = makeArticle('How To Measure Torso Length For A Pack', GOOD_BODY);
  articles.getArticleById(target.id);

  const source = makeArticle('Fitting A Budget Hiking Backpack Properly', GOOD_BODY);
  const candidates = findInternalLinkOpportunities(
    articles.getArticleById(source.id)!,
    parseSeoDocument(GOOD_BODY),
  );

  const hit = candidates.find((candidate) => candidate.targetArticleId === target.id);
  assert.ok(hit, 'an article on the same topic is proposed');
  assert.ok(hit!.reasons.length > 0, 'and the suggestion explains itself');
  assert.ok(
    candidates.every((candidate) => candidate.targetArticleId !== source.id),
    'an article never links to itself',
  );
});

test('INTERNAL LINKS: a target that is not a real article cannot be stored', () => {
  const source = makeArticle('Link Storage Test For Budget Packs', GOOD_BODY);

  const stored = seoRepo.saveInternalLinks([
    {
      analysisId: null,
      sourceArticleId: source.id,
      targetArticleId: 999_999,
      anchorSuggestion: 'invented',
      anchorFoundInSource: false,
      reason: 'invented',
      relevance: 1,
      confidence: 1,
      origin: 'ai',
    },
  ]);

  assert.equal(stored.length, 0, 'an article id that does not exist is silently dropped, never stored');
});

/* ====================== the AI response parser ========================== */

const AI_RESPONSE = {
  intentAssessment: {
    detectedIntent: 'informational',
    matchesConfiguredIntent: true,
    satisfiesSearcher: false,
    reasoning: 'The guide stops short of comparing specific packs.',
    titleSatisfies: true,
    introductionSatisfies: true,
    structureSatisfies: true,
    contentSatisfies: false,
    conclusionSatisfies: false,
    confidence: 0.8,
  },
  findings: [
    {
      category: 'content_depth',
      dimension: 'content_relevance',
      severity: 'warning',
      summary: 'The article never compares specific packs.',
      explanation: 'A reader choosing a pack wants named options.',
      recommendation: 'Add a short comparison.',
      element: 'body',
      heading: 'What capacity you actually need',
      excerpt: 'For a two-night trip, forty to fifty litres is usually enough.',
      confidence: 0.7,
    },
    {
      category: 'not_a_real_category',
      dimension: 'structure',
      severity: 'warning',
      summary: 'This finding should be discarded.',
      confidence: 0.9,
    },
    {
      category: 'headings',
      dimension: 'structure',
      severity: 'catastrophic',
      summary: 'This one too — invalid severity.',
      confidence: 0.9,
    },
  ],
  topicalCoverage: {
    coveredConcepts: ['torso length', 'capacity'],
    missingConcepts: [
      { concept: 'hip belt padding', importance: 'essential', why: 'It carries the load.', confidence: 0.9 },
    ],
    missingQuestions: [{ question: 'How much should a pack weigh empty?', why: 'Buyers ask.', confidence: 0.6 }],
    missingEntities: [],
    relationships: ['fit determines comfort'],
  },
  titleProposal: { seoTitle: 'Budget Hiking Backpacks: How to Pick One That Fits', rationale: 'Clearer.', confidence: 0.8 },
  metaDescriptionProposal: {
    metaDescription: 'How to choose a budget hiking backpack that actually fits: torso length, capacity and where cheap packs fail.',
    rationale: 'States the payoff.',
    confidence: 0.8,
  },
  slugProposal: { slug: 'budget-hiking-backpack-fit', rationale: 'Shorter.', confidence: 0.7 },
  internalLinkSuggestions: [{ targetArticleId: 999_999, anchorText: 'invented', reason: 'invented', confidence: 0.9 }],
  externalSourceSuggestions: [
    {
      purpose: 'evidence',
      claimContext: 'A pack sized to that measurement transfers load onto the hips',
      sourceType: 'An outdoor-industry sizing standard',
      suggestedDomain: null,
      rationale: 'A published standard would support the measurement advice.',
      confidence: 0.6,
    },
  ],
  imageSuggestions: [
    { placement: 'Under the fit section', purpose: 'Show the measurement', altText: 'Measuring torso length with a tape', filename: 'measuring-torso-length.jpg', caption: null },
  ],
};

test('PARSER: a code-fenced response with preamble is still read', () => {
  const wrapped = `Here is my analysis:\n\n\`\`\`json\n${JSON.stringify({ findings: [] })}\n\`\`\``;
  const parsed = extractJsonObject(wrapped) as Record<string, unknown>;
  assert.ok(Array.isArray(parsed.findings));
});

test('PARSER: a response that is not JSON is refused, never salvaged', () => {
  assert.throws(() => extractJsonObject('I could not analyse this article.'), SeoResponseParseError);
});

test('PARSER: findings with an unknown category or severity are discarded, not repaired', () => {
  const document = parseSeoDocument(GOOD_BODY);
  const parsed = parseSeoAnalysisResponse(JSON.stringify(AI_RESPONSE), {
    document,
    allowedArticleIds: new Set([1]),
  });

  assert.equal(parsed.findings.length, 1, 'only the valid finding survives');
  assert.equal(parsed.findings[0].category, 'content_depth');
  assert.equal(parsed.discarded.length >= 2, true, 'and the discards are reported rather than hidden');
  assert.ok(parsed.discarded.some((entry) => /unknown category/.test(entry)));
  assert.ok(parsed.discarded.some((entry) => /unknown severity/.test(entry)));
});

test('PARSER: an internal link to an article that does not exist is discarded', () => {
  const parsed = parseSeoAnalysisResponse(JSON.stringify(AI_RESPONSE), {
    document: parseSeoDocument(GOOD_BODY),
    allowedArticleIds: new Set([1, 2]),
  });

  assert.equal(parsed.internalLinks.length, 0, 'Cynth cannot be talked into linking to nothing');
  assert.ok(parsed.discarded.some((entry) => /999999|999,999/.test(entry.replace(/\s/g, ''))));
});

test('PARSER: a quoted passage is verified against the article before it is shown', () => {
  const document = parseSeoDocument(GOOD_BODY);

  const real = parseSeoAnalysisResponse(JSON.stringify(AI_RESPONSE), {
    document,
    allowedArticleIds: new Set(),
  });
  assert.ok(real.findings[0].locator?.excerpt, 'a genuine quote is kept and located');
  assert.equal(real.findings[0].locator?.heading, 'What capacity you actually need');

  const invented = JSON.parse(JSON.stringify(AI_RESPONSE));
  invented.findings = [
    {
      ...AI_RESPONSE.findings[0],
      excerpt: 'This sentence appears nowhere in the article whatsoever, not once.',
      heading: null,
    },
  ];
  const checked = parseSeoAnalysisResponse(JSON.stringify(invented), { document, allowedArticleIds: new Set() });
  assert.equal(checked.findings[0].locator?.excerpt ?? null, null, 'an invented quote is not shown as a quote');
  assert.match(checked.findings[0].explanation!, /could not find the quoted passage/);
});

test('PARSER: a missing confidence becomes uncertainty rather than certainty', () => {
  const parsed = parseSeoAnalysisResponse(
    JSON.stringify({
      findings: [{ category: 'headings', dimension: 'structure', severity: 'warning', summary: 'No confidence given.' }],
    }),
    { document: parseSeoDocument(GOOD_BODY), allowedArticleIds: new Set() },
  );
  assert.equal(parsed.findings[0].confidence, 0.5);
});

/* ====================== the prompt ====================================== */

test('PROMPT: the SEO prompt carries the editorial context and forbids invention', () => {
  const article = makeArticle('Prompt Context For A Budget Hiking Backpack', GOOD_BODY);
  configure(article.id);

  const prompt = buildSeoAnalysisPrompt({
    article: articles.getArticleById(article.id)!,
    seo: seoRepo.getArticleSeo(article.id),
    context: contextFromArticle(articles.getArticleById(article.id)!),
    document: parseSeoDocument(GOOD_BODY),
    diagnostics: deterministicFor(article.id).diagnostics,
    linkableArticles: [{ id: 42, title: 'Another Article', topic: null }],
    knownFindingSummaries: ['Already known finding.'],
  });

  for (const marker of ['Hiking Gear', 'Budget Backpacks', 'Test Author', 'Packs under 100 USD']) {
    assert.ok(prompt.prompt.includes(marker), `the prompt should carry ${marker}`);
  }

  assert.match(prompt.prompt, /DO NOT optimise for keyword density/);
  assert.match(prompt.prompt, /DO NOT invent external sources/);
  assert.match(prompt.prompt, /DO NOT rewrite the article/);
  assert.match(prompt.prompt, /id 42/, 'only real articles are offered for internal links');
  assert.match(prompt.prompt, /Already known finding/, 'and the deterministic findings are not asked for twice');
  assert.match(prompt.prompt, /DIAGNOSTIC ONLY/, 'term counts are labelled as diagnostics in the prompt too');
});

/* ====================== cost safety ===================================== */

test('COST: deterministic analysis contacts no provider at all', async () => {
  const before = providerCalls;
  const article = makeArticle('Free Analysis Of A Budget Hiking Backpack', GOOD_BODY);
  configure(article.id);

  const outcome = await analysis.runSeoAnalysis(article.id);

  assert.equal(providerCalls, before, 'no provider was contacted');
  assert.equal(outcome.result.run.mode, 'deterministic');
  assert.equal(outcome.result.run.model, null, 'and no model is recorded, because none ran');
  assert.match(outcome.aiNote!, /Deterministic analysis only/);
});

test('COST: a paid model is refused in Test mode, and never swapped for a free one', async () => {
  policy.setGenerationMode('test');
  setSeoModelPricing(0.000003, 0.000015);

  const article = makeArticle('Paid Refusal For A Budget Hiking Backpack', GOOD_BODY);
  configure(article.id);
  const before = providerCalls;

  const outcome = await analysis.runSeoAnalysis(article.id, { includeAi: true });

  assert.equal(providerCalls, before, 'nothing was sent');
  assert.equal(outcome.result.run.status, 'partial', 'the deterministic half still stands');
  assert.match(outcome.aiNote!, /Test mode/);
  assert.ok(outcome.result.findings.length > 0, 'and the free findings are not thrown away');

  setSeoModelPricing(0, 0);
});

test('COST: a paid model in Production mode needs explicit confirmation', async () => {
  policy.setGenerationMode('production');
  setSeoModelPricing(0.000003, 0.000015);

  const article = makeArticle('Confirmation Required Budget Hiking Backpack', GOOD_BODY);
  configure(article.id);
  const before = providerCalls;

  const unconfirmed = await analysis.runSeoAnalysis(article.id, { includeAi: true });
  assert.equal(providerCalls, before, 'no request without confirmation');
  assert.match(unconfirmed.aiNote!, /Confirm the estimated cost/);

  setSeoModelPricing(0, 0);
  policy.setGenerationMode('test');
});

test('COST: an identical AI analysis is reused instead of paid for twice', async () => {
  nextResponse = JSON.stringify(AI_RESPONSE);
  const article = makeArticle('Cached Analysis Of A Budget Hiking Backpack', GOOD_BODY);
  configure(article.id);

  const first = await analysis.runSeoAnalysis(article.id, { includeAi: true });
  assert.equal(first.reusedPreviousAi, false);
  const callsAfterFirst = providerCalls;

  const second = await analysis.runSeoAnalysis(article.id, { includeAi: true });
  assert.equal(providerCalls, callsAfterFirst, 'the model was not asked the same question twice');
  assert.equal(second.reusedPreviousAi, true);
  assert.match(second.aiNote!, /already exists/);

  // The carried-forward AI findings are still present, not silently lost.
  assert.ok(second.result.findings.some((finding) => finding.origin === 'ai'));

  // And force overrides it, because that is the user's call.
  const forced = await analysis.runSeoAnalysis(article.id, { includeAi: true, force: true });
  assert.equal(providerCalls, callsAfterFirst + 1);
  assert.equal(forced.reusedPreviousAi, false);
});

test('COST: editing the article invalidates the cached analysis', async () => {
  nextResponse = JSON.stringify(AI_RESPONSE);
  const article = makeArticle('Invalidated Cache Budget Hiking Backpack', GOOD_BODY);
  configure(article.id);

  await analysis.runSeoAnalysis(article.id, { includeAi: true });
  const callsBefore = providerCalls;

  articles.saveGeneratedArticle(article.id, {
    title: 'Invalidated Cache Budget Hiking Backpack',
    content: `${GOOD_BODY}\n\n## A new section\n\nWith genuinely new content in it.`,
    provider: 'Mock Provider',
    model: 'mock-model',
  });

  const rerun = await analysis.runSeoAnalysis(article.id, { includeAi: true });
  assert.equal(providerCalls, callsBefore + 1, 'changed text is a new question');
  assert.equal(rerun.reusedPreviousAi, false);
});

/* ====================== AI-assisted analysis end to end ================= */

test('AI: a combined analysis merges deterministic facts with model judgements', async () => {
  nextResponse = JSON.stringify(AI_RESPONSE);
  const article = makeArticle('Combined Analysis Budget Hiking Backpack Guide', GOOD_BODY);
  configure(article.id);

  const outcome = await analysis.runSeoAnalysis(article.id, { includeAi: true });
  const { result } = outcome;

  assert.equal(result.run.mode, 'combined');
  assert.equal(result.run.status, 'success');
  assert.equal(result.run.model, 'mock-seo-model');
  assert.equal(result.run.totalTokens, 1300, 'only what the provider actually reported');

  const origins = new Set(result.findings.map((finding) => finding.origin));
  assert.ok(origins.has('deterministic') && origins.has('ai'), 'both kinds of claim are present');
  assert.ok(
    result.findings.every((finding) => finding.origin === 'deterministic' || finding.origin === 'ai'),
    'and every finding says which it is',
  );

  // Missing concepts become topical-coverage findings, distinct from keywords.
  const concept = result.findings.find((finding) => /hip belt padding/.test(finding.summary))!;
  assert.ok(concept);
  assert.equal(concept.dimension, 'topical_coverage');
  assert.match(concept.recommendation!, /does not need to use these exact words/);

  // Every dimension is now evaluated, and the score says so.
  assert.equal(result.score.coverage, 1);
  assert.ok(result.score.overall !== null);
});

test('AI: a failed AI pass keeps the deterministic analysis and is recorded as partial', async () => {
  nextResponse = 'I am afraid I cannot do that.';
  const article = makeArticle('Unparseable Response Budget Hiking Backpack', GOOD_BODY);
  configure(article.id);

  const outcome = await analysis.runSeoAnalysis(article.id, { includeAi: true });

  assert.equal(outcome.result.run.status, 'partial');
  assert.ok(outcome.result.findings.length > 0, 'the free analysis survives');
  assert.ok(
    outcome.result.findings.every((finding) => finding.origin === 'deterministic'),
    'and no findings were invented from an unreadable response',
  );
  assert.match(outcome.aiNote!, /could not be read/);

  nextResponse = JSON.stringify(AI_RESPONSE);
});

/* ====================== findings, recommendations, approval ============= */

test('FINDINGS: a finding carries category, severity, origin, confidence and a locator', async () => {
  // A body with a genuinely over-long paragraph, so at least one finding has
  // a passage to point at rather than being about the article as a whole.
  const longParagraph = Array.from(
    { length: 12 },
    (_, index) => `Sentence number ${index} explains one more detail about pack fitting at some length.`,
  ).join(' ');

  const article = makeArticle(
    'Finding Structure Budget Hiking Backpack Guide',
    `${GOOD_BODY}\n\n## Fitting in detail\n\n${longParagraph}`,
  );
  configure(article.id);
  const outcome = await analysis.runSeoAnalysis(article.id);

  for (const finding of outcome.result.findings) {
    assert.ok(finding.code && finding.category && finding.dimension && finding.severity);
    assert.ok(finding.origin === 'deterministic' || finding.origin === 'ai');
    assert.ok(typeof finding.confidence === 'number');
    assert.equal(finding.status, 'open');
  }

  const located = outcome.result.findings.find((finding) => finding.locator?.heading);
  assert.ok(located, 'at least one finding points at a specific heading');
});

test('RECOMMENDATIONS: approving a metadata proposal writes the field; approving body advice writes nothing', async () => {
  nextResponse = JSON.stringify(AI_RESPONSE);
  const article = makeArticle('Approval Flow Budget Hiking Backpack Guide', GOOD_BODY);
  configure(article.id);

  const outcome = await analysis.runSeoAnalysis(article.id, { includeAi: true });
  const contentBefore = articles.getArticleById(article.id)!.generated!.content;

  const metaProposal = outcome.result.recommendations.find(
    (recommendation) => recommendation.field === 'meta_description' && recommendation.proposedValue,
  )!;
  assert.ok(metaProposal, 'the model proposed a meta description');
  assert.equal(metaProposal.status, 'proposed', 'a proposal is not applied by making it');
  assert.equal(seoRepo.getArticleSeo(article.id).metadata.metaDescription, null, 'and nothing was written yet');

  seoRepo.setSeoMetadataField(article.id, 'meta_description', metaProposal.proposedValue);
  seoRepo.setRecommendationStatus(metaProposal.id, 'applied');
  assert.equal(seoRepo.getArticleSeo(article.id).metadata.metaDescription, metaProposal.proposedValue);

  // A body recommendation carries no replacement text at all.
  const contentProposal = outcome.result.recommendations.find(
    (recommendation) => recommendation.field === 'content',
  );
  if (contentProposal) {
    assert.equal(contentProposal.proposedValue, null, 'Cynth proposes no replacement prose');
  }

  assert.equal(
    articles.getArticleById(article.id)!.generated!.content,
    contentBefore,
    'the article body is untouched by the whole approval flow',
  );
});

test('RECOMMENDATIONS: re-analysing replaces open proposals but keeps human decisions', async () => {
  const article = makeArticle('Repeat Analysis Budget Hiking Backpack Guide', GOOD_BODY);
  configure(article.id);

  const first = await analysis.runSeoAnalysis(article.id);
  const firstCount = seoRepo.listRecommendationsForArticle(article.id).length;
  assert.ok(firstCount > 0);

  // Reject one, so there is a decision that must survive.
  const rejected = first.result.recommendations[0];
  seoRepo.setRecommendationStatus(rejected.id, 'rejected');

  await analysis.runSeoAnalysis(article.id);
  const after = seoRepo.listRecommendationsForArticle(article.id);

  const open = after.filter((recommendation) => recommendation.status === 'proposed');
  assert.equal(open.length, firstCount - 1, 'the same proposals are not shown twice');
  assert.ok(
    after.some((recommendation) => recommendation.id === rejected.id && recommendation.status === 'rejected'),
    'and the rejection survives the re-run',
  );
});

test('ARTICLE SAFETY: analysis never modifies the article it analyses', async () => {
  nextResponse = JSON.stringify(AI_RESPONSE);
  const article = makeArticle('Untouched Article Budget Hiking Backpack Guide', GOOD_BODY);
  configure(article.id);

  const before = articles.getArticleById(article.id)!;
  const snapshot = {
    title: before.title,
    slug: before.slug,
    content: before.generated!.content,
    generatedTitle: before.generated!.title,
    searchIntent: before.searchIntent,
    targetAudience: before.targetAudience,
  };

  await analysis.runSeoAnalysis(article.id, { includeAi: true });
  seoRepo.saveSeoMetadata(article.id, {
    seoTitle: 'A Different SEO Title Entirely',
    metaDescription: 'A different description.',
    seoSlug: 'a-different-slug',
    canonicalUrl: null,
    structuredDataTypes: ['Article'],
    structuredData: { '@type': 'Article' },
  });

  const after = articles.getArticleById(article.id)!;
  assert.equal(after.title, snapshot.title, 'the editorial title is untouched');
  assert.equal(after.slug, snapshot.slug, 'the article slug is untouched by an SEO slug');
  assert.equal(after.generated!.content, snapshot.content, 'the body is untouched');
  assert.equal(after.generated!.title, snapshot.generatedTitle);
  assert.equal(after.searchIntent, snapshot.searchIntent, 'the content brief is untouched');
  assert.equal(after.targetAudience, snapshot.targetAudience);
});

/* ====================== metadata persistence ============================ */

test('METADATA: configuration and metadata persist separately from the article', () => {
  const article = makeArticle('Persistence Budget Hiking Backpack Guide', GOOD_BODY);

  seoRepo.saveSeoConfiguration(article.id, {
    targetQuery: 'budget hiking backpack',
    searchIntent: 'hybrid',
    secondaryIntents: ['informational', 'commercial_investigation'],
    secondaryKeywords: ['cheap rucksack', 'affordable pack'],
    semanticTopics: ['torso length', 'hip belt'],
    targetAudience: 'Weekend hikers',
    geoTarget: 'United Kingdom',
    seoObjectives: 'Rank for the buying-guide query.',
    notes: 'Keep it practical.',
  } as never);

  const record = seoRepo.getArticleSeo(article.id);
  assert.equal(record.configuration.searchIntent, 'hybrid');
  assert.deepEqual(record.configuration.secondaryIntents, ['informational', 'commercial_investigation']);
  assert.deepEqual(record.configuration.semanticTopics, ['torso length', 'hip belt']);
  assert.equal(record.configuration.geoTarget, 'United Kingdom');

  seoRepo.saveSeoMetadata(article.id, {
    seoTitle: 'Budget Hiking Backpacks That Fit',
    metaDescription: 'A practical guide.',
    seoSlug: 'budget-hiking-backpacks-that-fit',
    canonicalUrl: 'https://example.org/budget-hiking-backpacks-that-fit',
    structuredDataTypes: ['Article'],
    structuredData: { '@type': 'Article', headline: 'Budget Hiking Backpacks That Fit' },
  });

  const reloaded = seoRepo.getArticleSeo(article.id);
  assert.equal(reloaded.metadata.seoTitle, 'Budget Hiking Backpacks That Fit');
  assert.deepEqual(reloaded.metadata.structuredDataTypes, ['Article']);
  assert.equal((reloaded.metadata.structuredData as Record<string, unknown>).headline, 'Budget Hiking Backpacks That Fit');

  // And the configuration survives a metadata write.
  assert.equal(reloaded.configuration.targetQuery, 'budget hiking backpack');
});

test('METADATA: an article with no SEO record reads as empty, never as invented defaults', () => {
  const article = makeArticle('No SEO Record Budget Hiking Backpack Guide', GOOD_BODY);
  const record = seoRepo.getArticleSeo(article.id);

  assert.equal(record.configuration.targetQuery, null);
  assert.equal(record.configuration.searchIntent, null);
  assert.equal(record.metadata.seoTitle, null);
  assert.equal(record.metadata.metaDescription, null);
  assert.equal(record.latestScore, null);
});

/* ====================== the gate ======================================== */

test('GATE: an unanalysed article is not ready, and the reason says so', () => {
  const article = makeArticle('Ungated Budget Hiking Backpack Guide', GOOD_BODY);

  const decision = gate.evaluateSeoGate({
    articleId: article.id,
    seo: seoRepo.getArticleSeo(article.id),
    latestRun: null,
    findings: [],
    currentContentFingerprint: analysis.contentFingerprint(articles.getArticleById(article.id)!),
  });

  assert.equal(decision.ready, false);
  assert.ok(decision.blockingReasons.some((reason) => /never been analysed|No SEO analysis/i.test(reason)));
  assert.ok(decision.checks.length >= 8, 'every criterion reports its own verdict');
  assert.ok(decision.checks.every((check) => typeof check.detail === 'string' && check.detail.length > 0));
});

test('GATE: a perfect score is never required, and warnings alone do not block', async () => {
  const article = makeArticle('Warnings Only Budget Hiking Backpack Guide', GOOD_BODY);
  configure(article.id);
  const outcome = await analysis.runSeoAnalysis(article.id);

  assert.ok(outcome.result.score.overall! < 100, 'the article has warnings');
  assert.equal(outcome.result.gate.ready, true, 'but is still SEO-ready');
  assert.ok(outcome.result.gate.warnings.length > 0, 'and the warnings are reported');

  const scoreCheck = outcome.result.gate.checks.find((check) => check.key === 'score')!;
  assert.equal(scoreCheck.enforced, false, 'no minimum score is configured by default');
});

test('GATE: a blocking finding stops the article, and dismissing it releases it', async () => {
  const article = makeArticle('', GOOD_BODY);
  configure(article.id);
  const outcome = await analysis.runSeoAnalysis(article.id);

  assert.equal(outcome.result.gate.ready, false);
  const blocking = outcome.result.findings.find((finding) => finding.severity === 'blocking')!;
  assert.ok(blocking);

  seoRepo.setFindingStatus(blocking.id, 'dismissed');

  const after = gate.evaluateSeoGate({
    articleId: article.id,
    seo: seoRepo.getArticleSeo(article.id),
    latestRun: seoRepo.getLatestAnalysisRun(article.id),
    findings: seoRepo.listFindingsForAnalysis(outcome.result.run.id),
    currentContentFingerprint: analysis.contentFingerprint(articles.getArticleById(article.id)!),
  });
  assert.equal(after.ready, true, 'a reviewed-and-dismissed finding stops blocking');
});

test('GATE: criteria are configurable, including switching the gate off', () => {
  const original = gate.getGateCriteria();
  assert.equal(original.enforceBeforePush, true);
  assert.equal(original.minScore, null, 'no minimum score by default');
  assert.equal(original.requireAiAnalysis, false, 'a paid step is never required to publish');

  const updated = gate.saveGateCriteria({ minScore: 80, maxWarnings: 0 });
  assert.equal(updated.minScore, 80);
  assert.equal(updated.maxWarnings, 0);

  gate.saveGateCriteria(gate.DEFAULT_GATE_CRITERIA);
  assert.deepEqual(gate.getGateCriteria(), gate.DEFAULT_GATE_CRITERIA);
});

test('GATE: an analysis that no longer describes the article is refused', async () => {
  const article = makeArticle('Stale Analysis Budget Hiking Backpack Guide', GOOD_BODY);
  configure(article.id);
  const outcome = await analysis.runSeoAnalysis(article.id);
  assert.equal(outcome.result.gate.ready, true);

  articles.saveGeneratedArticle(article.id, {
    title: 'Stale Analysis Budget Hiking Backpack Guide',
    content: `${GOOD_BODY}\n\n## Entirely new material\n\nAdded after the analysis was run.`,
    provider: 'Mock Provider',
    model: 'mock-model',
  });

  const after = gate.evaluateSeoGate({
    articleId: article.id,
    seo: seoRepo.getArticleSeo(article.id),
    latestRun: seoRepo.getLatestAnalysisRun(article.id),
    findings: seoRepo.listFindingsForAnalysis(outcome.result.run.id),
    currentContentFingerprint: analysis.contentFingerprint(articles.getArticleById(article.id)!),
  });

  assert.equal(after.analysisIsCurrent, false);
  assert.equal(after.ready, false);
  assert.ok(after.blockingReasons.some((reason) => /changed since/.test(reason)));
});

/* ====================== external sources ================================ */

test('EXTERNAL SOURCES: a recommendation is stored unverified, and cannot be marked verified without a retrieval', async () => {
  nextResponse = JSON.stringify(AI_RESPONSE);
  const article = makeArticle('External Sources Budget Hiking Backpack Guide', GOOD_BODY);
  configure(article.id);

  const outcome = await analysis.runSeoAnalysis(article.id, { includeAi: true });
  const source = outcome.result.externalSources[0];

  assert.ok(source, 'the model suggested a source');
  assert.equal(source.verificationStatus, 'unverified', 'nothing has checked it');
  assert.equal(source.suggestedUrl, null, 'and no URL was invented');
  assert.ok(source.sourceType, 'the KIND of source is what was proposed');

  // Approving it does not verify it.
  const approved = seoRepo.setExternalSourceStatus(source.id, 'approved')!;
  assert.equal(approved.verificationStatus, 'unverified');

  // And verification is impossible without a real retrieval record.
  assert.equal(
    seoRepo.markExternalSourceVerified(source.id, 999_999, 'verified'),
    null,
    'a verification with no retrieval behind it is refused',
  );
});

/* ====================== web intelligence foundation ===================== */

/**
 * Milestone 17 registered the first retriever, so the assertion this test
 * used to make — that Cynth can fetch nothing at all — is no longer true and
 * is not asserted as though it were.
 *
 * What replaces it is the guarantee that actually still holds, and that
 * matters more now that a retriever exists: a retriever reads a page only
 * through an authorised WebSource, and it cannot be handed a bare URL.
 */
test('WEB: the retriever registry is the only way to reach the network', () => {
  assert.equal(retrievers.hasAnyRetriever(), true, 'Milestone 17 registered the http retriever');
  assert.deepEqual(
    retrievers.listRetrievers().map((entry) => entry.retrieverType),
    ['http'],
    'exactly one retriever — registering a crawler would be a visible change here',
  );
  assert.equal(retrievers.getRetriever('search'), null, 'no site-search retriever exists');

  const retriever = retrievers.getRetriever('http')!;
  // The contract that keeps authorisation structural: fetch takes a source,
  // never a URL on its own.
  assert.equal(retriever.fetch.length, 2, 'fetch(source, url) — a URL alone is not a valid call');
  assert.equal(typeof retriever.isPermitted, 'function');
  assert.equal(retriever.discover, undefined, 'the http retriever enumerates nothing: it is not a crawler');
});

test('WEB SOURCES: a source is a domain, and both permissions default to off', () => {
  const source = webRepo.createWebSource({
    projectId: project.id,
    name: 'Example Authority',
    domain: 'https://WWW.Example.org/some/path?q=1',
    description: null,
    purpose: 'authority',
    isActive: true,
    crawlPermitted: false,
    searchPermitted: false,
    respectRobots: true,
    rateLimitPerMinute: 10,
    notes: null,
  });

  assert.equal(source.domain, 'example.org', 'the URL is reduced to a host');
  assert.equal(source.crawlPermitted, false, 'being on the list is not consent');
  assert.equal(source.searchPermitted, false);
  assert.equal(source.respectRobots, true);

  assert.equal(webRepo.isSourceAuthorised(source, 'crawl').permitted, false);
  const permitted = webRepo.updateWebSource(source.id, {
    projectId: null,
    name: source.name,
    domain: source.domain,
    description: null,
    purpose: 'authority',
    isActive: true,
    crawlPermitted: true,
    searchPermitted: false,
    respectRobots: true,
    rateLimitPerMinute: 10,
    notes: null,
  })!;

  assert.equal(webRepo.isSourceAuthorised(permitted, 'crawl').permitted, true);
  assert.equal(webRepo.isSourceAuthorised(permitted, 'search').permitted, false, 'permissions are separate');
});

test('PROVENANCE: a finding cannot exist without the retrieval it came from', () => {
  const source = webRepo.createWebSource({
    projectId: null,
    name: 'Provenance Source',
    domain: 'provenance.example',
    description: null,
    purpose: 'research',
    isActive: true,
    crawlPermitted: true,
    searchPermitted: false,
    respectRobots: true,
    rateLimitPerMinute: null,
    notes: null,
  });

  assert.throws(
    () =>
      webRepo.recordWebFinding({
        retrievalId: 999_999,
        topic: 'packs',
        findingType: 'fact',
        insight: 'An unattributed claim.',
        seoRelevance: null,
        confidence: 1,
        citation: null,
        extractionMethod: null,
        extractionModel: null,
      }),
    /No retrieval, no finding/,
  );

  const retrieval = webRepo.recordRetrieval({
    webSourceId: source.id,
    url: 'https://provenance.example/article',
    httpStatus: 200,
    contentType: 'text/html',
    contentHash: 'abc123',
    title: 'A page',
    retrievalMethod: 'http_get',
    robotsAllowed: true,
    notes: null,
  });

  const finding = webRepo.recordWebFinding({
    retrievalId: retrieval.id,
    topic: 'packs',
    findingType: 'fact',
    insight: 'Torso length determines pack fit.',
    seoRelevance: 'Supports the fit section.',
    confidence: 0.9,
    citation: 'Provenance Source, retrieved page',
    extractionMethod: 'manual',
    extractionModel: null,
  });

  // The source and URL come from the retrieval, not from the caller.
  assert.equal(finding.webSourceId, source.id);
  assert.equal(finding.url, 'https://provenance.example/article');

  const attributed = webRepo.listAttributedFindings({ topic: 'packs' });
  assert.equal(attributed.length, 1);
  assert.equal(attributed[0].source.domain, 'provenance.example');
  assert.equal(attributed[0].retrieval.contentHash, 'abc123');
  assert.equal(attributed[0].retrieval.retrievedAt, retrieval.retrievedAt);
});

test('PROVENANCE: a retrieval cannot exist without an authorised source', () => {
  assert.throws(
    () =>
      webRepo.recordRetrieval({
        webSourceId: 999_999,
        url: 'https://not-authorised.example/page',
        httpStatus: 200,
        contentType: null,
        contentHash: null,
        title: null,
        retrievalMethod: 'http_get',
        robotsAllowed: null,
        notes: null,
      }),
    /must belong to a configured web source/,
  );
});

test('BACKLINKS: an opportunity starts unapproved and needs a human decision', () => {
  const article = makeArticle('Backlink Target Budget Hiking Backpack Guide', GOOD_BODY);

  const opportunity = webRepo.createBacklinkOpportunity({
    targetArticleId: article.id,
    webSourceId: null,
    sourceDomain: 'partner.example',
    sourceUrl: 'https://partner.example/gear-roundup',
    anchorSuggestion: 'budget hiking backpack guide',
    relevance: 'Their roundup covers the same packs.',
    authoritySignal: null,
    authoritySource: null,
    evidenceRetrievalId: null,
    notes: null,
    origin: 'manual',
  });

  assert.equal(opportunity.status, 'discovered');
  assert.equal(opportunity.origin, 'manual', 'there is no discovery engine yet');

  const approved = webRepo.setBacklinkStatus(opportunity.id, 'approved')!;
  assert.equal(approved.status, 'approved');
  assert.ok(approved.decidedAt, 'the decision is timestamped');

  // The article body is not touched by approving a backlink.
  assert.equal(articles.getArticleById(article.id)!.generated!.content, GOOD_BODY);
});

test('BACKLINKS: an authority figure without a source is refused', () => {
  const article = makeArticle('Authority Signal Budget Hiking Backpack Guide', GOOD_BODY);

  assert.throws(
    () =>
      webRepo.createBacklinkOpportunity({
        targetArticleId: article.id,
        webSourceId: null,
        sourceDomain: 'unsourced.example',
        sourceUrl: null,
        anchorSuggestion: null,
        relevance: null,
        authoritySignal: 'DA 72',
        authoritySource: null,
        evidenceRetrievalId: null,
        notes: null,
        origin: 'manual',
      }),
    /must state where it came from/,
  );
});

/* ====================== the CMS SEO adapter ============================= */

test('CMS: no SEO plugin is hardcoded, and nothing is sent when Cynth holds nothing', () => {
  assert.deepEqual(listSeoFieldMappings(), [], 'no plugin mapping is registered');

  const bare = makeArticle('No Metadata Budget Hiking Backpack Guide', GOOD_BODY);
  assert.equal(buildCmsSeoMetadata(articles.getArticleById(bare.id)!), null, 'nothing to send, so nothing is sent');
});

test('CMS: only human-owned SEO metadata travels, and unapproved links do not', async () => {
  nextResponse = JSON.stringify(AI_RESPONSE);
  const article = makeArticle('CMS Metadata Budget Hiking Backpack Guide', GOOD_BODY);
  configure(article.id);
  await analysis.runSeoAnalysis(article.id, { includeAi: true });

  // Proposals exist, but nothing has been approved.
  const beforeApproval = buildCmsSeoMetadata(articles.getArticleById(article.id)!);
  assert.equal(beforeApproval?.seoTitle ?? null, null, 'a proposed title is not metadata');
  assert.equal(beforeApproval?.internalLinks?.length ?? 0, 0, 'unapproved links do not travel');

  seoRepo.saveSeoMetadata(article.id, {
    seoTitle: 'Budget Hiking Backpacks That Fit',
    metaDescription: 'Torso length, capacity and where cheap packs fail.',
    seoSlug: null,
    canonicalUrl: null,
    structuredDataTypes: [],
    structuredData: null,
  });

  const links = seoRepo.listInternalLinksForArticle(article.id);
  if (links.length) seoRepo.setInternalLinkStatus(links[0].id, 'approved');

  const metadata = buildCmsSeoMetadata(articles.getArticleById(article.id)!)!;
  assert.equal(metadata.seoTitle, 'Budget Hiking Backpacks That Fit');
  assert.equal(metadata.targetQuery, 'budget hiking backpack');
  assert.equal(metadata.structuredData, null, 'unaccepted structured data does not travel');

  if (links.length) {
    assert.equal(metadata.internalLinks!.length, 1);
    assert.equal(metadata.internalLinks![0].approved, true, 'and every link that travels is approved');
  }
});

/* ====================== the overview ==================================== */

test('OVERVIEW: reading the SEO state runs nothing and costs nothing', () => {
  const before = providerCalls;
  const article = makeArticle('Overview Budget Hiking Backpack Guide', GOOD_BODY);
  configure(article.id);

  const overview = analysis.getSeoOverview(article.id);

  assert.equal(providerCalls, before, 'opening the SEO screen contacts no provider');
  assert.equal(overview.latestRun, null, 'and runs no analysis');
  assert.equal(overview.gate.ready, false, 'it reports the gate honestly');
  assert.ok(overview.structuredData.length > 0, 'structured-data eligibility is free to compute');
  assert.equal(overview.editorial.themeName, 'Hiking Gear', 'the editorial context is shown');
  assert.equal(overview.editorial.topicTitle, 'Budget Backpacks');
  assert.ok(overview.aiPreflight.cost !== null, 'and what an AI pass would cost is stated up front');
});


/* ------------------------------------------------------------------------
 * Registered LAST on purpose.
 *
 * These tests create several articles about budget hiking backpacks, and
 * the internal-link tests rank candidates across every article in the
 * database. Registering these first crowded that ranking and made an
 * unrelated test fail — so they run after everything that reads the shared
 * article pool.
 * --------------------------------------------------------------------- */

/* ==================== AI search readiness (Milestone 34) ================= */

/**
 * A section comfortably inside the citable band, opening with its answer.
 *
 * Its first sentence is a definition of the target query on purpose: that
 * is the sentence an answer engine lifts, and several tests below depend on
 * this passage being the well-formed case.
 */
const CITABLE_SECTION = [
  'A budget hiking backpack is a pack under two hundred pounds that carries load on the hips rather than the shoulders.',
  'That single distinction matters more than fabric, brand or capacity, because a pack that loads the shoulders will hurt at hour four whatever it cost.',
  'Check the hip belt wraps the iliac crest with two fingers of belt above it, and that the shoulder straps meet the frame between the shoulder blades rather than above them.',
  'Torso length is measured from the seventh vertebra to the top of the hips, and it is the only number that decides fit.',
  'Capacity is chosen after torso length, never before it, and forty five litres covers a weekend for most people carrying their own shelter.',
  'Stitching at the load-bearing points is where a cheap pack fails first, so look at the bartacks where the straps meet the body before looking at anything else.',
  'A pack that fits and is cheap will out-carry an expensive one that does not fit, every time, on every trail.',
].join(' ');

test('AI SEARCH: a passage that stands on its own raises no citability finding', () => {
  const article = makeArticle('Budget hiking backpack guide', [
    '# Budget hiking backpack guide',
    '',
    '## What a budget hiking backpack is',
    '',
    CITABLE_SECTION,
  ].join('\n'));
  configure(article.id);

  const found = codes(deterministicFor(article.id).findings);
  assert.ok(!found.includes('passage_too_thin_to_quote'), 'a full passage is not thin');
  assert.ok(!found.includes('passage_answer_buried'), 'nor is it buried');
  assert.ok(!found.includes('passage_opens_with_preamble'));
  assert.ok(!found.includes('passage_opens_dependently'));
  // It opens by defining the target query, which is the sentence an answer
  // engine lifts.
  assert.ok(!found.includes('no_definition_statement'));
});

test('AI SEARCH: a section too short to answer anything is reported', () => {
  const article = makeArticle('Budget hiking backpack guide', [
    '# Budget hiking backpack guide',
    '',
    '## What a budget hiking backpack is',
    '',
    CITABLE_SECTION,
    '',
    '## Capacity',
    '',
    'Forty five litres is usually enough.',
  ].join('\n'));
  configure(article.id);

  const thin = deterministicFor(article.id).findings.find((f) => f.code === 'passage_too_thin_to_quote');
  assert.ok(thin, 'a six-word section cannot answer anything on its own');
  assert.equal(thin!.dimension, 'ai_search');
  assert.equal(thin!.category, 'citability');
  assert.match(thin!.summary, /Capacity/);
  // Advice, never a blocker: this is a judgement about reach, not correctness.
  assert.equal(thin!.severity, 'recommendation');
});

test('AI SEARCH: a section that opens by announcing itself is reported', () => {
  const article = makeArticle('Budget hiking backpack guide', [
    '# Budget hiking backpack guide',
    '',
    '## What a budget hiking backpack is',
    '',
    CITABLE_SECTION,
    '',
    '## Fitting the pack',
    '',
    'In this section we will look at how to fit a pack properly. ' + CITABLE_SECTION,
  ].join('\n'));
  configure(article.id);

  const found = deterministicFor(article.id).findings.find((f) => f.code === 'passage_opens_with_preamble');
  assert.ok(found, 'an opening that describes the section is not an answer');
  assert.match(found!.summary, /Fitting the pack/);
});

test('AI SEARCH: a section that opens by pointing upward is reported', () => {
  const article = makeArticle('Budget hiking backpack guide', [
    '# Budget hiking backpack guide',
    '',
    '## What a budget hiking backpack is',
    '',
    CITABLE_SECTION,
    '',
    '## Why it matters',
    '',
    'This is why the hip belt decides everything else about the pack. ' + CITABLE_SECTION,
  ].join('\n'));
  configure(article.id);

  const found = deterministicFor(article.id).findings.find((f) => f.code === 'passage_opens_dependently');
  assert.ok(found, 'quoted alone, "This" has nothing to point at');
  assert.match(found!.summary, /Why it matters/);
});

test('AI SEARCH: a noun after the demonstrative is self-contained, and is not reported', () => {
  // The narrow half of the rule. "This pack is..." carries its own subject;
  // "This is why..." does not. Flagging both would make the check noise.
  const article = makeArticle('Budget hiking backpack guide', [
    '# Budget hiking backpack guide',
    '',
    '## What a budget hiking backpack is',
    '',
    CITABLE_SECTION,
    '',
    '## Frame stiffness',
    '',
    'This stiffness is what transfers load to the hips. ' + CITABLE_SECTION,
  ].join('\n'));
  configure(article.id);

  const found = codes(deterministicFor(article.id).findings);
  assert.ok(!found.includes('passage_opens_dependently'), 'a demonstrative with a noun is self-contained');
});

test('AI SEARCH: an article that never says what its subject IS is reported', () => {
  const article = makeArticle('Budget hiking backpack guide', [
    '# Budget hiking backpack guide',
    '',
    '## Choosing one',
    '',
    'Load carries on the hips rather than the shoulders, and that distinction '
      + 'matters more than fabric or brand. Check the hip belt wraps the iliac '
      + 'crest with two fingers of belt above it, and that the shoulder straps '
      + 'meet the frame between the shoulder blades. Torso length is measured '
      + 'from the seventh vertebra to the top of the hips, and it is the only '
      + 'number that decides fit. Capacity follows torso length, never the '
      + 'other way round, and forty five litres covers a weekend for most '
      + 'people carrying their own shelter. Stitching at the load-bearing '
      + 'points is where a cheap pack fails first, so look at the bartacks '
      + 'before anything else on the pack.',
  ].join('\n'));
  configure(article.id);

  const found = deterministicFor(article.id).findings.find((f) => f.code === 'no_definition_statement');
  assert.ok(found, 'nothing here answers "what is a budget hiking backpack?"');
  assert.match(found!.summary, /budget hiking backpack/);
  assert.equal(found!.dimension, 'ai_search');
});

test('AI SEARCH: the dimension weights still sum to 100', () => {
  // A guard, not a formality. Adding a dimension without taking the weight
  // from somewhere silently rescales every previously recorded score.
  const total = Object.values(SEO_DIMENSION_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  assert.equal(total, 100);
  assert.ok(SEO_DIMENSION_WEIGHTS.ai_search > 0, 'the new dimension actually counts');
});
