import { getDatabase } from '../../shared/database/index.js';
import { fingerprintOf } from '../seo/seoAnalysis.service.js';

/**
 * THE CATALOGUE, GROUPED BY THEMATIC AREA.
 *
 * The Dashboard's Articles card reported a single total and went nowhere — the
 * only counting card with no destination. A total answers "how much have I
 * made"; the question actually being asked is "what have I made, and where are
 * the holes", and that one is per area.
 *
 * Every field here is read from the database. Nothing is inferred and no model
 * is asked anything: how many articles exist, how long they are and where they
 * live are questions about stored data.
 *
 * WORD COUNT IS COUNTED THE SAME WAY THE DRAFTS LIST COUNTS IT. There is no
 * word_count column, so it is derived — and it has to be derived identically,
 * or the same article reads 1,480 words on one screen and 1,502 on another and
 * neither number can be trusted again.
 */

export interface AreaArticle {
  id: number;
  title: string;
  /** 'draft' | 'published' — Cynth's own lifecycle, not the site's. */
  status: string;
  wordCount: number;
  authorName: string | null;
  updatedAt: string;
  /** Where it is on the site: 'live', 'draft', or null when it has never been pushed. */
  cmsStatus: string | null;
  externalUrl: string | null;
  /** The most recent SEO score, or null when the article has never been analysed. */
  seoScore: number | null;
  /** True when the body changed after the last SEO analysis, so the score is stale. */
  seoStale: boolean;
  hasContent: boolean;
}

export interface AreaGroup {
  themeId: number | null;
  themeName: string;
  articles: AreaArticle[];
  /** Written in Cynth, whatever state. */
  total: number;
  /** Published on the site — the number that matters for "is this area carrying its weight". */
  live: number;
  /** Generated but not yet on the site at all. */
  notPushed: number;
  words: number;
}

interface Row {
  id: number;
  title: string | null;
  generated_title: string | null;
  status: string;
  theme_id: number | null;
  theme_name: string | null;
  author_name: string | null;
  updated_at: string;
  content: string | null;
  cms_status: string | null;
  external_url: string | null;
  seo_score: number | null;
  seo_fingerprint: string | null;
}

/**
 * One query, every article, with the few joined facts a list row needs.
 *
 * The CMS columns come from the LIVE connection where there is one — an
 * article pushed to a local install and to production has two rows, and the
 * local one is not what anyone means by "is it on the site".
 */
const SELECT = `
  SELECT
    a.id,
    a.title,
    a.generated_title,
    a.status,
    a.theme_id,
    t.name AS theme_name,
    au.name AS author_name,
    a.updated_at,
    a.content,
    l.external_status AS cms_status,
    l.external_url,
    r.score AS seo_score,
    r.content_fingerprint AS seo_fingerprint
  FROM articles a
  LEFT JOIN themes t ON t.id = a.theme_id
  LEFT JOIN authors au ON au.id = a.author_id
  LEFT JOIN article_cms_links l
    ON l.id = (
      SELECT id FROM article_cms_links x
      WHERE x.article_id = a.id
      ORDER BY (x.external_url LIKE 'https://%') DESC, x.last_pushed_at DESC, x.id DESC
      LIMIT 1
    )
  LEFT JOIN seo_analysis_runs r
    ON r.id = (
      SELECT id FROM seo_analysis_runs s
      -- 'success' and 'partial', not 'succeeded': the status vocabulary is
      -- the analysis service's, and guessing at it cost every score on this
      -- page showing as a dash while thirty-two real scores sat in the table.
      -- A partial run is one where the AI pass failed and the deterministic
      -- analysis stood; its score is real, so hiding it would misreport an
      -- analysed article as never analysed.
      WHERE s.article_id = a.id AND s.status IN ('success', 'partial')
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 1
    )
  ORDER BY t.position, t.name, a.id
`;

export function listArticlesByArea(): { areas: AreaGroup[]; totals: { articles: number; live: number; words: number } } {
  const db = getDatabase();
  const rows = db.prepare(SELECT).all() as unknown as Row[];

  const groups = new Map<string, AreaGroup>();

  for (const row of rows) {
    const key = row.theme_id === null ? '~unassigned' : String(row.theme_id);
    if (!groups.has(key)) {
      groups.set(key, {
        themeId: row.theme_id,
        themeName: row.theme_name ?? 'No thematic area',
        articles: [],
        total: 0,
        live: 0,
        notPushed: 0,
        words: 0,
      });
    }

    const group = groups.get(key)!;
    const hasContent = Boolean(row.content && row.content.trim());
    const wordCount = hasContent ? (row.content ?? '').trim().split(/\s+/).filter(Boolean).length : 0;

    // Stale means the body moved after the analysis, so the score describes an
    // article that no longer exists. Shown rather than hidden: a good score on
    // the wrong draft is worse than no score.
    const seoStale =
      row.seo_score !== null &&
      hasContent &&
      row.seo_fingerprint !== null &&
      fingerprintOf(row.title, row.generated_title, row.content ?? '') !== row.seo_fingerprint;

    group.articles.push({
      id: row.id,
      title: (row.title?.trim() || row.generated_title?.trim()) ?? `Article ${row.id}`,
      status: row.status,
      wordCount,
      authorName: row.author_name,
      updatedAt: row.updated_at,
      cmsStatus: row.cms_status,
      externalUrl: row.external_url,
      seoScore: row.seo_score,
      seoStale,
      hasContent,
    });

    group.total += 1;
    group.words += wordCount;
    if (row.cms_status === 'publish') group.live += 1;
    if (!row.cms_status) group.notPushed += 1;
  }

  // Unassigned last: it is a loose end, not an area.
  const areas = [...groups.values()].sort((a, b) => {
    if (a.themeId === null) return 1;
    if (b.themeId === null) return -1;
    return 0;
  });

  return {
    areas,
    totals: {
      articles: rows.length,
      live: areas.reduce((n, area) => n + area.live, 0),
      words: areas.reduce((n, area) => n + area.words, 0),
    },
  };
}
