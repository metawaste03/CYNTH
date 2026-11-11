import { getDatabase } from '../../shared/database/index.js';

/**
 * WHAT THIS PUBLICATION HAS ALREADY WRITTEN.
 *
 * WHY THIS EXISTS. The topic research stage asks a model "what should we write
 * in this area?" and, in explore mode, the only context it had was the area
 * guidance. It could not see a single thing the publication had already
 * produced, so "existing coverage" in its output meant the wider web, never
 * EveryFiveDays. Two consequences followed, and both were visible in the
 * output: it could propose a subject already covered, and it could not
 * deliberately fill a gap in its own catalogue. Smart Pet Care drifting into a
 * second cat-device article is exactly that blindness.
 *
 * DETERMINISTIC, AND ONLY REAL ARTICLES. Every row here is a row in the
 * `articles` table. Nothing is inferred, and a model is never asked what the
 * site contains — that is a question about stored data, and the database can
 * answer it exactly.
 *
 * KEPT SMALL ON PURPOSE. This text goes into a prompt, so it is titles and a
 * few facts, not bodies. A catalogue of 200 articles must still fit, which is
 * why the same-area list is complete and the other-area list is capped.
 */

export interface CoverageEntry {
  articleId: number;
  title: string;
  slug: string | null;
  themeId: number | null;
  themeName: string | null;
  status: string;
  /** True when the article has generated content — an empty draft is not coverage. */
  hasContent: boolean;
  /** Where it lives in a CMS, when it has been pushed. */
  externalUrl: string | null;
  externalStatus: string | null;
  primaryKeyword: string | null;
}

interface CoverageRow {
  id: number;
  title: string | null;
  generated_title: string | null;
  slug: string | null;
  theme_id: number | null;
  theme_name: string | null;
  status: string;
  has_content: number;
  external_url: string | null;
  external_status: string | null;
  primary_keyword: string | null;
}

/**
 * Every article with real content, newest first.
 *
 * An article with no generated content is excluded: it represents an
 * intention, not coverage, and treating it as covered would stop the topic
 * that was actually never written.
 */
export function listCoverage(options: { excludeArticleId?: number } = {}): CoverageEntry[] {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT a.id, a.title, a.generated_title, a.slug, a.theme_id, a.status,
             t.name AS theme_name,
             CASE WHEN COALESCE(TRIM(a.content), '') != '' THEN 1 ELSE 0 END AS has_content,
             k.primary_keyword,
             l.external_url, l.external_status
      FROM articles a
      LEFT JOIN themes t ON t.id = a.theme_id
      LEFT JOIN keywords k ON k.article_id = a.id
      LEFT JOIN article_cms_links l ON l.article_id = a.id
      WHERE COALESCE(TRIM(a.content), '') != ''
        AND (? IS NULL OR a.id != ?)
      GROUP BY a.id
      ORDER BY a.id DESC
    `)
    .all(
      options.excludeArticleId ?? null,
      options.excludeArticleId ?? null,
    ) as unknown as CoverageRow[];

  return rows
    .map((row) => ({
      articleId: row.id,
      title: (row.title?.trim() || row.generated_title?.trim() || '') as string,
      slug: row.slug,
      themeId: row.theme_id,
      themeName: row.theme_name,
      status: row.status,
      hasContent: row.has_content === 1,
      externalUrl: row.external_url,
      externalStatus: row.external_status,
      primaryKeyword: row.primary_keyword,
    }))
    .filter((entry) => entry.title !== '');
}

/** How many articles each area already has. Used to say where the catalogue is thin. */
export function coverageByTheme(): Array<{ themeId: number | null; themeName: string | null; count: number }> {
  const counts = new Map<string, { themeId: number | null; themeName: string | null; count: number }>();
  for (const entry of listCoverage()) {
    const key = String(entry.themeId ?? 'none');
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { themeId: entry.themeId, themeName: entry.themeName, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

const OTHER_AREA_LIMIT = 25;

/**
 * The coverage block as it appears in a prompt.
 *
 * Two lists, because they answer different questions. The same-area list is
 * what must not be repeated and is therefore complete. The other-area list is
 * only there so a proposal can reference a neighbouring piece rather than
 * re-explain it, so it is capped and unadorned.
 *
 * Returns an empty string when there is nothing published — a first article in
 * an empty catalogue should see no section at all rather than a heading
 * followed by "none", which reads like a constraint that is not there.
 */
export function buildCoverageBlock(themeId: number | null, excludeArticleId?: number): string {
  const all = listCoverage({ excludeArticleId });
  if (!all.length) return '';

  const sameArea = themeId === null ? [] : all.filter((entry) => entry.themeId === themeId);
  const otherAreas = all.filter((entry) => entry.themeId !== themeId).slice(0, OTHER_AREA_LIMIT);

  const lines: string[] = ['=== ALREADY WRITTEN BY THIS PUBLICATION ==='];

  if (sameArea.length) {
    lines.push(
      `In THIS thematic area (${sameArea.length} article${sameArea.length === 1 ? '' : 's'}) — do not propose these subjects again:`,
    );
    for (const entry of sameArea) {
      const where = entry.externalStatus === 'publish' ? 'live' : entry.externalUrl ? 'pushed as draft' : 'in Cynth only';
      const keyword = entry.primaryKeyword ? ` [target: ${entry.primaryKeyword}]` : '';
      lines.push(`  - "${entry.title}" (${where})${keyword}`);
    }
  } else {
    lines.push('In THIS thematic area: nothing has been written yet. This would be the first.');
  }

  if (otherAreas.length) {
    lines.push('', 'In other areas of the same publication (context only — do not propose topics from these areas):');
    for (const entry of otherAreas) {
      lines.push(`  - [${entry.themeName ?? 'unassigned'}] "${entry.title}"`);
    }
  }

  lines.push(
    '',
    'HOW TO USE THIS LIST:',
    '- Do not propose a topic that is substantially the same article as one above, however differently worded.',
    '- A close neighbour is allowed ONLY if it answers a genuinely different question, and you must say in the content gap how it differs from the existing piece and why both should exist.',
    '- Prefer subjects that fill an obvious hole in the list above. An area whose articles all cluster on one sub-subject, one product category or one species has a gap, and naming it is more valuable than adding to the cluster.',
    '- Where a proposal would sit naturally alongside an existing article, note which one: that is a future internal link, and knowing it now makes the article better.',
  );

  return lines.join('\n');
}
