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
import { withEmbeddings } from './helpers/embeddingStub.js';
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
const direction = await import('../src/features/images/imageDirection.service.js');
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
const SCENE =
  'Morning light falls across a chipped kitchen counter where a portafilter rests beside a scattering of spent grounds.';

/**
 * Two shapes, because there are now two kinds of call.
 *
 * The art director is a TEXT model and the image model is an image model, so a
 * stub that answered everything with image bytes would silently push every
 * test down the deterministic fallback path — passing while proving nothing.
 */
const defaultBody = (request: Record<string, unknown>) => {
  if (Array.isArray(request.messages)) {
    return { choices: [{ message: { content: SCENE } }], usage: { prompt_tokens: 200, completion_tokens: 40 } };
  }

  const count = Number(request.n) || 1;
  return {
    created: 1,
    data: Array.from({ length: count }, () => ({ b64_json: PIXEL_PNG, media_type: 'image/png' })),
    usage: { prompt_tokens: 0, completion_tokens: 4175 * count, total_tokens: 4175 * count, cost: 0.04 * count },
  };
};

let stubBody: (request: Record<string, unknown>) => unknown = defaultBody;

globalThis.fetch = withEmbeddings((async (input: string | URL | Request, init?: RequestInit) => {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  stubCalls.push({
    url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    body,
  });
  return new Response(JSON.stringify(stubBody(body)), {
    status: stubStatus,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch);

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

/**
 * The art director's model. FREE on purpose: choosing what an image shows is
 * short-copy work, and making it paid would put a second spend gate in front
 * of every image.
 */
const directorId = Number(
  db
    .prepare(
      `INSERT INTO ai_provider_models (provider_id, model_name, is_enabled, prompt_price, completion_price, is_free, cost_tier)
       VALUES (?, 'stub/director', 1, 0, 0, 1, 'free')`,
    )
    .run(providerId).lastInsertRowid,
);
capabilities.setCapabilities(directorId, ['image_direction']);
capabilities.setDefaultForPurpose(directorId, 'image_direction');

/* -------------------------------------------------------------- prompt --- */

test('PROMPT: the image model is given a scene, not a specification', async () => {
  // The change this protects (Milestone 40). The prompt used to be a document
  // of headed sections and prohibitions handed to a diffusion model, which
  // weights tokens rather than parsing documents — so half of it diluted the
  // subject and the negations pushed "product, brand, logo" INTO the
  // conditioning. An art director now chooses the scene and the image model
  // is only asked to photograph it.
  const brief = await imagePrompt.buildFeaturedImagePrompt(article.id);
  assert.ok(!('error' in brief));
  const { prompt, basis } = brief as { prompt: string; basis: { scene: string | null; directedBy: string | null } };

  assert.equal(basis.scene, SCENE, 'the scene came from the director');
  assert.equal(basis.directedBy, 'stub/director', 'and the brief says which model chose it');
  assert.ok(prompt.startsWith(SCENE), 'the scene leads the prompt');

  // The negation list is GONE from what the image model receives. If it comes
  // back, the images regress to the clichés this milestone fixed.
  assert.doesNotMatch(prompt, /Do not depict any identifiable real-world product/i);
  assert.doesNotMatch(prompt, /brand, logo, packaging or trademark/i);
  assert.doesNotMatch(prompt, /=== HARD RULES ===/);
  assert.doesNotMatch(prompt, /=== STYLE ===/);

  // One negative clause is kept deliberately: unlike a brand, invented
  // lettering cannot be prevented upstream.
  assert.match(prompt, /No text, letters, numbers or signage/i);
});

test('PROMPT: the constraints moved to the director, which can actually honour them', async () => {
  // They were not relaxed. They were moved to the stage that understands
  // them — a language model obeys "do not name a real product"; a diffusion
  // model effectively cannot.
  const before = stubCalls.length;
  await imagePrompt.buildFeaturedImagePrompt(article.id);

  const directorPrompt = String(
    (stubCalls.slice(before).find((call) => Array.isArray(call.body.messages))?.body.messages as
      | { content: string }[]
      | undefined)?.[0]?.content ?? '',
  );
  assert.ok(directorPrompt, 'the director ran');

  assert.match(directorPrompt, /branded or identifiable commercial product/i);
  assert.match(directorPrompt, /Do not include text, signage/i);
  assert.match(directorPrompt, /recognisable real person/i);

  // And the anti-cliché list, which is the other half of the fix: a generic
  // "avoid clichés" does nothing, because the model does not know which ones
  // it reaches for.
  assert.match(directorPrompt, /floating brain/i);
  assert.match(directorPrompt, /lightbulb representing an idea/i);

  // The text rule has to reach the SCENE choice, not just the image model.
  // The first real generation proved why: the director picked a stack of
  // paperbacks and the image model rendered gibberish on every spine.
  assert.match(directorPrompt, /spines turned away/i);

  // And the other rule real generations forced: an object named only by its
  // category is drawn as the most common thing that word means. "A thin
  // silver ring" for a sleep-tracking article produced a wedding band on a
  // pillow beside a sleeping person — the scene as written, and an article
  // about a marriage ending as read.
  assert.match(directorPrompt, /shape and material/i);
  assert.match(directorPrompt, /becomes a wedding band/i);

  // Two more rules that real generations forced, each protecting a specific
  // failure: a studio-lit device on a bare surface (a shop listing, not a
  // photograph), and hands mid-fine-manipulation (where image models still
  // come apart).
  assert.match(directorPrompt, /would work as a shop listing/i);
  assert.match(directorPrompt, /fine manipulation/i);
  assert.match(directorPrompt, /only works with its lettering visible/i);

  // It knows what the article argues, not just its title.
  assert.match(directorPrompt, /Why Your Espresso Tastes Sour/);
  assert.match(directorPrompt, /Home Coffee/);
});

test('PROMPT: an article with nothing to draw about is refused rather than left to the model', async () => {
  const empty = makeArticle(null, null);
  const brief = await imagePrompt.buildFeaturedImagePrompt(empty.id);
  assert.ok('error' in brief);
  assert.match((brief as { error: string }).error, /no title or topic/i);
});

test('PROMPT: a director that cannot run degrades the image rather than removing the feature', async () => {
  // A missing or broken direction model must not make featured images
  // unavailable — but the brief has to SAY the fallback was used, or a poor
  // image is untraceable.
  const previous = stubBody;
  stubBody = () => ({ error: { message: 'no' } });
  stubStatus = 500;
  try {
    const brief = await imagePrompt.buildFeaturedImagePrompt(article.id);
    assert.ok(!('error' in brief));
    const { prompt, basis } = brief as { prompt: string; basis: { scene: string | null; directedBy: string | null } };
    assert.equal(basis.scene, null, 'the brief admits no scene was chosen');
    assert.equal(basis.directedBy, null);
    assert.match(prompt, /environmental photograph/i, 'and a usable prompt is still produced');
  } finally {
    stubBody = previous;
    stubStatus = 200;
  }
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

test('TEXT: the no-text clause and the lettering bans lift together', async () => {
  /**
   * The ban is a property of the MODEL, not of the publication. Every image
   * model Cynth has used garbles lettering, which is why the director keeps
   * book spines turned away, labels out of shot and paper out of frame
   * entirely — rules that cost most of the scenes a product publication would
   * naturally shoot. On a model that can spell, they should all come off at
   * once; lifting the image model's clause while the director still refuses to
   * choose a scene with a label in it would change nothing.
   */
  const before = stubCalls.length;
  const brief = await imagePrompt.buildFeaturedImagePrompt(article.id, null, 'photograph', null, true);
  assert.ok(!('error' in brief));
  const prompt = (brief as { prompt: string }).prompt;

  assert.doesNotMatch(prompt, /No text, letters, numbers or signage/i, 'the image model is no longer told to avoid text');

  const directorPrompt = String(
    (stubCalls.slice(before).find((call) => Array.isArray(call.body.messages))?.body.messages as
      | { content: string }[]
      | undefined)?.[0]?.content ?? '',
  );
  assert.match(directorPrompt, /Text is allowed in this image/i);
  assert.doesNotMatch(directorPrompt, /spines turned away/i, 'the scene rules lift with it');
  assert.doesNotMatch(directorPrompt, /No printed sheet, form, invoice/i);

  // The one rule that does NOT lift. A real brand name is a claim about a
  // product, not a rendering problem, so no model's competence excuses it.
  assert.match(directorPrompt, /never a real brand name or logo/i);
});

test('TEXT: the printed-matter guard stands down rather than fighting the request', async () => {
  // Otherwise an editor who asked for a labelled tub would have the director
  // re-rolled three times for saying "label", and be charged for whatever the
  // third attempt produced.
  const brief = await imagePrompt.buildFeaturedImagePrompt(
    article.id,
    null,
    'photograph',
    'A receipt curls on the counter beside a cold cup.',
    true,
  );
  assert.ok(!('error' in brief));
  assert.equal((brief as { basis: { concern?: string | null } }).basis.concern, null);
});

test('TEXT: off by default, so nothing changes for the current model', async () => {
  const brief = await imagePrompt.buildFeaturedImagePrompt(article.id);
  assert.ok(!('error' in brief));
  assert.match((brief as { prompt: string }).prompt, /No text, letters, numbers or signage/i);
});


test('SCENE: a scene the editor approved is drawn as given, without re-running the director', async () => {
  /**
   * Reported after three paid attempts produced three unrelated pictures.
   * Previewing the prompt and drawing it were two separate runs of the art
   * director, so the scene an editor read was never the scene drawn — which
   * on an article with no obvious image made "try again" a four-cent lottery.
   */
  const approved = 'A dog sits beside an empty bowl in a kitchen, looking up at a feeder that is switched off.';
  const before = stubCalls.length;

  const brief = await imagePrompt.buildFeaturedImagePrompt(article.id, null, 'photograph', approved);
  assert.ok(!('error' in brief));
  const { prompt, basis } = brief as { prompt: string; basis: { scene: string | null; directedBy: string | null } };

  assert.equal(basis.scene, approved, 'the approved scene is used verbatim');
  assert.equal(basis.directedBy, null, 'and the brief says no model chose it');
  assert.ok(prompt.startsWith(approved));
  assert.equal(stubCalls.length, before, 'the director was not called at all');
});

test('SCENE: an approved scene is still checked for printed matter', async () => {
  // Skipping the director must not skip the guard. An editor pasting a scene
  // with a receipt in it should be told, not quietly charged for an image full
  // of garbled lettering.
  const brief = await imagePrompt.buildFeaturedImagePrompt(
    article.id,
    null,
    'photograph',
    'A receipt curls on the counter beside a cold cup.',
  );
  assert.ok(!('error' in brief));
  const basis = (brief as { basis: { concern?: string | null } }).basis;
  assert.match(String(basis.concern), /receipt/i);
});

test('DIRECTION: the rules for an argument with no physical form are in the prompt', async () => {
  // The failure: an article about three years of subscription fees and what
  // stops working when you cancel. Asked three times, the director returned
  // the same feeder on the same kitchen table — the topic photographed, the
  // argument absent. There is no object that means "thirty-six payments".
  const before = stubCalls.length;
  await imagePrompt.buildFeaturedImagePrompt(article.id);

  const directorPrompt = String(
    (stubCalls.slice(before).find((call) => Array.isArray(call.body.messages))?.body.messages as
      | { content: string }[]
      | undefined)?.[0]?.content ?? '',
  );

  assert.match(directorPrompt, /Show the CONSEQUENCE instead/i);
  assert.match(directorPrompt, /photographing the topic rather than the argument/i);
  // And the house cliché that eight articles in one day converged on.
  assert.match(directorPrompt, /single object resting on a kitchen table or counter/i);
});


test('STYLE: an illustration is asked for as a drawing, not as a photograph', async () => {
  // Why this exists: an editor asked for a person deciding whether to keep
  // paying, with a thought bubble over their head holding the device. A
  // thought bubble is not a photographable object, and the prompt ended
  // "editorial photograph, natural light, shallow depth of field" — so the
  // image model was being asked for a real room with a cartoon pasted into it.
  const brief = await imagePrompt.buildFeaturedImagePrompt(article.id, null, 'illustration');
  assert.ok(!('error' in brief));
  const prompt = (brief as { prompt: string }).prompt;

  assert.match(prompt, /Editorial illustration/i);
  assert.match(prompt, /Drawn throughout/i);
  assert.doesNotMatch(prompt, /Editorial photograph/i);
  assert.doesNotMatch(prompt, /shallow depth of field/i);

  // The one negative clause survives the switch: a drawn sign is still
  // garbled lettering.
  assert.match(prompt, /No text, letters, numbers or signage/i);
});

test('STYLE: a photograph is still the default, so nothing changes unless asked', async () => {
  const brief = await imagePrompt.buildFeaturedImagePrompt(article.id);
  assert.ok(!('error' in brief));
  assert.match((brief as { prompt: string }).prompt, /Editorial photograph/i);
});

test('STYLE: the director is told the editor overrules it', async () => {
  // It quietly did the opposite. Asked for a thought bubble, it chose "their
  // gaze raised toward a band resting on the windowsill" — its own preference
  // for the photographable, over the instruction it was given.
  const before = stubCalls.length;
  await imagePrompt.buildFeaturedImagePrompt(article.id, 'a thought bubble above her head', 'illustration');

  const directorPrompt = String(
    (stubCalls.slice(before).find((call) => Array.isArray(call.body.messages))?.body.messages as
      | { content: string }[]
      | undefined)?.[0]?.content ?? '',
  );
  assert.match(directorPrompt, /The editor asks for: a thought bubble above her head/);
  assert.match(directorPrompt, /That instruction is binding/i);
  assert.match(directorPrompt, /briefing the illustration/i);
  assert.match(directorPrompt, /Thought bubbles, cutaways/i);
});

test('DIRECTION: an empty answer is retried rather than costing a worse image', async () => {
  // Observed on a real generation. The free model returned nothing, the
  // director threw, and the whole article fell to the deterministic prompt —
  // which then spent four cents on "a quiet environmental photograph
  // suggesting the setting of…", with "no people in focus" contradicting the
  // editor's own request. Retrying costs nothing.
  const previous = stubBody;
  let call = 0;
  stubBody = (request: Record<string, unknown>) => {
    if (Array.isArray(request.messages)) {
      call += 1;
      return call === 1 ? { choices: [{ message: { content: '' } }] } : previous(request);
    }
    return previous(request);
  };

  try {
    const brief = await imagePrompt.buildFeaturedImagePrompt(article.id);
    assert.ok(!('error' in brief));
    const basis = (brief as { basis: { scene: string | null } }).basis;
    assert.equal(basis.scene, SCENE, 'the second attempt was used');
    assert.equal(call, 2, 'and it took exactly one retry');
  } finally {
    stubBody = previous;
  }
});


test('DIRECTION: a scene that names something printed is caught before anything is paid for', () => {
  // The generation that forced this: "a printed subscription sheet edged with
  // dates" came back from a director that had just been told, twice, not to
  // put lettering in the frame. The image model filled half the frame with
  // mirrored gibberish and printed an invented brand name on the appliance.
  //
  // Asking the director again is free. The image is four cents. That
  // asymmetry is the whole argument for checking rather than trusting.
  assert.match(
    String(direction.findTextRisk('A printed subscription sheet edged with dates beside a stack of envelopes.')),
    /printed/i,
  );
  assert.match(String(direction.findTextRisk('A receipt curling on the counter.')), /receipt/i);
  assert.match(String(direction.findTextRisk('A glowing screen on the far wall.')), /glowing screen/i);
  assert.match(String(direction.findTextRisk('A shop sign above the door.')), /sign/i);
});

test('DIRECTION: the check does not reject good scenes over words that carry no print', () => {
  // The expensive mistake here is the opposite one. A check that rejects clean
  // scenes costs a good photograph every time and is invisible when it does —
  // so the words that nearly cost us one are pinned.
  assert.equal(direction.findTextRisk('A crumpled cotton sheet across an unmade bed at first light.'), null);
  assert.equal(direction.findTextRisk('A laptop propped on a stack of old paperbacks, spines turned away.'), null);
  assert.equal(direction.findTextRisk('A paper towel folded beside a chipped mug.'), null);
  assert.equal(direction.findTextRisk('A dark screen angled away from the window.'), null);
  assert.equal(direction.findTextRisk('There is no sign of anyone having been there.'), null);
});


test('GENERATE: asking for nothing in particular draws ONE image, not three', async () => {
  // The default is a spending decision, so it is asserted rather than left to
  // whatever the caller happens to pass.
  //
  // It used to be three, which promised a choice that did not arrive: Seedream
  // returns one image per request whatever `n` says. And now that the art
  // director picks the scene, further candidates are the same scene redrawn,
  // not competing ideas — so on a provider that DOES honour `n`, three would be
  // three charges for three near-identical photographs.
  settings.setSetting('generation.mode', 'production');
  const result = await images.generateFeaturedImages(article.id, { confirmedCost: true });

  assert.equal(stubCalls[stubCalls.length - 1].body.n, 1);
  assert.equal(result.candidates.length, 1);
});

test('GENERATE: the confirmation names the number that will actually be drawn', async () => {
  // It read MAX_CANDIDATES, so an unspecified count asked the editor to approve
  // four images and then drew one. Approving a figure you are not charged is
  // the wrong way round even when it errs cheap.
  settings.setSetting('generation.mode', 'production');

  await assert.rejects(
    () => images.generateFeaturedImages(article.id, {}),
    (error: { message: string }) => {
      assert.match(error.message, /\b1 image\(s\) will be generated\b/);
      return true;
    },
  );
});


test('GENERATE: the request is what OpenRouter documents, and the bytes become real files', async () => {
  settings.setSetting('generation.mode', 'production');
  const result = await images.generateFeaturedImages(article.id, { count: 3, confirmedCost: true });

  const call = stubCalls[stubCalls.length - 1];
  assert.match(call.url, /\/images$/, 'the images endpoint, not chat completions');
  assert.equal(call.body.model, 'stub/image-model');
  assert.equal(call.body.n, 3);
  assert.equal(call.body.aspect_ratio, '16:9');
  // The image model receives the SCENE, not the headline. Feeding an
  // editorial title to a diffusion model is one of the things that produced
  // the clichés this milestone removed — it has no visual content to render.
  assert.ok(String(call.body.prompt).includes(SCENE), 'the chosen scene leads the prompt');
  assert.ok(
    !String(call.body.prompt).includes('Why Your Espresso Tastes Sour'),
    'the headline is the input to the director, not to the image model',
  );

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

test('CANDIDATES: the previous batch is kept aside, not destroyed', async () => {
  /**
   * Why this changed. Deleting the last batch was right when a batch meant
   * three renderings of one idea — nobody wants to choose between candidates
   * built from two different prompts.
   *
   * It stopped being right once each generation became a deliberate, paid
   * attempt at a DIFFERENT idea. An editor asked to see the previous
   * suggestion to compare the two, and it no longer existed anywhere on disk.
   * Exactly one batch back is kept: enough to compare, not a folder that
   * grows forever with pictures nobody chose.
   */
  settings.setSetting('generation.mode', 'production');
  const subject = makeArticle('Kept Batch', 'Coffee');

  await images.generateFeaturedImages(subject.id, { count: 1, confirmedCost: true });
  const first = images.listCandidates(subject.id)[0];
  assert.ok(first, 'the first batch exists');

  await images.generateFeaturedImages(subject.id, { count: 1, confirmedCost: true });
  const second = images.listCandidates(subject.id);
  assert.equal(second.length, 1, 'the chooser holds only the new batch');
  assert.notEqual(second[0].id, first.id);

  const kept = images.listSuperseded(subject.id);
  assert.equal(kept.length, 1, 'and the previous one is still on disk');
  assert.equal(kept[0].id, first.id);

  // A third generation replaces what is kept rather than piling up.
  await images.generateFeaturedImages(subject.id, { count: 1, confirmedCost: true });
  const keptAgain = images.listSuperseded(subject.id);
  assert.equal(keptAgain.length, 1, 'still exactly one batch back');
  assert.equal(keptAgain[0].id, second[0].id);
});

test('CANDIDATES: a kept image can still be chosen, and discarding takes it too', async () => {
  settings.setSetting('generation.mode', 'production');
  const subject = makeArticle('Chose The Old One', 'Coffee');

  await images.generateFeaturedImages(subject.id, { count: 1, confirmedCost: true });
  const first = images.listCandidates(subject.id)[0];
  await images.generateFeaturedImages(subject.id, { count: 1, confirmedCost: true });

  // The whole point: the editor preferred the earlier idea.
  const result = images.selectCandidate(subject.id, first.id);
  assert.ok(!('error' in result), 'the kept image is selectable');
  assert.equal(images.listSuperseded(subject.id).length, 0, 'and nothing is left behind');
  assert.equal(images.listCandidates(subject.id).length, 0);

  // Discarding means discarding — the kept copy is not a back door.
  await images.generateFeaturedImages(subject.id, { count: 1, confirmedCost: true });
  await images.generateFeaturedImages(subject.id, { count: 1, confirmedCost: true });
  assert.equal(images.listSuperseded(subject.id).length, 1);
  images.discardCandidates(subject.id);
  assert.equal(images.listSuperseded(subject.id).length, 0);
  assert.equal(images.listCandidates(subject.id).length, 0);
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
