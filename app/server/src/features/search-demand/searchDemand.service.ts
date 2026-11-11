import { getDatabase } from '../../shared/database/index.js';
import { AREA_SCOPES } from '../coverage-graph/coverageScope.js';
import { SLUG_STOPWORDS } from '../seo/seo.constants.js';
import { tokenize } from '../seo/seoDocument.js';

/**
 * SEARCH DEMAND — what people actually typed into Google.
 *
 * THE GAP THIS CLOSES. Topic research was told "do not invent search volumes",
 * and then given nothing to use instead. So every topic it proposed was an
 * informed guess about what somebody might search for. Search Console knows
 * what they did search for, and which of our pages Google showed them.
 *
 * WHAT IT IS. A snapshot of Search Console rows — query, page, clicks,
 * impressions, position — each filed under the thematic area it belongs to.
 * Topic research reads its own area's rows and is asked to answer one of them.
 *
 * WHERE THE ROWS COME FROM. A Search Console export, pasted or uploaded.
 * Cynth holds no Google credential and does not ask for one. The `source`
 * column exists so another route in (the site's own copy of the data, say)
 * can be added without changing anything that reads the table.
 *
 * AN IMPORT IS A SNAPSHOT, NOT A LEDGER. Search Console reports totals for a
 * period. Importing the same period twice must not double the figures, so a
 * row that already exists has its numbers replaced.
 *
 * WHICH AREA A SEARCH BELONGS TO, in descending order of certainty:
 *   1. The page Google showed is one of our articles: that article's area.
 *   2. The wording matches an existing article's subject (its title, topic
 *      and keywords): that article's area.
 *   3. The wording matches one area's vocabulary better than any other's.
 *   4. Nearly every word of the search appears in an existing article's body:
 *      that article's area.
 *   5. The wording matches a subtopic in an area's declared scope.
 *   6. Nothing matched: it stays unfiled until an editor files it.
 *
 * "ALREADY ANSWERED" IS CLAIMED RARELY. Only from the page Google showed, or
 * from wording that is nearly the article's own subject. Measured on the live
 * catalogue, anything looser called "why do i wake up at 3am" answered by the
 * bedroom-temperature article because one of its headings mentions 3am. A
 * search wrongly marked answered is an article that never gets written, which
 * is the costlier mistake: one wrongly left open is caught downstream.
 *
 * WORD MATCHING IS A FILING CLERK, NOT A JUDGE. It decides which area sees a
 * search. Whether an existing article truly answers it is settled twice more
 * downstream by things that read meaning: topic research, which is shown the
 * catalogue beside these searches, and the coverage gate, which stops a topic
 * that repeats an article however it was worded.
 * An editor's choice is never overwritten by a later import.
 */

/* ------------------------------------------------------------------ types */

export interface SearchQueryDto {
  id: number;
  query: string;
  pageUrl: string;
  clicks: number;
  impressions: number;
  position: number | null;
  period: string | null;
  source: string;
  themeId: number | null;
  themeSource: 'page' | 'match' | 'manual' | null;
  articleId: number | null;
  articleTitle: string | null;
  importedAt: string;
}

export interface ParsedSearchRow {
  query: string;
  pageUrl: string;
  clicks: number;
  impressions: number;
  position: number | null;
}

export interface ImportSummary {
  rows: number;
  added: number;
  updated: number;
  filed: number;
  unfiled: number;
  skipped: number;
}

/* ---------------------------------------------------------------- parsing */

/** Splits CSV text into rows of cells. Handles quoted cells, doubled quotes and either line ending. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  // Exports from Excel begin with a byte-order mark that would otherwise
  // become part of the first header name.
  const input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',' || char === '\t') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

const HEADER_NAMES: Record<keyof ParsedSearchRow, string[]> = {
  query: ['top queries', 'query', 'queries', 'search query', 'keyword', 'keywords'],
  pageUrl: ['top pages', 'page', 'pages', 'landing page', 'url', 'address'],
  clicks: ['clicks'],
  impressions: ['impressions'],
  position: ['position', 'average position', 'avg position', 'avg. position'],
};

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[,%\s]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads a Search Console export.
 *
 * Search Console's own "Queries" file has no page column, and that is fine:
 * the area is then worked out from the wording. A file with pages and no
 * queries is refused, because a page on its own says nothing about what
 * anybody searched for.
 */
export function parseSearchConsoleCsv(text: string): { rows: ParsedSearchRow[]; skipped: number } | { error: string } {
  const table = parseCsv(text);
  if (table.length < 2) return { error: 'The file has no rows. Export "Queries" from Search Console and try again.' };

  const header = table[0].map((name) => name.trim().toLowerCase());
  const column = (field: keyof ParsedSearchRow) => header.findIndex((name) => HEADER_NAMES[field].includes(name));

  const queryAt = column('query');
  if (queryAt < 0) {
    return {
      error:
        'No query column was found. In Search Console, open Performance, choose Export, and use the file named "Queries".',
    };
  }

  const pageAt = column('pageUrl');
  const clicksAt = column('clicks');
  const impressionsAt = column('impressions');
  const positionAt = column('position');

  const rows: ParsedSearchRow[] = [];
  let skipped = 0;

  for (const cells of table.slice(1)) {
    const query = (cells[queryAt] ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!query || query.length > 300) {
      skipped += 1;
      continue;
    }

    rows.push({
      query,
      pageUrl: pageAt >= 0 ? (cells[pageAt] ?? '').trim() : '',
      clicks: Math.max(0, Math.round(toNumber(cells[clicksAt]) ?? 0)),
      impressions: Math.max(0, Math.round(toNumber(cells[impressionsAt]) ?? 0)),
      position: positionAt >= 0 ? toNumber(cells[positionAt]) : null,
    });
  }

  if (!rows.length) return { error: 'No usable rows were found in the file.' };
  return { rows, skipped };
}

/* ------------------------------------------------------- filing by area --- */

/** Words searchers type that say nothing about the subject. */
const FILLER_WORDS = new Set([
  'can', 'could', 'does', 'did', 'should', 'would', 'may', 'might', 'much', 'many', 'too', 'very', 'really',
  'best', 'good', 'worth', 'likely', 'result', 'set', 'get', 'take', 'taking', 'use', 'using', 'need', 'about',
]);

/** Content words, with a plural folded into its singular so "desks" meets "desk". */
function contentTokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    tokenize(text)
      .filter((word) => word.length > 2 && !SLUG_STOPWORDS.has(word) && !FILLER_WORDS.has(word))
      .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)),
  );
}

function normaliseUrl(url: string): string {
  return url.trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
}

interface CatalogueArticle {
  id: number;
  title: string;
  themeId: number | null;
  /** What the article is about: title, topic and keywords. */
  tokens: Set<string>;
  /** Every content word in the body. Used to file a search, never to call it answered. */
  bodyTokens: Set<string>;
  urls: string[];
}

function loadCatalogue(): CatalogueArticle[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT a.id, COALESCE(NULLIF(TRIM(a.title), ''), a.generated_title, '') AS title, a.theme_id, a.topic,
              a.content, k.primary_keyword, k.secondary_keywords, k.long_tail_keywords
       FROM articles a
       LEFT JOIN keywords k ON k.article_id = a.id
       WHERE a.theme_id IS NOT NULL AND COALESCE(TRIM(a.content), '') != ''`,
    )
    .all() as unknown as {
    id: number;
    title: string;
    theme_id: number | null;
    topic: string | null;
    content: string;
    primary_keyword: string | null;
    secondary_keywords: string | null;
    long_tail_keywords: string | null;
  }[];

  const links = db
    .prepare(`SELECT article_id, external_url FROM article_cms_links WHERE external_url IS NOT NULL`)
    .all() as unknown as { article_id: number; external_url: string }[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    themeId: row.theme_id,
    tokens: contentTokens(
      [
        row.title,
        row.topic,
        row.primary_keyword,
        row.secondary_keywords,
        row.long_tail_keywords,
      ]
        .filter(Boolean)
        .join(' '),
    ),
    bodyTokens: contentTokens(row.content.slice(0, 60000)),
    urls: links.filter((link) => link.article_id === row.id).map((link) => normaliseUrl(link.external_url)),
  }));
}

/** How much of the search's wording a body of text accounts for. */
function wordingMatch(queryTokens: Set<string>, other: Set<string>): { shared: number; share: number } {
  let shared = 0;
  for (const token of queryTokens) if (other.has(token)) shared += 1;
  return { shared, share: queryTokens.size ? shared / queryTokens.size : 0 };
}

/**
 * Two shared content words and most of the search accounted for. One shared
 * word files "apple watch" under anything mentioning an apple.
 */
const FILE_UNDER_AREA_SHARE = 0.6;
/** Stricter: enough to say an existing article already answers the search. */
const ALREADY_ANSWERED_SHARE = 0.75;
/** Two shared words is a coincidence often enough; three rarely is. */
const ALREADY_ANSWERED_WORDS = 3;
/** A body holds thousands of words, so nearly all of the search must be in it. */
const FILE_FROM_BODY_SHARE = 0.8;
const MIN_SHARED_WORDS = 2;

export interface Filing {
  themeId: number | null;
  themeSource: 'page' | 'match' | null;
  articleId: number | null;
}

function fileSearch(
  row: { query: string; pageUrl: string },
  catalogue: CatalogueArticle[],
  themeIdsByName: Map<string, number>,
): Filing {
  if (row.pageUrl) {
    const wanted = normaliseUrl(row.pageUrl);
    const ranking = catalogue.find((article) => article.urls.includes(wanted));
    if (ranking) return { themeId: ranking.themeId, themeSource: 'page', articleId: ranking.id };
  }

  const queryTokens = contentTokens(row.query);
  if (queryTokens.size < MIN_SHARED_WORDS) return { themeId: null, themeSource: null, articleId: null };

  let best: { article: CatalogueArticle; shared: number; share: number } | null = null;
  for (const article of catalogue) {
    const match = wordingMatch(queryTokens, article.tokens);
    if (match.shared < MIN_SHARED_WORDS || match.share < FILE_UNDER_AREA_SHARE) continue;
    if (!best || match.share > best.share || (match.share === best.share && match.shared > best.shared)) {
      best = { article, ...match };
    }
  }
  if (best) {
    return {
      themeId: best.article.themeId,
      themeSource: 'match',
      articleId:
        best.share >= ALREADY_ANSWERED_SHARE && best.shared >= ALREADY_ANSWERED_WORDS ? best.article.id : null,
    };
  }

  // The area whose articles, taken together, use the search's words. Only
  // when one area is clearly ahead: a tie says the search could sit in either.
  const vocabularies = new Map<number, Set<string>>();
  for (const [themeName, themeId] of themeIdsByName) vocabularies.set(themeId, contentTokens(themeName));
  for (const article of catalogue) {
    if (article.themeId === null) continue;
    const vocabulary = vocabularies.get(article.themeId) ?? new Set<string>();
    for (const token of article.tokens) vocabulary.add(token);
    vocabularies.set(article.themeId, vocabulary);
  }
  const ranked = [...vocabularies.entries()]
    .map(([themeId, vocabulary]) => ({ themeId, ...wordingMatch(queryTokens, vocabulary) }))
    .filter((entry) => entry.shared >= MIN_SHARED_WORDS && entry.share >= FILE_UNDER_AREA_SHARE)
    .sort((a, b) => b.share - a.share);
  if (ranked.length && (ranked.length === 1 || ranked[0].share > ranked[1].share)) {
    return { themeId: ranked[0].themeId, themeSource: 'match', articleId: null };
  }

  // Nearly every word is somewhere in one article's body. Enough to say which
  // area the search belongs to; not enough to say the article answers it.
  let bestBody: { article: CatalogueArticle; share: number; subjectShared: number } | null = null;
  for (const article of catalogue) {
    const body = wordingMatch(queryTokens, article.bodyTokens);
    if (body.shared < MIN_SHARED_WORDS || body.share < FILE_FROM_BODY_SHARE) continue;
    const subjectShared = wordingMatch(queryTokens, article.tokens).shared;
    if (
      !bestBody ||
      body.share > bestBody.share ||
      (body.share === bestBody.share && subjectShared > bestBody.subjectShared)
    ) {
      bestBody = { article, share: body.share, subjectShared };
    }
  }
  if (bestBody) return { themeId: bestBody.article.themeId, themeSource: 'match', articleId: null };

  let bestScope: { themeId: number; share: number } | null = null;
  for (const [themeName, scope] of Object.entries(AREA_SCOPES)) {
    const themeId = themeIdsByName.get(themeName);
    if (!themeId) continue;
    for (const subtopic of [...scope.core, ...scope.adjacent]) {
      const match = wordingMatch(queryTokens, contentTokens(`${subtopic.name} ${subtopic.description}`));
      if (match.shared < MIN_SHARED_WORDS || match.share < FILE_UNDER_AREA_SHARE) continue;
      if (!bestScope || match.share > bestScope.share) bestScope = { themeId, share: match.share };
    }
  }
  if (bestScope) return { themeId: bestScope.themeId, themeSource: 'match', articleId: null };

  return { themeId: null, themeSource: null, articleId: null };
}

function themeIdsByName(): Map<string, number> {
  const rows = getDatabase().prepare('SELECT id, name FROM themes').all() as unknown as { id: number; name: string }[];
  return new Map(rows.map((row) => [row.name, row.id]));
}

/* ----------------------------------------------------------------- import */

export function importSearchQueries(
  rows: ParsedSearchRow[],
  options: { period?: string | null; source?: string; skipped?: number } = {},
): ImportSummary {
  const db = getDatabase();
  const catalogue = loadCatalogue();
  const themes = themeIdsByName();
  const period = options.period?.trim().slice(0, 120) || null;
  const source = options.source ?? 'gsc_csv';

  const find = db.prepare('SELECT id, theme_source FROM search_queries WHERE query = ? AND page_url = ?');
  const insert = db.prepare(
    `INSERT INTO search_queries (query, page_url, clicks, impressions, position, period, source, theme_id, theme_source, article_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateFigures = db.prepare(
    `UPDATE search_queries SET clicks = ?, impressions = ?, position = ?, period = ?, source = ?, imported_at = datetime('now')
     WHERE id = ?`,
  );
  const updateFiling = db.prepare('UPDATE search_queries SET theme_id = ?, theme_source = ?, article_id = ? WHERE id = ?');

  const summary: ImportSummary = { rows: rows.length, added: 0, updated: 0, filed: 0, unfiled: 0, skipped: options.skipped ?? 0 };

  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const filing = fileSearch(row, catalogue, themes);
      const existing = find.get(row.query, row.pageUrl) as { id: number; theme_source: string | null } | undefined;

      if (existing) {
        updateFigures.run(row.clicks, row.impressions, row.position, period, source, existing.id);
        // An editor's filing stands. Anything else is re-decided, because the
        // catalogue it was decided against has grown since.
        if (existing.theme_source !== 'manual') {
          updateFiling.run(filing.themeId, filing.themeSource, filing.articleId, existing.id);
        }
        summary.updated += 1;
      } else {
        insert.run(
          row.query,
          row.pageUrl,
          row.clicks,
          row.impressions,
          row.position,
          period,
          source,
          filing.themeId,
          filing.themeSource,
          filing.articleId,
        );
        summary.added += 1;
      }

      if (filing.themeId || existing?.theme_source === 'manual') summary.filed += 1;
      else summary.unfiled += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return summary;
}

/* ------------------------------------------------------------------ reads */

const SELECT = `
  SELECT q.id, q.query, q.page_url, q.clicks, q.impressions, q.position, q.period, q.source,
         q.theme_id, q.theme_source, q.article_id, q.imported_at,
         COALESCE(NULLIF(TRIM(a.title), ''), a.generated_title) AS article_title
  FROM search_queries q
  LEFT JOIN articles a ON a.id = q.article_id`;

function mapRow(row: any): SearchQueryDto {
  return {
    id: row.id,
    query: row.query,
    pageUrl: row.page_url,
    clicks: row.clicks,
    impressions: row.impressions,
    position: row.position,
    period: row.period,
    source: row.source,
    themeId: row.theme_id,
    themeSource: row.theme_source,
    articleId: row.article_id,
    articleTitle: row.article_title ?? null,
    importedAt: row.imported_at,
  };
}

export function listSearchQueries(): SearchQueryDto[] {
  return (getDatabase().prepare(`${SELECT} ORDER BY q.impressions DESC, q.query ASC`).all() as unknown[]).map(mapRow);
}

export function listSearchQueriesForTheme(themeId: number): SearchQueryDto[] {
  return (
    getDatabase().prepare(`${SELECT} WHERE q.theme_id = ? ORDER BY q.impressions DESC, q.query ASC`).all(themeId) as unknown[]
  ).map(mapRow);
}

/** An editor files a search under an area, or takes it out of one. */
export function fileSearchQuery(id: number, themeId: number | null): SearchQueryDto | null {
  const db = getDatabase();
  const changed = db
    .prepare('UPDATE search_queries SET theme_id = ?, theme_source = ? WHERE id = ?')
    .run(themeId, 'manual', id);
  if (!changed.changes) return null;
  return mapRow(db.prepare(`${SELECT} WHERE q.id = ?`).get(id));
}

export function deleteSearchQuery(id: number): boolean {
  return getDatabase().prepare('DELETE FROM search_queries WHERE id = ?').run(id).changes > 0;
}

/** The stored figures for one search, however it was capitalised. Null when it was never recorded. */
export function findRecordedSearch(query: string | null | undefined): SearchQueryDto | null {
  const wanted = query?.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!wanted) return null;
  const row = getDatabase().prepare(`${SELECT} WHERE q.query = ? ORDER BY q.impressions DESC LIMIT 1`).get(wanted);
  return row ? mapRow(row) : null;
}

/* ------------------------------------------------ what topic research reads */

/** Enough to choose from without burying the brief. */
const MAX_SEARCHES_IN_PROMPT = 25;

function figures(row: SearchQueryDto): string {
  const parts = [`${row.impressions} impression${row.impressions === 1 ? '' : 's'}`];
  if (row.clicks) parts.push(`${row.clicks} click${row.clicks === 1 ? '' : 's'}`);
  if (row.position !== null) parts.push(`position ${Math.round(row.position)}`);
  return parts.join(', ');
}

/**
 * The searches recorded for an area, as the research stage reads them.
 *
 * TWO LISTS, BECAUSE THEY ASK FOR OPPOSITE THINGS. A search no article
 * answers is an article to write. A search an article already answers is NOT:
 * writing it again is the repeat the coverage gates exist to stop, and the
 * right response is to improve the page that already ranks.
 *
 * AN AREA WITH NO SEARCHES STILL GETS THE INSTRUCTION. The site is young and
 * most areas have nothing recorded yet. The article must still answer one
 * question a searcher would type — it just has to say that the demand is
 * inferred rather than measured, so nobody mistakes a guess for a figure.
 */
export function buildSearchDemandBlock(themeId: number | null): string {
  const rows = themeId ? listSearchQueriesForTheme(themeId) : [];

  if (!rows.length) {
    return [
      '=== WHAT SEARCHERS ASKED GOOGLE ===',
      'Search Console has recorded no searches for this area yet.',
      'Every topic must still answer one specific question a searcher would type into Google. Write that question in "answers_query", in the words a searcher would use.',
      'Say in "search_opportunity" that the demand is inferred, not measured.',
      '',
    ].join('\n');
  }

  const unanswered = rows.filter((row) => row.articleId === null).slice(0, MAX_SEARCHES_IN_PROMPT);
  const answered = rows.filter((row) => row.articleId !== null).slice(0, MAX_SEARCHES_IN_PROMPT);
  const newest = rows.reduce((latest, row) => (row.importedAt > latest ? row.importedAt : latest), '');
  const period = rows.find((row) => row.period)?.period;

  const lines = [
    `=== WHAT SEARCHERS ASKED GOOGLE (Search Console, imported ${newest.slice(0, 10)}${period ? `, ${period}` : ''}) ===`,
    'These are real searches Google showed this site for. They are the only demand figures you have. Do not invent others.',
  ];

  if (unanswered.length) {
    lines.push(
      'Searches Cynth matched to no article. Check each against the catalogue above first: where an article there already answers one, treat it as answered.',
    );
    for (const row of unanswered) lines.push(`- "${row.query}" (${figures(row)})`);
  }

  if (answered.length) {
    lines.push(
      'Searches an existing article already answers. Do not propose these again. A question the same searcher would ask next is fair game:',
    );
    for (const row of answered) lines.push(`- "${row.query}" (${figures(row)}) → "${row.articleTitle ?? 'an existing article'}"`);
  }

  lines.push(
    unanswered.length
      ? 'Prefer a topic that answers a search nothing on the site answers yet. Where a topic does, copy that search exactly into "answers_query".'
      : 'Nothing here is unanswered, so propose the question these searchers would ask next.',
    'Where a topic answers a question that is not listed, write the question a searcher would type in "answers_query" and say in "search_opportunity" that its demand is inferred, not measured.',
    '',
  );

  return lines.join('\n');
}

/** The line the keyword stage is given about the search an article answers. */
export function describeAnsweredSearch(answersQuery: string | null | undefined): string {
  const query = answersQuery?.trim();
  if (!query) return '';
  const recorded = findRecordedSearch(query);
  return [
    `The search this article answers: "${query}"${recorded ? ` (Search Console: ${figures(recorded)})` : ' (inferred; Search Console has not recorded it)'}.`,
    'Make it, or its most natural phrasing, the primary keyword. The title must be recognisably the answer to it, and the introduction must answer it in its first two sentences.',
  ].join('\n');
}
