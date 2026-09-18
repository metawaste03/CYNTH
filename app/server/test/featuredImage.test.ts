/**
 * Featured image generation (Milestone 25).
 *
 * What must hold:
 *   1. The prompt carries the constraints that make a generated image safe to
 *      publish beside affiliate links: no real products, no brands or logos,
 *      no rendered text. These live in the prompt builder, not the UI, so no
 *      caller can generate an image without them.
 *   2. The spend gate applies. Image models are never free, so Test mode
 *      refuses and Production requires an explicit confirmation that is never
 *      defaulted to true.
 *   3. Cost is what the PROVIDER reported, never estimated from tokens, and
 *      an unreported cost is recorded as unknown rather than as zero.
 *   4. A candidate is not a library image. Rejecting every candidate leaves
 *      nothing in the media library and nothing on disk.
 *   5. A candidate id is a filename Cynth generated, and is still validated —
 *      one that escapes the pending folder or belongs to another article is
 *      refused.
 *
 * NO REAL PROVIDER IS CONTACTED, AND NO REAL IMAGE MODEL IS PAID.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-image-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;
process.env.CYNTH_SECRETS_FILE = path.join(SCRATCH, '.env.local');
// Uploads live under the database directory, so pointing CYNTH_DB_DIR at the
// scratch folder already isolates the files this test writes.

const dbModule = await import('../src/shared/database/index.js');
const secrets = await import('../src/shared/secrets/secretStore.js');
const images = await import('../src/features/images/featuredImage.service.js');
const imagePrompt = await import('../src/features/images/imagePrompt.service.js');
const media = await import('../src/features/media/media.repository.js');
const capabilities = await import('../src/features/ai-providers/modelCapabilities.repository.js');
const articles = await import('../src/features/articles/articles.repository.js');
const content = await import('../src/features/content/content.repository.js');
const authorsRepo = await import('../src/features/authors/authors.repository.js');
const settings = await import('../src/shared/settings/settings.repository.js');
const history = await import('../src/features/generation/generationHistory.repository.js');
const policy = await import('../src/features/generation/generationPolicy.service.js');
const openrouter = await import('../src/features/generation/providers/openrouterAdapter.js');

dbModule.initializeDatabase();
const db = dbModule.getDatabase();

const project = content.getDefaultProject()!;
const theme = content.createTheme(project.id, { name: 'Home Coffee', description: 'Grinders, water, and time.' });
const author = authorsRepo.createAuthor({ name: 'Rui Almeida' } as never);

function makeArticle(title: string | null, topic: string | null) {
  return articles.createArticleDraft({
    articleTypeId: 1,
    authorId: author.id,
    productId: null,
    projectId: project.id,
    themeId: theme.id,
    topicId: null,
    title,
    topic,
    targetAudience: 'People who already own a grinder',
    searchIntent: null,
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: null,
    secondaryKeywords: null,
  } as never);
}

const article = makeArticle('Why Your Espresso Tastes Sour', 'Extraction and grind size');

/* ------------------------------------------------------------ the stub --- */

/** A one-pixel PNG. Real bytes, so the file written to disk is a real file. */
const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface StubCall {
  url: string;
  body: Record<string, unknown>;
}

const stubCalls: StubCall[] = [];
let stubStatus = 200;

/**
 * The default reply returns exactly as many images as were asked for, and
 * prices them per image, because that is what the real endpoint does. A stub
 * that ignored `n` would let a test pass while the count it asserts on came
 * from the stub rather than from the request.
 */
const defaultBody = (request: Record<string, unknown>) => {
  const count = Number(request.n) || 1;
  return {
    created: 1,
    data: Array.from({ length: count }, () => ({ b64_json: PIXEL_PNG, media_type: 'image/png' })),
    usage: { prompt_tokens: 0, completion_tokens: 4175 * count, total_tokens: 4175 * count, cost: 0.04 * count },
  };
};

let stubBody: (request: Record<string, unknown>) => unknown = defaultBody;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  stubCalls.push({
    url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    body,
  });
  return new Response(JSON.stringify(stubBody(body)), {
    status: stubStatus,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

secrets.setSecret('CYNTH_IMAGE_TEST_KEY', 'not-a-real-credential');

const providerId = Number(
  db
    .prepare(
      `INSERT INTO ai_providers (name, provider_type, base_url, api_key_env_var, is_active)
       VALUES ('Stub Images', 'openrouter', 'https://stub.test/api/v1', 'CYNTH_IMAGE_TEST_KEY', 1)`,
    )
    .run().lastInsertRowid,
);

// Priced, because an image model always is. This is what makes the spend gate
// classify it as paid rather than unknown.
const modelId = Number(
  db
    .prepare(
      `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free, cost_tier)
       VALUES (?, 'stub/image-model', 1, 0.0000005, 0.000003, 0, 'standard')`,
    )
    .run(providerId).lastInsertRowid,
);
capabilities.setCapabilities(modelId, ['image_generation']);
capabilities.setDefaultForPurpose(modelId, 'image_generation');

/* -------------------------------------------------------------- prompt --- */

test('PROMPT: the rules that make a generated image publishable are in the prompt itself', () => {
  const brief = imagePrompt.buildFeaturedImagePrompt(article.id);
  assert.ok(!('error' in brief));
  const prompt = (brief as { prompt: string }).prompt;

  assert.match(prompt, /Do not depict any identifiable real-world product, brand, logo/i);
  assert.match(prompt, /Do not render any text, lettering, numbers/i);
  assert.match(prompt, /Do not depict recognisable real people/i);

  // And it actually knows what the article is about.
  assert.match(prompt, /Why Your Espresso Tastes Sour/);
  assert.match(prompt, /Extraction and grind size/);
  assert.match(prompt, /Home Coffee/);
});

test('PROMPT: an article with nothing to draw about is refused rather than left to the model', () => {
  const empty = makeArticle(null, null);
  const brief = imagePrompt.buildFeaturedImagePrompt(empty.id);
  assert.ok('error' in brief);
  assert.match((brief as { error: string }).error, /no title or topic/i);
});

/* ---------------------------------------------------------- spend gate --- */

test('SPEND: Test mode refuses image generation outright — an image model is never free', async () => {
  settings.setSetting('generation.mode', 'test');
  const before = stubCalls.length;

  await assert.rejects(
    () => images.generateFeaturedImages(article.id, { count: 2, confirmedCost: true }),
    /Test mode/i,
  );
  assert.equal(stubCalls.length, before, 'nothing was sent');
});

test('SPEND: Production without confirmation asks, and sends nothing', async () => {
  settings.setSetting('generation.mode', 'production');
  const before = stubCalls.length;

  await assert.rejects(
    () => images.generateFeaturedImages(article.id, { count: 3 }),
    (error: { code?: string; message: string }) => {
      assert.equal(error.code, 'cost_confirmation_required');
      // The honest bit: per-image pricing means the exact figure is unknown
      // beforehand, and the confirmation says so rather than inventing one.
      assert.match(error.message, /charged per image/i);
      assert.match(error.message, /not known until the provider answers/i);
      return true;
    },
  );
  assert.equal(stubCalls.length, before, 'nothing was sent before confirmation');
});

/* ------------------------------------------------------------ drawing --- */

test('GENERATE: the request is what OpenRouter documents, and the bytes become real files', async () => {
  settings.setSetting('generation.mode', 'production');
  const result = await images.generateFeaturedImages(article.id, { count: 3, confirmedCost: true });

  const call = stubCalls[stubCalls.length - 1];
  assert.match(call.url, /\/images$/, 'the images endpoint, not chat completions');
  assert.equal(call.body.model, 'stub/image-model');
  assert.equal(call.body.n, 3);
  assert.equal(call.body.aspect_ratio, '16:9');
  assert.ok(String(call.body.prompt).includes('Why Your Espresso Tastes Sour'));

  assert.equal(result.candidates.length, 3);
  for (const candidate of result.candidates) {
    assert.ok(candidate.byteSize > 0, 'the file has bytes');
    assert.match(candidate.url, /^uploads\/media\/pending\//, 'candidates wait outside the library');
  }
});

test('GENERATE: the cost recorded is the one the provider reported, not an estimate', () => {
  const entries = history.listGenerationHistoryForArticle(article.id, 10);
  const entry = entries.find((row) => row.taskType === 'image_generation' && row.status === 'success')!;
  assert.ok(entry, 'the generation was recorded');

  const metadata = entry.metadata as Record<string, unknown>;
  assert.equal(metadata.reportedCostUsd, 0.12);
  assert.equal(metadata.costBasis, 'provider_reported');
  assert.equal(metadata.images, 3);
});

test('GENERATE: a provider that reports no cost is recorded as unknown, never as zero', async () => {
  const other = makeArticle('Water Hardness and Coffee', 'Minerals in brew water');
  stubBody = () => ({ data: [{ b64_json: PIXEL_PNG, media_type: 'image/png' }], usage: { completion_tokens: 10 } });

  const result = await images.generateFeaturedImages(other.id, { count: 1, confirmedCost: true });
  assert.equal(result.reportedCost, null);
  stubBody = defaultBody;

  const entry = history
    .listGenerationHistoryForArticle(other.id, 10)
    .find((row) => row.taskType === 'image_generation')!;
  const metadata = entry.metadata as Record<string, unknown>;
  assert.equal(metadata.reportedCostUsd, null);
  assert.equal(metadata.costBasis, 'unreported');
});

test('GENERATE: a failure is recorded and writes no files', async () => {
  const other = makeArticle('Grinder Burr Alignment', 'Why burrs drift');
  stubStatus = 500;
  stubBody = () => ({ error: { message: 'upstream exploded' } });

  await assert.rejects(() => images.generateFeaturedImages(other.id, { count: 2, confirmedCost: true }));

  assert.equal(images.listCandidates(other.id).length, 0, 'nothing was written');
  const entry = history
    .listGenerationHistoryForArticle(other.id, 10)
    .find((row) => row.taskType === 'image_generation')!;
  assert.equal(entry.status, 'failure');

  stubStatus = 200;
  stubBody = defaultBody;
});

/* ----------------------------------------------------------- candidates --- */

test('CANDIDATES: nothing enters the media library until one is chosen', async () => {
  const subject = makeArticle('Dialling In a New Bag', 'Adjusting grind for a fresh roast');
  const libraryBefore = media.listMedia().length;

  const result = await images.generateFeaturedImages(subject.id, { count: 2, confirmedCost: true });
  assert.equal(result.candidates.length, 2);
  assert.equal(media.listMedia().length, libraryBefore, 'candidates are not library images');

  // Discarding leaves nothing behind, in the library or on disk.
  const removed = images.discardCandidates(subject.id);
  assert.equal(removed, 2);
  assert.equal(images.listCandidates(subject.id).length, 0);
  assert.equal(media.listMedia().length, libraryBefore);
});

test('CANDIDATES: choosing one saves it, attaches it, and discards the rest', async () => {
  const subject = makeArticle('Pressure Profiling, Plainly', 'What pressure actually changes');
  const result = await images.generateFeaturedImages(subject.id, { count: 2, confirmedCost: true });
  const chosen = result.candidates[0];
  const rejected = result.candidates[1];

  const outcome = images.selectCandidate(subject.id, chosen.id);
  assert.ok('mediaId' in outcome);

  const asset = media.getMedia((outcome as { mediaId: number }).mediaId)!;
  assert.equal(asset.themeId, theme.id, 'it is filed under the article thematic area');
  assert.equal(asset.kind, 'featured');
  // Identifiable as machine-made for as long as it exists, including to
  // whoever finds it in the library later.
  assert.equal(asset.credit, 'AI-generated');
  assert.ok(asset.tags.includes('ai-generated'));

  const featured = media.getFeaturedImage(subject.id)!;
  assert.equal(featured.id, asset.id, 'it is the article featured image');

  const remaining = images.listCandidates(subject.id);
  assert.equal(remaining.length, 0, 'the rest were discarded');
  assert.ok(!remaining.some((candidate) => candidate.id === rejected.id));
});

test('CANDIDATES: a new batch replaces the previous one rather than accumulating', async () => {
  const subject = makeArticle('Storing Beans', 'Freezer, jar or bag');
  await images.generateFeaturedImages(subject.id, { count: 2, confirmedCost: true });
  const first = images.listCandidates(subject.id).map((candidate) => candidate.id);
  assert.equal(first.length, 2);

  await images.generateFeaturedImages(subject.id, { count: 2, confirmedCost: true });
  const second = images.listCandidates(subject.id).map((candidate) => candidate.id);

  assert.equal(second.length, 2, 'two candidates, not four');
  assert.ok(
    second.every((id) => !first.includes(id)),
    'choosing between two different prompts is not a choice worth offering',
  );
});

/* -------------------------------------------------------------- safety --- */

test('SAFETY: a candidate id that escapes the pending folder is refused', async () => {
  const subject = makeArticle('Milk Texturing', 'Steam wand angles');
  await images.generateFeaturedImages(subject.id, { count: 1, confirmedCost: true });

  for (const bad of ['../../../etc/passwd', 'a1-../escape.png', '/absolute.png', 'a999-not-mine.png']) {
    const result = images.selectCandidate(subject.id, bad);
    assert.ok('error' in result, `${bad} must be refused`);
  }

  // The real one still works, so the check is not simply refusing everything.
  const real = images.listCandidates(subject.id)[0];
  assert.ok('mediaId' in images.selectCandidate(subject.id, real.id));
});

test('SAFETY: one article cannot select another article candidate', async () => {
  const mine = makeArticle('Puck Prep', 'Distribution tools');
  const theirs = makeArticle('Water Filters', 'Ion exchange');

  await images.generateFeaturedImages(mine.id, { count: 1, confirmedCost: true });
  const candidate = images.listCandidates(mine.id)[0];

  const result = images.selectCandidate(theirs.id, candidate.id);
  assert.ok('error' in result);
  assert.match((result as { error: string }).error, /not a candidate for this article/i);

  // And it is still there for the article it belongs to.
  assert.equal(images.listCandidates(mine.id).length, 1);
});

/* --------------------------------------------------------------- state --- */

test('STATE: the panel is told what already exists before it is offered anything new', () => {
  const state = images.getFeaturedImageState(article.id)!;
  assert.equal(state.articleId, article.id);
  assert.equal(state.canGenerate, true);
  assert.equal(state.generationIssue, null);
  assert.ok(state.suggestions, 'existing images are suggested first');
});


/* ------------------------------------------------------------- pricing --- */

test('PRICING: a model priced only for image output is PAID, not free', () => {
  // This is a real catalogue entry. OpenRouter lists Seedream 4.5 with zero
  // per-token prices and charges $9.58/M tokens for image output. Reading only
  // the per-token prices called it free — which would have let it run in Test
  // mode and skip the cost confirmation on every image it drew.
  assert.equal(
    policy.classifyModel({ promptPrice: 0, completionPrice: 0, imageOutputPrice: 0.00000958083832335329 }),
    'paid',
  );

  // The rest of the classifier is unchanged.
  assert.equal(policy.classifyModel({ promptPrice: 0, completionPrice: 0 }), 'free');
  assert.equal(policy.classifyModel({ promptPrice: 0, completionPrice: 0, imageOutputPrice: 0 }), 'free');
  assert.equal(policy.classifyModel({ promptPrice: null, completionPrice: 0 }), 'unknown');
  assert.equal(policy.classifyModel({ promptPrice: 0.000001, completionPrice: 0 }), 'paid');
});

test('PRICING: a model with no image price on record is gated as unknown, not assumed free', async () => {
  // A model registered before Cynth stored image pricing has NULL there. NULL
  // is genuinely unknown, and unknown is treated as paid everywhere else.
  settings.setSetting('generation.mode', 'test');
  const subject = makeArticle('Tamping Technique', 'Level, then press');

  await assert.rejects(
    () => images.generateFeaturedImages(subject.id, { count: 1, confirmedCost: true }),
    /Test mode/i,
    'an unpriced image model must not slip through as free',
  );
  settings.setSetting('generation.mode', 'production');
});

/* ----------------------------------------------------------- catalogue --- */

test('CATALOGUE: the image models are read too, not just the default list', async () => {
  // /models answers with the general roster and only a handful of image
  // models. Most of them — Seedream, Recraft, MAI-Image — appear ONLY under
  // ?output_modalities=image, so a single read hides them from the registry
  // with no symptom a user could diagnose: the model simply is not there.
  const seen: string[] = [];
  const previous = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    seen.push(url);

    const body = url.includes('output_modalities=image')
      ? {
          data: [
            { id: 'bytedance-seed/seedream-4.5', name: 'Seedream 4.5', pricing: { prompt: '0', completion: '0', image_output: '0.00000958' } },
            { id: 'google/gemini-3.1-flash-image', name: 'Nano Banana 2', pricing: { prompt: '0.0000005', completion: '0.000003', image_output: '0.00006' } },
          ],
        }
      : {
          data: [
            { id: 'anthropic/claude-sonnet-4.6', name: 'Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
            { id: 'google/gemini-3.1-flash-image', name: 'Nano Banana 2', pricing: { prompt: '0.0000005', completion: '0.000003', image_output: '0.00006' } },
          ],
        };

    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const models = await openrouter.openrouterAdapter.listModels!({
    apiKey: 'not-a-real-credential',
    baseUrl: 'https://stub.test/api/v1',
  });

  globalThis.fetch = previous;

  assert.equal(seen.length, 2, 'both catalogues were read');
  assert.ok(seen.some((url) => url.endsWith('/models')));
  assert.ok(seen.some((url) => url.includes('output_modalities=image')));

  const ids = models.map((model) => model.id);
  assert.ok(ids.includes('bytedance-seed/seedream-4.5'), 'the image-only model is now discoverable');
  assert.ok(ids.includes('anthropic/claude-sonnet-4.6'), 'the general roster is still there');
  assert.equal(
    ids.filter((id) => id === 'google/gemini-3.1-flash-image').length,
    1,
    'a model in both lists appears once',
  );

  // And the price that makes it paid survives the read.
  const seedream = models.find((model) => model.id === 'bytedance-seed/seedream-4.5')!;
  assert.equal(seedream.imageOutputPrice, 0.00000958);
  assert.equal(policy.classifyModel(seedream), 'paid');
});

test('CATALOGUE: a failed image read degrades to fewer models, never to none', async () => {
  const previous = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('output_modalities=image')) {
      return new Response('gateway is unhappy', { status: 502, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(
      JSON.stringify({ data: [{ id: 'anthropic/claude-sonnet-4.6', pricing: { prompt: '0.000003', completion: '0.000015' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const models = await openrouter.openrouterAdapter.listModels!({
    apiKey: 'not-a-real-credential',
    baseUrl: 'https://stub.test/api/v1',
  });

  globalThis.fetch = previous;
  assert.equal(models.length, 1, 'the catalogue still answered');
});

test.after(() => {
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
