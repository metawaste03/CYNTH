import { getDatabase } from '../../shared/database/index.js';
import { listLinksForArticle } from '../cms/cmsLinks.repository.js';
import { SLUG_STOPWORDS } from './seo.constants.js';
import { tokenize } from './seoDocument.js';

/**
 * WHAT A NEW ARTICLE MAY LINK TO — decided before it is written.
 *
 * THE GAP THIS CLOSES. Internal links were a three-step afterthought: analyse
 * the finished article, approve each suggested link by hand, then pay for a
 * second model call to fit the links into prose that was never written to
 * hold them. Measured on the live catalogue, 19 of the first 25 articles
 * carried no internal link at all, and 41 approved links were still waiting
 * to be placed.
 *
 * So the writer is told, up front, which articles are live and what each is
 * about. A link written into the sentence it belongs to costs nothing extra
 * and reads better than one fitted afterwards — and it is already in the body
 * when the article is pushed.
 *
 * ONLY WHAT A READER CAN OPEN. A target is offered only when the live site
 * has published it. The address is the one the site answered with, never one
 * Cynth composed.
 */

/**
 * A URL a reader could actually follow, or null.
 *
 * `?p=` is the tell for an unpublished post: WordPress only mints a pretty
 * permalink once the post is public, and the query form 404s for anyone who is
 * not logged in. Requiring `publish` AND a clean path means a link Cynth makes
 * is one a visitor can use.
 */
export function resolvePublicUrl(targetArticleId: number): string | null {
  const candidates = listLinksForArticle(targetArticleId)
    .filter((link) => link.externalStatus === 'publish')
    .filter((link) => typeof link.externalUrl === 'string' && /^https?:\/\//i.test(link.externalUrl))
    .filter((link) => !/[?&]p=\d/i.test(link.externalUrl!))
    // https over http, then the most recent push. Deliberately NOT the default
    // connection: the default here is a dead local install, so trusting that
    // flag would link every article to everyfivedays.local.
    .sort((a, b) => {
      const secure = Number(b.externalUrl!.startsWith('https://')) - Number(a.externalUrl!.startsWith('https://'));
      if (secure !== 0) return secure;
      return (b.lastPushedAt ?? '').localeCompare(a.lastPushedAt ?? '');
    });

  return candidates[0]?.externalUrl ?? null;
}

export interface LinkTarget {
  articleId: number;
  title: string;
  url: string;
  /** What the article is about, in a few words, so a link is made for a reason. */
  about: string;
}

interface TargetRow {
  id: number;
  title: string;
  theme_id: number | null;
  topic: string | null;
  primary_keyword: string | null;
  secondary_keywords: string | null;
}

function contentTokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(tokenize(text).filter((word) => word.length > 2 && !SLUG_STOPWORDS.has(word)));
}

/** Enough to choose three to five from, without handing over the whole catalogue. */
const MAX_LINK_TARGETS = 8;

/**
 * The published articles most worth linking to from an article on `subject`.
 *
 * The same area counts, and so does shared subject matter across areas — the
 * caffeine article belongs next to the afternoon-fatigue one although they sit
 * in different areas. An article that shares neither is not offered: a link
 * with no reason behind it is the kind a reader learns to ignore.
 */
export function listLinkTargets(
  articleId: number,
  themeId: number | null,
  subject: string,
  limit = MAX_LINK_TARGETS,
): LinkTarget[] {
  const rows = getDatabase()
    .prepare(
      `SELECT a.id, COALESCE(NULLIF(TRIM(a.title), ''), a.generated_title, '') AS title, a.theme_id, a.topic,
              k.primary_keyword, k.secondary_keywords
       FROM articles a
       LEFT JOIN keywords k ON k.article_id = a.id
       WHERE a.id != ? AND COALESCE(TRIM(a.content), '') != ''`,
    )
    .all(articleId) as unknown as TargetRow[];

  const subjectTokens = contentTokens(subject);
  const scored: { target: LinkTarget; score: number }[] = [];

  for (const row of rows) {
    if (!row.title) continue;

    const targetTokens = contentTokens([row.title, row.topic, row.primary_keyword, row.secondary_keywords].filter(Boolean).join(' '));
    let shared = 0;
    for (const token of subjectTokens) if (targetTokens.has(token)) shared += 1;
    const overlap = subjectTokens.size && targetTokens.size ? shared / Math.min(subjectTokens.size, targetTokens.size) : 0;

    const sameArea = themeId !== null && row.theme_id === themeId;
    const score = (sameArea ? 0.3 : 0) + overlap * 0.7;
    if (score <= 0) continue;

    // Asked last, and only of an article already worth offering.
    const url = resolvePublicUrl(row.id);
    if (!url) continue;

    scored.push({
      score,
      target: {
        articleId: row.id,
        title: row.title,
        url,
        about: (row.topic?.trim() || row.primary_keyword?.trim() || row.title).slice(0, 160),
      },
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.target.articleId - b.target.articleId)
    .slice(0, limit)
    .map((entry) => entry.target);
}

/** The fewest internal links a finished article should carry, when that many were on offer. */
export const MIN_INTERNAL_LINKS = 3;
export const MAX_INTERNAL_LINKS = 5;

/** The writer's instructions for linking to what is already published. */
export function describeLinkTargets(targets: LinkTarget[] | null | undefined): string {
  if (!targets?.length) return '';

  const wanted =
    targets.length >= MIN_INTERNAL_LINKS
      ? `Link to between ${MIN_INTERNAL_LINKS} and ${MAX_INTERNAL_LINKS} of them.`
      : `Link to ${targets.length === 1 ? 'it' : 'both'} if the article genuinely touches the subject.`;

  return [
    '=== ARTICLES ALREADY PUBLISHED ON THIS SITE ===',
    `These are live. ${wanted} Each link goes in the sentence that is already about that article's subject.`,
    'Write each as a Markdown link on a few descriptive words inside a normal sentence: [the words](the address).',
    'Use the address exactly as given. Never link to any other page on this site, and never compose an address.',
    'Never put a link in a heading or in the first sentence of the article. One link per sentence at most, and each article linked once at most.',
    'Do not add a "related reading" list. The site already shows one under every article.',
    ...targets.map((target) => `- "${target.title}" (${target.about}): ${target.url}`),
    '',
  ].join('\n');
}

function normalise(url: string): string {
  return url.trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/**
 * Checks the links an article makes to its own site.
 *
 * `unknown` are links to the site that match no published article. Nothing
 * supplied such an address, so it was composed, and a composed address is a
 * broken link waiting to be found by a reader. `internal` counts the distinct
 * published articles linked.
 */
export function auditInternalLinks(hrefs: string[]): { internal: number; unknown: string[] } {
  const published = new Map<string, number>();
  const hosts = new Set<string>();

  const rows = getDatabase()
    .prepare(
      `SELECT article_id, external_url FROM article_cms_links
       WHERE external_status = 'publish' AND external_url IS NOT NULL`,
    )
    .all() as unknown as { article_id: number; external_url: string }[];

  for (const row of rows) {
    if (/[?&]p=\d/i.test(row.external_url)) continue;
    try {
      hosts.add(new URL(row.external_url).host.toLowerCase());
      published.set(normalise(row.external_url), row.article_id);
    } catch {
      // A stored address that is not a URL links to nothing and proves nothing.
    }
  }

  const linked = new Set<number>();
  const unknown: string[] = [];

  for (const href of hrefs) {
    let host: string;
    try {
      host = new URL(href).host.toLowerCase();
    } catch {
      continue;
    }
    if (!hosts.has(host)) continue;

    const articleId = published.get(normalise(href));
    if (articleId === undefined) unknown.push(href);
    else linked.add(articleId);
  }

  return { internal: linked.size, unknown: [...new Set(unknown)] };
}
