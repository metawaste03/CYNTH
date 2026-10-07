/**
 * APPLYING SEO FINDINGS TO THE ARTICLE.
 *
 * Reported plainly: the Findings panel lists warnings and recommendations and
 * there is no way to correct any of them. That was true and deliberate —
 * approving a finding recorded a decision and changed nothing, because nothing
 * in Cynth could edit a written article.
 *
 * On a real article, 13 of 17 findings needed body edits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cynth-seorev-'));
// CYNTH_DB_DIR, not CYNTH_DB_PATH. The wrong name is silently ignored,
// so the test runs against the REAL database and writes to it.
process.env.CYNTH_DB_DIR = scratch;

const dbModule = await import('../src/shared/database/index.js');
dbModule.initializeDatabase();

const stages = await import('../src/features/pipeline/stages/generationStages.service.js');

const ARTICLE = {
  title: 'How to Read a Nootropic Supplement Label',
  excerpt: 'An excerpt.',
  seoTitle: '',
  metaDescription: '',
  sections: [
    { key: 'hero', heading: 'Hero', body: 'A hero paragraph.' },
    { key: 'faq', heading: 'FAQ', body: 'Short. [[product:14]] And more.' },
  ],
  faq: [{ question: 'Q?', answer: 'A.' }],
  sources: [],
} as never;

const FINDINGS = [
  {
    code: 'passage_too_thin_to_quote',
    summary: '"FAQ" is 10 words — too short to answer anything on its own.',
    explanation: null,
    recommendation: 'Give it enough to stand alone — roughly 134-167 words — or merge it into a neighbour.',
    element: 'FAQ',
  },
  {
    code: 'no_definition_statement',
    summary: 'The article never states plainly what the subject is.',
    explanation: 'AI answers quote a definition sentence.',
    recommendation: 'Include one plain sentence of the form "X is ...".',
    element: null,
  },
];

test('SEO REVISION: every finding goes in ONE specification, not one call each', () => {
  const prompt = stages.buildSeoRevisionPrompt(ARTICLE, FINDINGS, '');

  // Both findings, numbered, in a single prompt. Thirteen separate calls would
  // cost thirteen times as much, and each would edit an article the previous
  // one had already changed — so a later fix could undo an earlier one.
  assert.match(prompt, /1\. passage_too_thin_to_quote/);
  assert.match(prompt, /2\. no_definition_statement/);
  assert.match(prompt, /Required change: Give it enough to stand alone/);
  assert.match(prompt, /Required change: Include one plain sentence/);
});

test('SEO REVISION: it is told to edit, not rewrite, and to keep the products', () => {
  const prompt = stages.buildSeoRevisionPrompt(ARTICLE, FINDINGS, '');

  assert.match(prompt, /editing, not rewriting/i);
  assert.match(prompt, /Every other sentence must survive exactly as written/i);
  assert.match(prompt, /Return every section of the article/i);

  // The affiliate markers are the one thing that must not move: they are how
  // a product reaches the published card.
  assert.match(prompt, /Preserve every \[\[product:<id>\]\] marker exactly where it is/);

  // And the article travels whole, so the model edits what exists rather than
  // reconstructing it.
  assert.ok(prompt.includes('[[product:14]]'), 'the article goes in with its markers intact');
});

test('SEO REVISION: padding is refused, with the merge offered instead', () => {
  /**
   * Several findings ask for a passage to be LONGER. A model told only that
   * will restate what is already there, which satisfies the word count and
   * makes the article worse — so the instruction says what "longer" has to
   * consist of, and names the alternative the finding itself offers.
   */
  const prompt = stages.buildSeoRevisionPrompt(ARTICLE, FINDINGS, '');

  assert.match(prompt, /add substance — a reason, a number, a worked example, a caveat/i);
  assert.match(prompt, /Do not restate what is already there in different words/i);
  assert.match(prompt, /merge the passage into its neighbour/i);
});

test('SEO REVISION: a rewrite is held to the author voice', () => {
  // The same reason the editorial revision carries it: the one stage allowed
  // to rewrite prose is otherwise the one stage with no idea whose prose it is.
  const withVoice = stages.buildSeoRevisionPrompt(ARTICLE, FINDINGS, '=== VOICE ===\nShort sentences.');
  assert.match(withVoice, /Short sentences\./);
  assert.match(withVoice, /must be written in this voice/i);

  const withoutVoice = stages.buildSeoRevisionPrompt(ARTICLE, FINDINGS, '');
  assert.doesNotMatch(withoutVoice, /must be written in this voice/i);
});
