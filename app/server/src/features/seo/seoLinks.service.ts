import { getDatabase } from '../../shared/database/index.js';
import type { ArticleDraftDto } from '../articles/articles.repository.js';
import type { InternalLinkInput } from './seo.repository.js';
import { SLUG_STOPWORDS } from './seo.constants.js';
import { countPhraseOccurrences, stripInlineMarkdown, tokenize } from './seoDocument.js';
import type { SeoDocument } from './seoDocument.js';

/**
 * INTERNAL LINK OPPORTUNITIES.
 *
 * Finds articles ALREADY IN CYNTH that this article could reasonably link to.
 *
 * The constraint that shapes everything here: a candidate is a row in the
 * `articles` table, found by a query. There is no code path that produces a
 * target from a model's imagination, a URL pattern, or a guess about what the
 * site probably contains — so Cynth cannot propose a link to something that
 * does not exist.
 *
 * Deterministic on purpose. Which of Cynth's own articles overlap with this
 * one is a question about stored data, and a database can answer it exactly.
 */

interface LinkCandidateRow {
  id: number;
  title: string | null;
  generated_title: string | null;
  slug: string | null;
  topic: string | null;
  theme_id: number | null;
  topic_id: number | null;
  content: string | null;
  primary_keyword: string | null;
  secondary_keywords: string | null;
  status: string;
}

export interface InternalLinkCandidate {
  targetArticleId: number;
  title: string;
  slug: string | null;
  relevance: number;
  reasons: string[];
  anchorSuggestion: string | null;
  anchorFoundInSource: boolean;
}

/** Content words only — matching on "the" and "and" would make everything relevant to everything. */
function meaningfulTokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(tokenize(text).filter((word) => word.length > 2 && !SLUG_STOPWORDS.has(word)));
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/**
 * Picks anchor text that genuinely appears in the source article.
 *
 * Preference order: the target's primary keyword, then its title, then the
 * longest phrase from its title that the source actually contains. When
 * nothing matches, the target's title is offered with `anchorFoundInSource`
 * false — so the UI can say "you would need to write this phrase in" rather
 * than implying the text is already there.
 */
function chooseAnchor(
  sourceText: string,
  target: LinkCandidateRow,
  targetTitle: string,
): { anchor: string | null; found: boolean } {
  const candidates: string[] = [];
  if (target.primary_keyword?.trim()) candidates.push(target.primary_keyword.trim());
  candidates.push(targetTitle);
  if (target.topic?.trim()) candidates.push(target.topic.trim());

  for (const candidate of candidates) {
    if (candidate && countPhraseOccurrences(sourceText, candidate) > 0) {
      return { anchor: candidate, found: true };
    }
  }

  // Longest meaningful sub-phrase of the title that the source contains.
  const words = targetTitle.split(/\s+/).filter(Boolean);
  for (let length = Math.min(words.length, 6); length >= 2; length -= 1) {
    for (let start = 0; start + length <= words.length; start += 1) {
      const phrase = words.slice(start, start + length).join(' ');
      const phraseTokens = tokenize(phrase).filter((word) => !SLUG_STOPWORDS.has(word));
      if (phraseTokens.length < 2) continue;
      if (countPhraseOccurrences(sourceText, phrase) > 0) return { anchor: phrase, found: true };
    }
  }

  return { anchor: targetTitle, found: false };
}

/**
 * Ranks Cynth's other articles by how related they are to this one.
 *
 * Signals, in descending weight: a shared topic, a shared thematic area,
 * keyword overlap, and title/subject word overlap. Each contributes a reason
 * string, so a suggestion always explains itself rather than arriving as a
 * bare relevance number.
 */
export function findInternalLinkOpportunities(
  article: ArticleDraftDto,
  document: SeoDocument,
  options: { limit?: number; minRelevance?: number } = {},
): InternalLinkCandidate[] {
  const db = getDatabase();
  const limit = options.limit ?? 8;
  const minRelevance = options.minRelevance ?? 0.15;

  // Only articles that actually have content: linking to an empty draft is a
  // promise the site cannot keep.
  const rows = db
    .prepare(`
      SELECT a.id, a.title, a.generated_title, a.slug, a.topic, a.theme_id, a.topic_id, a.content, a.status,
             k.primary_keyword, k.secondary_keywords
      FROM articles a
      LEFT JOIN keywords k ON k.article_id = a.id
      WHERE a.id != ? AND a.generated_at IS NOT NULL AND COALESCE(TRIM(a.content), '') != ''
    `)
    .all(article.id) as unknown as LinkCandidateRow[];

  const sourceText = document.plainText;
  const sourceSubject = meaningfulTokens(
    [
      article.title,
      article.topic,
      article.keywords?.primaryKeyword,
      article.keywords?.secondaryKeywords,
      article.importantTopics,
    ]
      .filter(Boolean)
      .join(' '),
  );
  const sourceBodyTokens = meaningfulTokens(sourceText.slice(0, 20000));

  const candidates: InternalLinkCandidate[] = [];

  for (const row of rows) {
    const title = row.title?.trim() || row.generated_title?.trim() || '';
    if (!title) continue;

    const reasons: string[] = [];
    let relevance = 0;

    if (article.topicId && row.topic_id === article.topicId) {
      relevance += 0.4;
      reasons.push('Both articles are written against the same topic.');
    } else if (article.themeId && row.theme_id === article.themeId) {
      relevance += 0.25;
      reasons.push('Both articles belong to the same thematic area.');
    }

    const targetSubject = meaningfulTokens(
      [title, row.topic, row.primary_keyword, row.secondary_keywords].filter(Boolean).join(' '),
    );
    const subjectOverlap = overlapRatio(sourceSubject, targetSubject);
    if (subjectOverlap > 0) {
      relevance += subjectOverlap * 0.35;
      const shared = [...targetSubject].filter((token) => sourceSubject.has(token)).slice(0, 5);
      if (shared.length) reasons.push(`Shared subject terms: ${shared.join(', ')}.`);
    }

    // Does the source article actually talk about the target's subject? This
    // is what separates "related in the database" from "worth linking here".
    const bodyOverlap = overlapRatio(targetSubject, sourceBodyTokens);
    if (bodyOverlap > 0.2) {
      relevance += Math.min(0.25, bodyOverlap * 0.25);
      reasons.push('This article already discusses the other one’s subject.');
    }

    if (relevance < minRelevance || reasons.length === 0) continue;

    const anchor = chooseAnchor(sourceText, row, title);
    if (anchor.found) reasons.push(`The phrase "${anchor.anchor}" already appears in this article.`);
    else reasons.push('No matching phrase exists in this article yet, so the anchor text would need to be written in.');

    candidates.push({
      targetArticleId: row.id,
      title,
      slug: row.slug,
      relevance: Number(Math.min(1, relevance).toFixed(3)),
      reasons,
      anchorSuggestion: anchor.anchor,
      anchorFoundInSource: anchor.found,
    });
  }

  return candidates.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
}

/** Converts candidates into repository input. Confidence tracks relevance — no separate invented number. */
export function toInternalLinkInputs(
  analysisId: number | null,
  sourceArticleId: number,
  candidates: InternalLinkCandidate[],
): InternalLinkInput[] {
  return candidates.map((candidate) => ({
    analysisId,
    sourceArticleId,
    targetArticleId: candidate.targetArticleId,
    anchorSuggestion: candidate.anchorSuggestion,
    anchorFoundInSource: candidate.anchorFoundInSource,
    reason: candidate.reasons.join(' '),
    relevance: candidate.relevance,
    confidence: candidate.relevance,
    origin: 'deterministic' as const,
  }));
}

/**
 * Internal links that already exist in the article body, resolved against
 * Cynth's own articles where possible. Reported so the opportunity list does
 * not suggest a link the author has already written.
 */
export function existingInternalLinkTargets(document: SeoDocument): Set<string> {
  const targets = new Set<string>();
  for (const link of document.links) {
    if (!link.isInternal) continue;
    const slug = link.url.replace(/^\/+|\/+$/g, '').split('/').pop();
    if (slug) targets.add(slug.toLowerCase());
    targets.add(stripInlineMarkdown(link.anchorText).toLowerCase());
  }
  return targets;
}
