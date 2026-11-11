import { listMedia } from './media.repository.js';
import type { MediaAssetDto } from './media.repository.js';
import { getArticleById } from '../articles/articles.repository.js';
import { getDatabase } from '../../shared/database/index.js';

/**
 * WHICH IMAGE FITS THIS ARTICLE.
 *
 * Deterministic and explainable. There is no model here and no image
 * recognition: Cynth cannot see what a photograph contains, so it matches on
 * what the EDITOR wrote about it — title, description, alt text and tags —
 * narrowed first by the thematic area.
 *
 * The output is a ranked list of CANDIDATES with the reason each one scored.
 * Nothing is attached automatically. That is the same rule product placement
 * follows: Cynth proposes, the editor decides.
 *
 * The honest limitation is stated in the result rather than hidden: an asset
 * with no description can only ever match on its theme, because there is
 * nothing else to match against.
 */

export interface MediaSuggestion {
  asset: MediaAssetDto;
  score: number;
  /** Why it scored what it scored, in the user's terms. */
  reasons: string[];
}

export interface MediaSuggestionResult {
  articleId: number;
  themeId: number | null;
  themeName: string | null;
  /** How many assets were considered after the theme filter. */
  consideredCount: number;
  suggestions: MediaSuggestion[];
  notes: string[];
}

/** Words too common to indicate anything. Matching on "the" would rank every asset equally. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'with', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'as',
  'best', 'guide', 'how', 'what', 'why', 'you', 'your', 'we', 'our', 'do', 'does', 'can',
]);

function terms(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

function overlap(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((word) => b.has(word));
}

/**
 * Suggests images for an article.
 *
 * `role` narrows by intended use: a featured image is chosen from assets the
 * editor marked as featured or other, an inline one from the rest.
 */
export function suggestMedia(
  articleId: number,
  options: { role?: 'featured' | 'inline'; limit?: number } = {},
): MediaSuggestionResult | null {
  const article = getArticleById(articleId);
  if (!article) return null;

  const notes: string[] = [];
  const role = options.role ?? 'featured';

  const db = getDatabase();
  const theme = article.themeId
    ? (db.prepare('SELECT id, name FROM themes WHERE id = ?').get(article.themeId) as
        | { id: number; name: string }
        | undefined)
    : undefined;

  /**
   * The theme filter does most of the work, and is the reason a library of
   * forty images across three areas is not a matching problem: an article in
   * one area never considers the other two.
   *
   * Assets with no theme are included, because an unfiled image is not
   * necessarily wrong — it is just unfiled, and excluding it would hide it
   * forever.
   */
  const pool = listMedia({ activeOnly: true }).filter((asset) => {
    if (theme && asset.themeId !== null && asset.themeId !== theme.id) return false;
    if (role === 'featured') return asset.kind === 'featured' || asset.kind === 'other';
    return asset.kind !== 'featured';
  });

  if (!theme) {
    notes.push('This draft has no thematic area, so images could not be narrowed by area — every image was considered.');
  }
  if (!pool.length) {
    notes.push(
      theme
        ? `No ${role} images are filed under ${theme.name} or left unfiled. Upload one in the Media Library.`
        : 'The media library has no usable images yet.',
    );
  }

  // What the article is about, from the fields the editor and the research
  // stages already filled in. No new work, and nothing invented.
  const articleTerms = new Set<string>([
    ...terms(article.title),
    ...terms(article.topic),
    ...terms(article.keywords?.primaryKeyword),
    ...terms(article.keywords?.secondaryKeywords),
    ...terms(article.importantTopics),
  ]);

  const suggestions: MediaSuggestion[] = pool
    .map((asset) => {
      const reasons: string[] = [];
      let score = 0;

      if (theme && asset.themeId === theme.id) {
        score += 40;
        reasons.push(`Filed under ${theme.name}`);
      } else if (asset.themeId === null) {
        score += 5;
        reasons.push('Not filed under any area');
      }

      const assetTerms = new Set<string>([
        ...terms(asset.title),
        ...terms(asset.description),
        ...terms(asset.altText),
        ...terms(asset.tags.join(' ')),
      ]);

      const shared = overlap(articleTerms, assetTerms);
      if (shared.length) {
        // Capped so a keyword-stuffed description cannot dominate on volume.
        score += Math.min(45, shared.length * 9);
        reasons.push(`Matches: ${shared.slice(0, 6).join(', ')}`);
      }

      if (asset.kind === role) {
        score += 10;
        reasons.push(`Marked as a ${role} image`);
      }

      // An asset never used is preferred over one already published elsewhere,
      // so a library does not collapse onto the same photograph.
      if (asset.usageCount === 0) {
        score += 5;
        reasons.push('Not yet used in another article');
      }

      if (!asset.description && !asset.tags.length) {
        reasons.push('No description or tags — matched on its area alone');
      }

      return { asset, score, reasons };
    })
    .filter((suggestion) => suggestion.score > 0)
    .sort((a, b) => b.score - a.score || a.asset.title.localeCompare(b.asset.title))
    .slice(0, options.limit ?? 8);

  if (pool.length && !articleTerms.size) {
    notes.push('This draft has no title, topic or keywords yet, so images were ranked by area only.');
  }
  if (suggestions.length && suggestions[0].score < 45) {
    notes.push('No image is a strong match. Consider uploading one for this article rather than reusing a weak fit.');
  }

  return {
    articleId,
    themeId: theme?.id ?? null,
    themeName: theme?.name ?? null,
    consideredCount: pool.length,
    suggestions,
    notes,
  };
}
