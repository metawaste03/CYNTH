/**
 * The Article entity's own vocabulary.
 *
 * An Article is the content entity: the thing a human writes, reviews, and
 * eventually publishes. It is NOT the same thing as a generation_history row,
 * which records one *attempt* to call a model. History is an audit trail and
 * may hold many rows (successes and failures) for a single Article; the
 * Article is the single durable record of the content itself. The Dashboard
 * and Drafts read the Article, never the history.
 */

/**
 * Lifecycle: Generated -> Draft -> Edited/Reviewed -> Published.
 *
 * Only two states are stored, because only two are currently meaningful:
 * everything before publication is a draft. "Generated" and "reviewed" are
 * properties of a draft (whether generated_at is set, whether a human has
 * touched it since), not separate statuses — adding columns for states
 * nothing yet acts on would be inventing requirements.
 */
export const ARTICLE_STATUSES = ['draft', 'published'] as const;

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

/** Generation never changes status. A generated article is a draft until a human says otherwise. */
export const DEFAULT_ARTICLE_STATUS: ArticleStatus = 'draft';

export function isValidArticleStatus(value: unknown): value is ArticleStatus {
  return typeof value === 'string' && (ARTICLE_STATUSES as readonly string[]).includes(value);
}

/** Shown wherever an article has neither a working title nor a generated one. A display fallback only — never written to the database. */
export const UNTITLED_ARTICLE_LABEL = 'Untitled draft';

/**
 * A URL-safe identifier derived from a title.
 *
 * Re-exported from shared/text/slug.ts so articles, themes, topics and
 * projects all derive slugs identically, and database seeding can use it
 * without importing from a feature module.
 */
export { slugify } from '../../shared/text/slug.js';
