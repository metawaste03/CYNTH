import { getSetting, setSetting } from '../../shared/settings/settings.repository.js';
import type { ContentSchema } from './templates.definitions.js';

/**
 * HOW LONG AN ARTICLE SHOULD BE.
 *
 * One answer, in one place, because three things need it and they must not
 * disagree: the writer's prompt, the reviewer's brief, and validation. A
 * writer told 1,500 and a validator checking 2,000 produces an article that
 * is wrong by one of the two rules whatever it does.
 *
 * EveryFiveDays is short-form by policy. The publication-wide ceiling is a
 * SETTING rather than a constant so it can be changed without a deploy, and
 * the effective ceiling for any article is the LOWER of that setting and the
 * template's own — a template may be shorter than the house maximum, never
 * longer.
 *
 * The floor is deliberately not raised to meet a lowered ceiling. If someone
 * sets the house maximum below a template's minimum, the band collapses to
 * the ceiling and says so, rather than silently demanding more words than are
 * allowed.
 */

export const ARTICLE_MAX_WORDS_KEY = 'article.maxWords';

/**
 * The house ceiling, in words.
 *
 * 1,500 is an editorial decision, not a rule of the medium: most readers do
 * not want more, and length that is not earned reads as padding.
 */
export const DEFAULT_MAX_WORDS = 1500;

/**
 * The lowest ceiling that can be set.
 *
 * There is no official minimum length for a blog post, and this does not
 * pretend to be one. It is a guard against a setting that would make every
 * article fail validation: below roughly 400 words an article cannot cover a
 * subject and satisfy a template's sections at the same time.
 */
export const FLOOR_MAX_WORDS = 400;

/** An absolute upper bound on the setting, so "no limit" cannot be typed in by accident. */
export const CEILING_MAX_WORDS = 5000;

export function getHouseMaxWords(): number {
  const raw = getSetting(ARTICLE_MAX_WORDS_KEY);

  // Blank counts as unset, not as zero. Number('') is 0, which would clamp to
  // the floor and quietly cap every article at 400 words because a setting
  // row existed with nothing in it.
  if (raw === null || raw.trim() === '') return DEFAULT_MAX_WORDS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_WORDS;
  return clamp(Math.trunc(parsed));
}

export function setHouseMaxWords(value: number): { maxWords: number } | { error: string } {
  if (!Number.isFinite(value)) return { error: 'The maximum length must be a number of words.' };

  const words = Math.trunc(value);
  if (words < FLOOR_MAX_WORDS || words > CEILING_MAX_WORDS) {
    return {
      error: `The maximum length must be between ${FLOOR_MAX_WORDS} and ${CEILING_MAX_WORDS} words.`,
    };
  }

  setSetting(ARTICLE_MAX_WORDS_KEY, String(words));
  return { maxWords: words };
}

function clamp(value: number): number {
  return Math.min(CEILING_MAX_WORDS, Math.max(FLOOR_MAX_WORDS, value));
}

export interface LengthBand {
  minWords: number;
  maxWords: number;
  /** True when the house ceiling, rather than the template, is what binds. */
  cappedByHouseLimit: boolean;
}

/**
 * The band an article written to this template must land in.
 *
 * `maxWords` is absent on templates published before v2, which is read as "no
 * ceiling of its own" — the house limit then applies alone rather than the
 * article being left unbounded.
 */
export function lengthBandFor(schema: Pick<ContentSchema, 'minWords'> & { maxWords?: number }): LengthBand {
  const house = getHouseMaxWords();
  const templateMax = typeof schema.maxWords === 'number' && schema.maxWords > 0 ? schema.maxWords : Infinity;
  const maxWords = Math.min(house, templateMax);

  return {
    // A minimum above the ceiling is not achievable, so it collapses to the
    // ceiling rather than asking for something impossible.
    minWords: Math.min(schema.minWords, maxWords),
    maxWords,
    cappedByHouseLimit: house < templateMax,
  };
}

/** The one sentence given to a model about length, so the writer and the reviewer read the same instruction. */
export function describeLengthBand(band: LengthBand): string {
  return (
    `Length: between ${band.minWords} and ${band.maxWords} words for the whole article. ` +
    `${band.maxWords} is a hard ceiling — this publication is short-form, and an article that runs long is worse, not more thorough. ` +
    'Cover the subject properly within it rather than padding to reach the minimum or cutting an argument short to meet the maximum.'
  );
}
