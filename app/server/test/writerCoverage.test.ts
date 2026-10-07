/**
 * A WRITER REPLY THAT SKIPS THE ARTICLE.
 *
 * Found in production, not in a test. A writer returned ONE section of the
 * nine its template requires — syntactically perfect JSON, correct title,
 * correct excerpt, `faq: []`, `sources: []`, one hero paragraph — and the
 * stage recorded SUCCESS. 2,028 output tokens where that template normally
 * draws 7,000 to 10,700.
 *
 * It surfaced only downstream, as a reviewer producing twice its usual volume
 * of corrections, and an editor noticing the reviewer was working too hard.
 * The template had carried a `required` flag per section all along; nothing
 * read it, and the only check was that at least ONE section came back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cynth-writer-'));
// CYNTH_DB_DIR, not CYNTH_DB_PATH. The wrong name is silently ignored,
// so the test runs against the REAL database and writes to it.
process.env.CYNTH_DB_DIR = scratch;

const dbModule = await import('../src/shared/database/index.js');
dbModule.initializeDatabase();

const { parseArticle } = await import('../src/features/pipeline/stages/generationStages.service.js');
const { getTemplate } = await import('../src/features/templates/templates.repository.js');

const template = getTemplate('comparison-v1', 2) ?? getTemplate('comparison-v1', 1);

function reply(sections: { key: string; heading: string; body: string }[]) {
  return JSON.stringify({
    title: 'Wrist vs Chest Strap Heart Rate Accuracy',
    excerpt: 'An excerpt.',
    sections,
    faq: [{ question: 'A question?', answer: 'An answer.' }],
    sources: [],
  });
}

test('WRITER: a reply missing required sections is rejected, not saved', () => {
  assert.ok(template, 'the comparison template exists');
  const required = template!.contentSchema.sections.filter((s) => s.required);
  assert.ok(required.length > 2, 'this template has several required sections');

  // Exactly the shape that got through: valid JSON, one real section.
  const oneSection = reply([{ key: 'hero', heading: 'Hero', body: 'This is a guide to how far you can trust it.' }]);

  assert.throws(
    () => parseArticle(oneSection, template),
    (error: Error) => {
      assert.match(error.message, /missing \d+ of \d+ required sections/);
      // The message names them, because "generation failed" tells an editor
      // nothing about what to do next.
      assert.match(error.message, /verdict|evaluations|introduction/);
      return true;
    },
  );
});

test('WRITER: a complete reply passes', () => {
  const full = reply(
    template!.contentSchema.sections.map((s) => ({
      key: s.key,
      heading: s.heading,
      body: 'Body text that is long enough to count as written.',
    })),
  );

  const article = parseArticle(full, template);
  assert.equal(article.sections.length, template!.contentSchema.sections.length);
});

test('WRITER: faq counts as covered when it arrives as its own field', () => {
  /**
   * The shape every good article in the library actually uses: a `faq` list
   * of question/answer pairs and no `faq` section. Checked against articles
   * 33, 35 and 36 before this rule shipped — a coverage check that did not
   * know this would have rejected all three.
   */
  const withFaqField = JSON.stringify({
    title: 'A Title',
    excerpt: 'An excerpt.',
    sections: template!.contentSchema.sections
      .filter((s) => s.required && s.key !== 'faq')
      .map((s) => ({ key: s.key, heading: s.heading, body: 'Body text long enough to count.' })),
    faq: [{ question: 'Does this count?', answer: 'Yes, it does.' }],
    sources: [],
  });

  assert.doesNotThrow(() => parseArticle(withFaqField, template));
});

test('WRITER: optional sections may be omitted', () => {
  // The check is about REQUIRED sections. A template's optional ones are
  // optional, and failing a generation for skipping one would be worse than
  // the bug this fixes.
  const requiredOnly = reply(
    template!.contentSchema.sections
      .filter((s) => s.required)
      .map((s) => ({ key: s.key, heading: s.heading, body: 'Body text that is long enough to count.' })),
  );

  assert.doesNotThrow(() => parseArticle(requiredOnly, template));
});

test('WRITER: with no template, the old behaviour stands', () => {
  // The revision stage edits an article that already passed and may
  // legitimately return only what it touched, so it parses without a
  // template and must not be held to the full schema.
  const partial = reply([{ key: 'hero', heading: 'Hero', body: 'Just the one.' }]);
  assert.doesNotThrow(() => parseArticle(partial));
});
