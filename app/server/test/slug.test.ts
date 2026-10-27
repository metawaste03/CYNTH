/**
 * Slugs: the URL every article is published at.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SLUG_LENGTH, slugify } from '../src/shared/text/slug.js';

test('SLUG: a long title is cut at a word boundary, never mid-word', () => {
  // The real case: this title went live as "...-without-guessin".
  const slug = slugify('Are Apple Watch Calories Accurate? How to Set Your Calorie Target Without Guessing');

  assert.equal(slug, 'are-apple-watch-calories-accurate-how-to-set-your-calorie-target-without');
  assert.ok(slug.length <= MAX_SLUG_LENGTH);
});

test('SLUG: when the limit falls exactly between two words, the first word is kept whole', () => {
  // 80 characters of words, then a hyphen, then more.
  const words = 'abcdefghi-'.repeat(8).slice(0, 79) + 'x'; // 80 chars ending on a word
  const slug = slugify(`${words} tail`);
  assert.equal(slug, words);
});

test('SLUG: short titles are unchanged by the limit', () => {
  assert.equal(slugify('How to Read a Nootropic Supplement Label'), 'how-to-read-a-nootropic-supplement-label');
  assert.equal(slugify('  Sleep & Recovery!  '), 'sleep-recovery');
  assert.equal(slugify('Café Crème’s Guide'), 'cafe-cremes-guide');
});

test('SLUG: one unbroken word longer than the limit is cut hard rather than emptied', () => {
  const slug = slugify('a'.repeat(120));
  assert.equal(slug.length, MAX_SLUG_LENGTH);
});

test('SLUG: no slug ends in a hyphen', () => {
  for (const title of [
    'Wrist Rests, Vertical Mice and Split Keyboards: What May Help Wrist Pain — and What Probably Will Not',
    'The Best Bedroom Temperature for Sleep—and What to Change Before Buying Cooling Bedding Today',
  ]) {
    const slug = slugify(title);
    assert.ok(!slug.endsWith('-'), slug);
    assert.ok(slug.length <= MAX_SLUG_LENGTH, slug);
  }
});
