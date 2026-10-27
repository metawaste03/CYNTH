/**
 * Article length (Milestone 26).
 *
 * EveryFiveDays is short-form. What must hold:
 *   1. Every template published now has a CEILING, and every ceiling is at or
 *      below the house maximum of 1,500 words.
 *   2. The house maximum is a setting, and the effective ceiling for an
 *      article is the LOWER of it and the template's own.
 *   3. The writer, the reviewer and validation are all told the same band. A
 *      writer told 1,500 and a validator checking 2,000 produces an article
 *      that is wrong by one of the two rules whatever it does.
 *   4. An over-long article is REPORTED, never truncated.
 *   5. Seeding never overwrites a published version, so an article that
 *      recorded v1 still resolves to the schema it was written to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = path.join(os.tmpdir(), `cynth-length-test-${process.pid}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
process.env.CYNTH_DB_DIR = SCRATCH;

const dbModule = await import('../src/shared/database/index.js');
const definitions = await import('../src/features/templates/templates.definitions.js');
const templates = await import('../src/features/templates/templates.repository.js');
const length = await import('../src/features/templates/articleLength.service.js');
const settings = await import('../src/shared/settings/settings.repository.js');

dbModule.initializeDatabase();

/* --------------------------------------------------------- the templates --- */

test('TEMPLATES: every template has a ceiling, and none exceeds the house maximum', () => {
  for (const definition of definitions.TEMPLATE_DEFINITIONS) {
    const schema = definition.contentSchema;
    assert.ok(schema.maxWords > 0, `${definition.templateId} has no ceiling`);
    assert.ok(
      schema.maxWords <= length.DEFAULT_MAX_WORDS,
      `${definition.templateId} allows ${schema.maxWords} words, above the ${length.DEFAULT_MAX_WORDS} house maximum`,
    );
    assert.ok(
      schema.minWords < schema.maxWords,
      `${definition.templateId} has a floor at or above its ceiling`,
    );
  }
});

test('TEMPLATES: the parts cannot sum past the whole', () => {
  // A template whose section minimums add up to more than its ceiling asks
  // for something impossible, and every article written to it fails
  // validation twice over.
  for (const definition of definitions.TEMPLATE_DEFINITIONS) {
    const required = definition.contentSchema.sections
      .filter((section) => section.required !== false)
      .reduce((total, section) => total + (section.minWords ?? 0), 0);

    assert.ok(
      required <= definition.contentSchema.maxWords,
      `${definition.templateId} requires ${required} words of sections but caps the article at ${definition.contentSchema.maxWords}`,
    );
  }
});

test('TEMPLATES: seeding never overwrites a published version', () => {
  // The invariant that matters on a database that has been used: an article
  // recording v1 must still resolve to the schema it was actually written to,
  // however many times the app restarts.
  //
  // A fresh database has no v1 — nothing was ever written to it — so one is
  // inserted here to stand for a real one, and the seeder is run again.
  const db = dbModule.getDatabase();
  db.prepare(
    `INSERT INTO article_templates
       (template_id, version, name, article_type_slug, description, content_schema, presentation_schema, is_default, is_active)
     VALUES ('ultimate-guide-v1', 1, 'Ultimate Guide', 'ultimate-guide', 'The original',
             '{"sections":[],"minWords":2000,"requiresFaq":true,"requiresSources":true}', '{}', 1, 1)`,
  ).run();

  templates.seedTemplates();

  const v1 = templates.getTemplate('ultimate-guide-v1', 1)!;
  assert.equal(v1.contentSchema.minWords, 2000, 'v1 keeps the length it was published with');
  assert.equal(v1.contentSchema.maxWords, undefined, 'and gains no ceiling it never had');

  const current = templates.getTemplate('ultimate-guide-v1')!;
  assert.equal(current.version, 2, 'the newest version is what a new article gets');
  assert.equal(current.contentSchema.maxWords, 1500);

  // And the old one is not left unbounded: the house limit applies to it.
  assert.equal(length.lengthBandFor(v1.contentSchema).maxWords, 1500);
});

test('TEMPLATES: a new article resolves to v2', () => {
  const template = templates.getDefaultTemplateForType('buying-guide')!;
  assert.equal(template.version, 2);
  assert.equal(template.contentSchema.maxWords, 1500);
});

/* ------------------------------------------------------------- the band --- */

test('BAND: the effective ceiling is the lower of the house limit and the template', () => {
  settings.setSetting(length.ARTICLE_MAX_WORDS_KEY, '1500');

  // Template is stricter than the house.
  const strict = length.lengthBandFor({ minWords: 800, maxWords: 1200 });
  assert.equal(strict.maxWords, 1200);
  assert.equal(strict.cappedByHouseLimit, false);

  // House is stricter than the template.
  settings.setSetting(length.ARTICLE_MAX_WORDS_KEY, '900');
  const capped = length.lengthBandFor({ minWords: 800, maxWords: 1200 });
  assert.equal(capped.maxWords, 900);
  assert.equal(capped.cappedByHouseLimit, true, 'the editor is told which rule bound');

  settings.setSetting(length.ARTICLE_MAX_WORDS_KEY, '1500');
});

test('BAND: a floor above the ceiling collapses rather than asking the impossible', () => {
  settings.setSetting(length.ARTICLE_MAX_WORDS_KEY, '600');
  const band = length.lengthBandFor({ minWords: 900, maxWords: 1500 });

  assert.equal(band.maxWords, 600);
  assert.equal(band.minWords, 600, 'it does not demand 900 words in a 600-word article');
  settings.setSetting(length.ARTICLE_MAX_WORDS_KEY, '1500');
});

test('BAND: a template with no ceiling of its own still gets the house one', () => {
  // v1 templates predate maxWords. They must not read as unbounded.
  const band = length.lengthBandFor({ minWords: 2000 });
  assert.equal(band.maxWords, 1500);
  assert.equal(band.cappedByHouseLimit, true);
});

test('BAND: the instruction given to a model states both ends and which is hard', () => {
  const text = length.describeLengthBand({ minWords: 900, maxWords: 1500, cappedByHouseLimit: false });
  assert.match(text, /between 900 and 1500 words/);
  assert.match(text, /hard ceiling/i);
  assert.match(text, /rather than padding/i);
});

/* ---------------------------------------------------------- the setting --- */

test('SETTING: the house maximum is stored, read back, and defaults sensibly', () => {
  settings.setSetting(length.ARTICLE_MAX_WORDS_KEY, '');
  assert.equal(length.getHouseMaxWords(), length.DEFAULT_MAX_WORDS, 'an unset value falls back to the default');
  assert.equal(length.DEFAULT_MAX_WORDS, 1500);

  const saved = length.setHouseMaxWords(1200);
  assert.ok('maxWords' in saved);
  assert.equal(length.getHouseMaxWords(), 1200);

  settings.setSetting(length.ARTICLE_MAX_WORDS_KEY, String(length.DEFAULT_MAX_WORDS));
});

test('SETTING: a value that would break every article is refused', () => {
  for (const bad of [0, 50, 100_000, Number.NaN]) {
    const result = length.setHouseMaxWords(bad);
    assert.ok('error' in result, `${bad} must be refused`);
  }
  assert.equal(length.getHouseMaxWords(), length.DEFAULT_MAX_WORDS, 'a refused value changes nothing');
});

test.after(() => {
  dbModule.closeDatabase();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});
