import { Router } from 'express';
import {
  ASSUMED_COMPLETION_TOKENS,
  getGenerationMode,
  isValidGenerationMode,
  setGenerationMode,
} from './generationPolicy.service.js';
import {
  CEILING_MAX_WORDS,
  DEFAULT_MAX_WORDS,
  FLOOR_MAX_WORDS,
  getHouseMaxWords,
  setHouseMaxWords,
} from '../templates/articleLength.service.js';

/**
 * Generation policy: the mode that decides whether Cynth may spend money.
 *
 * Kept apart from the article routes because it is a system-wide setting, not
 * a property of any one draft.
 */
export const generationRouter = Router();

generationRouter.get('/mode', (_req, res) => {
  const mode = getGenerationMode();
  res.json({
    mode,
    assumedCompletionTokens: ASSUMED_COMPLETION_TOKENS,
    description:
      mode === 'test'
        ? 'Test mode: free models only. Paid generation is refused, and Cynth will never substitute a paid model for a failed free one.'
        : 'Production mode: paid models are allowed, but every paid generation needs explicit confirmation of its estimated cost.',
  });
});

/**
 * Switching to Production is the deliberate act that makes spending possible
 * at all. It is intentionally a separate decision from confirming any one
 * generation — being in Production mode still confirms nothing by itself.
 */
generationRouter.put('/mode', (req, res) => {
  const mode = (req.body ?? {}).mode;
  if (!isValidGenerationMode(mode)) {
    return res.status(400).json({ errors: ['mode must be either "test" or "production".'] });
  }

  res.json({ mode: setGenerationMode(mode) });
});

/* --------------------------------------------------------- article length --- */

/**
 * The publication-wide word ceiling.
 *
 * Read by the writer's prompt, the reviewer's brief and final validation, so
 * changing it here changes all three at once and they cannot disagree. A
 * template may be shorter than this; none may be longer.
 */
generationRouter.get('/article-length', (_req, res) => {
  res.json({
    maxWords: getHouseMaxWords(),
    default: DEFAULT_MAX_WORDS,
    min: FLOOR_MAX_WORDS,
    max: CEILING_MAX_WORDS,
  });
});

generationRouter.put('/article-length', (req, res) => {
  const result = setHouseMaxWords(Number((req.body ?? {}).maxWords));
  if ('error' in result) return res.status(400).json({ errors: [result.error] });

  res.json({ ...result, default: DEFAULT_MAX_WORDS, min: FLOOR_MAX_WORDS, max: CEILING_MAX_WORDS });
});
