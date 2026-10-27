import { createHash } from 'node:crypto';
import { getDatabase } from '../../shared/database/index.js';
import { getSetting } from '../../shared/settings/settings.repository.js';
import {
  blobToVector,
  embedTexts,
  resolveEmbeddingTarget,
  similarity,
  vectorToBlob,
} from './embeddings.service.js';
import type { EmbeddingResult } from './embeddings.service.js';
import { AREA_SCOPES, subtopicInput } from './coverageScope.js';
import { embeddingInput, INTRODUCTION_HEADING, splitIntoPoints } from './points.js';

/**
 * THE COVERAGE GRAPH: WHAT THE PUBLICATION HAS ALREADY SAID.
 *
 * The coverage list topic research used to receive was titles. A title says
 * what an article is called, not what it says, so a new article could pick a
 * fresh subject and still re-explain, section for section, what three other
 * articles already explain — and that was happening (caffeine timing is
 * explained in three articles across two areas).
 *
 * This holds every article as the points it makes, each one embedded, and
 * links points that say the same thing. Three gates read it:
 *   1. topic   — a proposed topic too close to an existing article is dropped
 *                before anyone chooses it (topic_screen stage).
 *   2. section — a planned section too close to an existing point is cut from
 *                the brief, and the run stops if too much of the brief goes
 *                (section_screen stage). Nothing is drafted past this.
 *   3. draft   — the written draft is checked against every point; a close
 *                match is sent to the reviewer as a required change, and final
 *                validation blocks if one survives.
 *
 * And it holds each area's subtopics, so topic research is told which parts of
 * its own brief it has never reached instead of inferring that from titles.
 *
 * THE THRESHOLDS ARE MEASURED, NOT CHOSEN. Set from scripts/coverage-calibrate.ts
 * and scripts/coverage-probe.ts against the 25 articles live in October 2026:
 *   topic:   reworded duplicates scored 0.67–0.80, genuinely new topics 0.42–0.50,
 *            close neighbours 0.59–0.62.
 *   section: duplicated sections 0.63–0.84, new sections 0.38–0.58.
 *   draft:   known repeated passages 0.77–0.79, unrelated pairs median 0.61.
 * Each is a setting, so they can be moved without a release.
 *
 * WHEN EMBEDDING IS UNAVAILABLE THE GATES FAIL CLOSED. A gate that cannot
 * look is not a gate that passed: the stage fails with a readable error and
 * nothing is written.
 */

export type Embedder = (texts: string[]) => Promise<EmbeddingResult>;

const defaultEmbedder: Embedder = (texts) => embedTexts(texts);

/* ------------------------------------------------------------ thresholds --- */

export interface CoverageThresholds {
  /** A proposed topic at or above this is the same article as an existing one. */
  topicStop: number;
  /** A proposed topic at or above this is a close neighbour and must say how it differs. */
  topicNeighbour: number;
  /** A planned section at or above this repeats an existing point and is cut. */
  sectionCut: number;
  /** The run stops when more than this share of the planned sections is cut. */
  maxCutShare: number;
  /** A drafted section at or above this repeats an existing point. */
  draftBlock: number;
  /** Two stored points at or above this are linked in the graph. */
  pointLink: number;
  /** A point counts towards a subtopic only at or above this. */
  subtopicMatch: number;
}

export const DEFAULT_THRESHOLDS: CoverageThresholds = {
  topicStop: 0.65,
  topicNeighbour: 0.57,
  sectionCut: 0.62,
  maxCutShare: 0.4,
  draftBlock: 0.76,
  pointLink: 0.7,
  subtopicMatch: 0.42,
};

const THRESHOLD_SETTINGS: Record<keyof CoverageThresholds, string> = {
  topicStop: 'coverage.topic_stop',
  topicNeighbour: 'coverage.topic_neighbour',
  sectionCut: 'coverage.section_cut',
  maxCutShare: 'coverage.max_cut_share',
  draftBlock: 'coverage.draft_block',
  pointLink: 'coverage.point_link',
  subtopicMatch: 'coverage.subtopic_match',
};

export function getThresholds(): CoverageThresholds {
  const out = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(THRESHOLD_SETTINGS) as (keyof CoverageThresholds)[]) {
    const raw = getSetting(THRESHOLD_SETTINGS[key]);
    const value = raw === null ? NaN : Number(raw);
    if (Number.isFinite(value) && value > 0 && value <= 1) out[key] = value;
  }
  return out;
}

export function thresholdSettingKeys(): Record<keyof CoverageThresholds, string> {
  return { ...THRESHOLD_SETTINGS };
}

/* ----------------------------------------------------------------- sync --- */

export interface SyncSummary {
  model: string;
  indexed: number[];
  removed: number[];
  subtopicsEmbedded: number;
  promptTokens: number;
  reportedCost: number | null;
}

function hashOf(title: string, content: string): string {
  return createHash('sha256').update(title).update('\u0000').update(content).digest('hex');
}

function addCost(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/** Seeds every area's subtopics from coverageScope.ts. Never overwrites a decision. */
function seedSubtopics(): void {
  const db = getDatabase();
  const themes = db.prepare('SELECT id, name FROM themes').all() as { id: number; name: string }[];
  const insert = db.prepare(
    `INSERT INTO coverage_subtopics (theme_id, name, description, ring) VALUES (?, ?, ?, ?)
     ON CONFLICT(theme_id, name) DO UPDATE SET
       description = excluded.description,
       -- A subtopic that was only proposed and has since been written into the
       -- scope file takes the scope file's ring. A rejection is never undone here.
       ring = CASE WHEN coverage_subtopics.ring = 'proposed' THEN excluded.ring ELSE coverage_subtopics.ring END,
       vector = CASE WHEN coverage_subtopics.description = excluded.description THEN coverage_subtopics.vector ELSE NULL END`,
  );
  for (const theme of themes) {
    const scope = AREA_SCOPES[theme.name];
    if (!scope) continue;
    for (const sub of scope.core) insert.run(theme.id, sub.name, sub.description, 'core');
    for (const sub of scope.adjacent) insert.run(theme.id, sub.name, sub.description, 'adjacent');
  }
}

/**
 * Brings the graph up to date with the articles table.
 *
 * Cheap when nothing changed: an article is embedded only when its title or
 * content hash differs from what was indexed, or the embedding model changed.
 * Called at the start of every topic research, so the graph a run reads is
 * never older than the catalogue.
 */
export async function syncCoverageGraph(embed: Embedder = defaultEmbedder, model = currentModel()): Promise<SyncSummary> {
  const db = getDatabase();
  seedSubtopics();

  const summary: SyncSummary = { model, indexed: [], removed: [], subtopicsEmbedded: 0, promptTokens: 0, reportedCost: null };

  // Subtopic vectors first, so the article pass can assign subtopics.
  const staleSubtopics = db
    .prepare(`SELECT id, name, description FROM coverage_subtopics WHERE vector IS NULL OR model IS NOT ? `)
    .all(model) as { id: number; name: string; description: string }[];
  if (staleSubtopics.length) {
    const result = await embed(staleSubtopics.map(subtopicInput));
    const update = db.prepare('UPDATE coverage_subtopics SET vector = ?, model = ? WHERE id = ?');
    staleSubtopics.forEach((sub, i) => update.run(vectorToBlob(result.vectors[i]), model, sub.id));
    summary.subtopicsEmbedded = staleSubtopics.length;
    summary.promptTokens += result.promptTokens;
    summary.reportedCost = addCost(summary.reportedCost, result.reportedCost);
  }

  const articles = db
    .prepare(
      `SELECT id, theme_id, COALESCE(NULLIF(TRIM(title), ''), generated_title, '') AS title, content
       FROM articles WHERE TRIM(COALESCE(content, '')) <> ''`,
    )
    .all() as { id: number; theme_id: number | null; title: string; content: string }[];

  const indexed = new Map(
    (db.prepare('SELECT article_id, content_hash, model, theme_id FROM coverage_articles').all() as {
      article_id: number;
      content_hash: string;
      model: string;
      theme_id: number | null;
    }[]).map((row) => [row.article_id, row]),
  );

  const live = new Set(articles.map((a) => a.id));
  for (const articleId of indexed.keys()) {
    if (!live.has(articleId)) {
      db.prepare('DELETE FROM coverage_articles WHERE article_id = ?').run(articleId);
      summary.removed.push(articleId);
    }
  }

  for (const article of articles) {
    const hash = hashOf(article.title, article.content);
    const existing = indexed.get(article.id);
    if (existing && existing.content_hash === hash && existing.model === model) {
      // The area can change without the text changing; that needs no embedding.
      if (existing.theme_id !== article.theme_id) {
        db.prepare('UPDATE coverage_articles SET theme_id = ? WHERE article_id = ?').run(article.theme_id, article.id);
        assignSubtopics(article.id);
      }
      continue;
    }

    const result = await indexArticle(article, hash, model, embed);
    summary.indexed.push(article.id);
    summary.promptTokens += result.promptTokens;
    summary.reportedCost = addCost(summary.reportedCost, result.reportedCost);
  }

  if (summary.subtopicsEmbedded > 0) {
    for (const article of articles) if (!summary.indexed.includes(article.id)) assignSubtopics(article.id);
  }

  return summary;
}

function currentModel(): string {
  return resolveEmbeddingTarget().model;
}

async function indexArticle(
  article: { id: number; theme_id: number | null; title: string; content: string },
  hash: string,
  model: string,
  embed: Embedder,
): Promise<EmbeddingResult> {
  const db = getDatabase();
  const points = splitIntoPoints(article.content);
  const intro = points.find((p) => p.heading === INTRODUCTION_HEADING)?.text ?? '';

  const result = await embed([topicInput(article.title, intro), ...points.map(embeddingInput)]);
  const [topicVector, ...pointVectors] = result.vectors;

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM coverage_articles WHERE article_id = ?').run(article.id);
    db.prepare(
      `INSERT INTO coverage_articles (article_id, theme_id, title, content_hash, model, topic_vector, prompt_tokens, reported_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(article.id, article.theme_id, article.title, hash, model, vectorToBlob(topicVector), result.promptTokens, result.reportedCost);

    const insert = db.prepare(
      `INSERT INTO coverage_points (article_id, ordinal, heading, parent_heading, excerpt, word_count, model, vector)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    points.forEach((point, i) =>
      insert.run(
        article.id,
        point.ordinal,
        point.heading,
        point.parentHeading,
        point.text.slice(0, 240),
        point.wordCount,
        model,
        vectorToBlob(pointVectors[i]),
      ),
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  linkPoints(article.id, model);
  assignSubtopics(article.id);
  return result;
}

/** What an article is about, as compared at the topic gate. */
export function topicInput(title: string, introduction: string): string {
  return `${title}\n${introduction.slice(0, 1200)}`;
}

/* ---------------------------------------------------------------- reads --- */

export interface StoredPoint {
  id: number;
  articleId: number;
  articleTitle: string;
  themeId: number | null;
  heading: string;
  parentHeading: string | null;
  excerpt: string;
  url: string | null;
  vector: Float32Array;
}

function urlSubquery(alias: string): string {
  return `(SELECT l.external_url FROM article_cms_links l WHERE l.article_id = ${alias}
           ORDER BY CASE WHEN l.external_status = 'publish' THEN 0 ELSE 1 END, l.id DESC LIMIT 1)`;
}

function loadPoints(model: string, options: { excludeArticleId?: number | null; articleId?: number } = {}): StoredPoint[] {
  const rows = getDatabase()
    .prepare(
      `SELECT p.id, p.article_id, a.title, a.theme_id, p.heading, p.parent_heading, p.excerpt, p.vector,
              ${urlSubquery('p.article_id')} AS url
       FROM coverage_points p JOIN coverage_articles a ON a.article_id = p.article_id
       WHERE p.model = ? AND (? IS NULL OR p.article_id != ?) AND (? IS NULL OR p.article_id = ?)
       ORDER BY p.article_id, p.ordinal`,
    )
    .all(
      model,
      options.excludeArticleId ?? null,
      options.excludeArticleId ?? null,
      options.articleId ?? null,
      options.articleId ?? null,
    ) as {
    id: number;
    article_id: number;
    title: string;
    theme_id: number | null;
    heading: string;
    parent_heading: string | null;
    excerpt: string;
    vector: Uint8Array;
    url: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    articleId: row.article_id,
    articleTitle: row.title,
    themeId: row.theme_id,
    heading: row.heading,
    parentHeading: row.parent_heading,
    excerpt: row.excerpt,
    url: row.url,
    vector: blobToVector(row.vector),
  }));
}

interface StoredArticle {
  articleId: number;
  title: string;
  themeId: number | null;
  url: string | null;
  vector: Float32Array;
}

function loadArticles(model: string, excludeArticleId?: number | null): StoredArticle[] {
  const rows = getDatabase()
    .prepare(
      `SELECT a.article_id, a.title, a.theme_id, a.topic_vector, ${urlSubquery('a.article_id')} AS url
       FROM coverage_articles a WHERE a.model = ? AND (? IS NULL OR a.article_id != ?)`,
    )
    .all(model, excludeArticleId ?? null, excludeArticleId ?? null) as {
    article_id: number;
    title: string;
    theme_id: number | null;
    topic_vector: Uint8Array;
    url: string | null;
  }[];
  return rows.map((row) => ({
    articleId: row.article_id,
    title: row.title,
    themeId: row.theme_id,
    url: row.url,
    vector: blobToVector(row.topic_vector),
  }));
}

interface StoredSubtopic {
  id: number;
  themeId: number;
  name: string;
  description: string;
  ring: string;
  vector: Float32Array | null;
}

function loadSubtopics(themeId: number, model: string): StoredSubtopic[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, theme_id, name, description, ring, vector, model FROM coverage_subtopics
       WHERE theme_id = ? ORDER BY CASE ring WHEN 'core' THEN 0 WHEN 'adjacent' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, id`,
    )
    .all(themeId) as {
    id: number;
    theme_id: number;
    name: string;
    description: string;
    ring: string;
    vector: Uint8Array | null;
    model: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    themeId: row.theme_id,
    name: row.name,
    description: row.description,
    ring: row.ring,
    vector: row.vector && row.model === model ? blobToVector(row.vector) : null,
  }));
}

function best<T extends { vector: Float32Array | null }>(probe: Float32Array, pool: T[]): { item: T; score: number } | null {
  let found: { item: T; score: number } | null = null;
  for (const item of pool) {
    if (!item.vector) continue;
    const score = similarity(probe, item.vector);
    if (!found || score > found.score) found = { item, score };
  }
  return found;
}

/* ---------------------------------------------------------------- edges --- */

/** Links an article's points to every point elsewhere that says much the same thing. */
function linkPoints(articleId: number, model: string): void {
  const db = getDatabase();
  const { pointLink } = getThresholds();
  const own = loadPoints(model, { articleId });
  const others = loadPoints(model, { excludeArticleId: articleId });
  const insert = db.prepare(
    'INSERT OR REPLACE INTO coverage_point_links (point_id, other_point_id, score) VALUES (?, ?, ?)',
  );
  for (const point of own) {
    for (const other of others) {
      const score = similarity(point.vector, other.vector);
      if (score < pointLink) continue;
      insert.run(point.id, other.id, score);
      insert.run(other.id, point.id, score);
    }
  }
}

/**
 * Which of its area's subtopics an article covers.
 *
 * The PRIMARY subtopic is the one its title and introduction sit closest to:
 * what the article is about. A subtopic is TOUCHED when at least one of its
 * sections sits closest to it, at or above the match threshold.
 */
export function assignSubtopics(articleId: number): void {
  const db = getDatabase();
  const article = db
    .prepare('SELECT theme_id, model, topic_vector FROM coverage_articles WHERE article_id = ?')
    .get(articleId) as { theme_id: number | null; model: string; topic_vector: Uint8Array } | undefined;

  db.prepare('DELETE FROM coverage_article_subtopics WHERE article_id = ?').run(articleId);
  if (!article?.theme_id) return;

  const subtopics = loadSubtopics(article.theme_id, article.model).filter(
    (sub) => sub.ring !== 'rejected' && sub.ring !== 'proposed',
  );
  if (!subtopics.length) return;

  const { subtopicMatch } = getThresholds();
  const tally = new Map<number, { points: number; score: number; primary: boolean }>();

  const primary = best(blobToVector(article.topic_vector), subtopics);
  if (primary) tally.set(primary.item.id, { points: 0, score: primary.score, primary: true });

  for (const point of loadPoints(article.model, { articleId })) {
    if (point.heading === INTRODUCTION_HEADING) continue;
    const nearest = best(point.vector, subtopics);
    if (!nearest || nearest.score < subtopicMatch) continue;
    const entry = tally.get(nearest.item.id) ?? { points: 0, score: 0, primary: false };
    entry.points += 1;
    entry.score = Math.max(entry.score, nearest.score);
    tally.set(nearest.item.id, entry);
  }

  const insert = db.prepare(
    'INSERT INTO coverage_article_subtopics (article_id, subtopic_id, points, score, is_primary) VALUES (?, ?, ?, ?, ?)',
  );
  for (const [subtopicId, entry] of tally) insert.run(articleId, subtopicId, entry.points, entry.score, entry.primary ? 1 : 0);
}

/* ------------------------------------------------------------- the gates --- */

export interface CoverageMatch {
  articleId: number;
  title: string;
  url: string | null;
  heading?: string;
  excerpt?: string;
  score: number;
}

export type TopicVerdict = 'clear' | 'neighbour' | 'duplicate';

export interface TopicScreen {
  verdict: TopicVerdict;
  /** The closest existing article, as a whole. */
  nearestArticle: CoverageMatch | null;
  /** The closest existing section anywhere, for context. */
  nearestPoint: CoverageMatch | null;
  /** The area subtopic this topic sits closest to. */
  nearestSubtopic: { id: number; name: string; ring: string; score: number } | null;
}

/** Scores proposed topics against every article in every area. */
export async function screenTopics(
  topics: string[],
  options: { themeId: number | null; excludeArticleId?: number | null; embed?: Embedder; model?: string },
): Promise<{ screens: TopicScreen[]; promptTokens: number; reportedCost: number | null; model: string }> {
  const model = options.model ?? currentModel();
  const embed = options.embed ?? defaultEmbedder;
  const thresholds = getThresholds();
  if (!topics.length) return { screens: [], promptTokens: 0, reportedCost: null, model };

  const result = await embed(topics);
  const articles = loadArticles(model, options.excludeArticleId);
  const points = loadPoints(model, { excludeArticleId: options.excludeArticleId });
  const subtopics = options.themeId
    ? loadSubtopics(options.themeId, model).filter((sub) => sub.ring !== 'rejected')
    : [];

  const screens = result.vectors.map((vector): TopicScreen => {
    const article = best(vector, articles);
    const point = best(vector, points);
    const subtopic = best(vector, subtopics);
    const score = article?.score ?? 0;
    return {
      verdict: score >= thresholds.topicStop ? 'duplicate' : score >= thresholds.topicNeighbour ? 'neighbour' : 'clear',
      nearestArticle: article
        ? { articleId: article.item.articleId, title: article.item.title, url: article.item.url, score: article.score }
        : null,
      nearestPoint: point
        ? {
            articleId: point.item.articleId,
            title: point.item.articleTitle,
            url: point.item.url,
            heading: point.item.heading,
            excerpt: point.item.excerpt,
            score: point.score,
          }
        : null,
      nearestSubtopic: subtopic
        ? { id: subtopic.item.id, name: subtopic.item.name, ring: subtopic.item.ring, score: subtopic.score }
        : null,
    };
  });

  return { screens, promptTokens: result.promptTokens, reportedCost: result.reportedCost, model };
}

export interface PlannedSection {
  heading: string;
  covers: string;
}

export type SectionVerdict = 'keep' | 'cut';

export interface SectionScreen extends PlannedSection {
  verdict: SectionVerdict;
  match: CoverageMatch | null;
}

/** What is embedded for a planned section — the same shape a stored point has. */
export function plannedSectionInput(section: PlannedSection): string {
  return section.covers ? `${section.heading}\nCovers: ${section.covers}` : section.heading;
}

export async function screenSections(
  sections: PlannedSection[],
  options: { excludeArticleId?: number | null; embed?: Embedder; model?: string },
): Promise<{ screens: SectionScreen[]; promptTokens: number; reportedCost: number | null; model: string }> {
  const model = options.model ?? currentModel();
  const embed = options.embed ?? defaultEmbedder;
  const { sectionCut } = getThresholds();
  if (!sections.length) return { screens: [], promptTokens: 0, reportedCost: null, model };

  const result = await embed(sections.map(plannedSectionInput));
  const points = loadPoints(model, { excludeArticleId: options.excludeArticleId });

  const screens = sections.map((section, i): SectionScreen => {
    const nearest = best(result.vectors[i], points);
    const match = nearest
      ? {
          articleId: nearest.item.articleId,
          title: nearest.item.articleTitle,
          url: nearest.item.url,
          heading: nearest.item.heading,
          excerpt: nearest.item.excerpt,
          score: nearest.score,
        }
      : null;
    return { ...section, verdict: match && match.score >= sectionCut ? 'cut' : 'keep', match };
  });

  return { screens, promptTokens: result.promptTokens, reportedCost: result.reportedCost, model };
}

export interface DraftOverlap {
  heading: string;
  parentHeading: string | null;
  match: CoverageMatch;
}

/** Every drafted section that repeats a point another article already makes. */
export async function screenDraft(
  markdown: string,
  options: { excludeArticleId?: number | null; embed?: Embedder; model?: string },
): Promise<{ overlaps: DraftOverlap[]; checked: number; promptTokens: number; reportedCost: number | null; model: string }> {
  const model = options.model ?? currentModel();
  const embed = options.embed ?? defaultEmbedder;
  const { draftBlock } = getThresholds();

  // The introduction is excluded: it restates the subject by design, and the
  // topic gate has already judged the subject.
  const points = splitIntoPoints(markdown).filter((p) => p.heading !== INTRODUCTION_HEADING);
  if (!points.length) return { overlaps: [], checked: 0, promptTokens: 0, reportedCost: null, model };

  const result = await embed(points.map(embeddingInput));
  const stored = loadPoints(model, { excludeArticleId: options.excludeArticleId });

  const overlaps: DraftOverlap[] = [];
  points.forEach((point, i) => {
    const nearest = best(result.vectors[i], stored);
    if (!nearest || nearest.score < draftBlock) return;
    overlaps.push({
      heading: point.heading,
      parentHeading: point.parentHeading,
      match: {
        articleId: nearest.item.articleId,
        title: nearest.item.articleTitle,
        url: nearest.item.url,
        heading: nearest.item.heading,
        excerpt: nearest.item.excerpt,
        score: nearest.score,
      },
    });
  });

  return { overlaps, checked: points.length, promptTokens: result.promptTokens, reportedCost: result.reportedCost, model };
}

/* -------------------------------------------------------------- reports --- */

export interface SubtopicCoverage {
  id: number;
  name: string;
  description: string;
  ring: string;
  coreIdea: string | null;
  /** Articles whose main subject this is. */
  primaryArticles: { id: number; title: string }[];
  /** Articles with at least one section on it. */
  touchedBy: { id: number; title: string; points: number }[];
  proposedByPipelineId: number | null;
  createdAt: string;
}

export function subtopicCoverage(themeId: number): SubtopicCoverage[] {
  const db = getDatabase();
  const subtopics = db
    .prepare(
      `SELECT id, name, description, ring, core_idea, proposed_by_pipeline_id, created_at FROM coverage_subtopics
       WHERE theme_id = ? ORDER BY CASE ring WHEN 'core' THEN 0 WHEN 'adjacent' THEN 1 WHEN 'approved' THEN 2 WHEN 'proposed' THEN 3 ELSE 4 END, id`,
    )
    .all(themeId) as {
    id: number;
    name: string;
    description: string;
    ring: string;
    core_idea: string | null;
    proposed_by_pipeline_id: number | null;
    created_at: string;
  }[];

  const edges = db
    .prepare(
      `SELECT s.subtopic_id, s.points, s.is_primary, a.article_id, a.title FROM coverage_article_subtopics s
       JOIN coverage_articles a ON a.article_id = s.article_id WHERE a.theme_id = ?`,
    )
    .all(themeId) as { subtopic_id: number; points: number; is_primary: number; article_id: number; title: string }[];

  return subtopics.map((sub) => {
    const mine = edges.filter((edge) => edge.subtopic_id === sub.id);
    return {
      id: sub.id,
      name: sub.name,
      description: sub.description,
      ring: sub.ring,
      coreIdea: sub.core_idea,
      primaryArticles: mine.filter((e) => e.is_primary === 1).map((e) => ({ id: e.article_id, title: e.title })),
      touchedBy: mine.filter((e) => e.points > 0).map((e) => ({ id: e.article_id, title: e.title, points: e.points })),
      proposedByPipelineId: sub.proposed_by_pipeline_id,
      createdAt: sub.created_at,
    };
  });
}

/** True when an area's subtopic is written about as an article's main subject, or by two or more sections. */
export function isCovered(sub: SubtopicCoverage): boolean {
  return sub.primaryArticles.length > 0 || sub.touchedBy.reduce((n, t) => n + t.points, 0) >= 2;
}

/**
 * Records a subtopic topic research proposed outside the area's scope.
 * It is not usable until a person approves it.
 */
export function proposeSubtopic(input: {
  themeId: number;
  name: string;
  coreIdea: string;
  pipelineId: number;
}): { id: number; ring: string } {
  const db = getDatabase();
  const name = input.name.trim().slice(0, 120);
  const existing = db
    .prepare('SELECT id, ring FROM coverage_subtopics WHERE theme_id = ? AND lower(name) = lower(?)')
    .get(input.themeId, name) as { id: number; ring: string } | undefined;
  if (existing) return existing;

  const result = db
    .prepare(
      `INSERT INTO coverage_subtopics (theme_id, name, description, ring, core_idea, proposed_by_pipeline_id)
       VALUES (?, ?, ?, 'proposed', ?, ?)`,
    )
    .run(input.themeId, name, name, input.coreIdea.trim().slice(0, 600), input.pipelineId);
  return { id: Number(result.lastInsertRowid), ring: 'proposed' };
}

/** A person's decision on a proposed subtopic. Approved joins the area; rejected is never offered again. */
export function decideSubtopic(subtopicId: number, decision: 'approve' | 'reject'): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE coverage_subtopics SET ring = ?, decided_at = datetime('now'), vector = NULL
       WHERE id = ? AND ring = 'proposed'`,
    )
    .run(decision === 'approve' ? 'approved' : 'rejected', subtopicId);
  return Number(result.changes) > 0;
}

export function findSubtopicByName(themeId: number, name: string): { id: number; name: string; ring: string } | null {
  return (
    (getDatabase()
      .prepare('SELECT id, name, ring FROM coverage_subtopics WHERE theme_id = ? AND lower(name) = lower(?)')
      .get(themeId, name.trim()) as { id: number; name: string; ring: string } | undefined) ?? null
  );
}

/* -------------------------------------------------------------- prompt --- */

const MAX_HEADINGS_PER_ARTICLE = 14;
const OTHER_AREA_LIMIT = 25;

/**
 * The graph as topic research reads it: what each article in this area SAYS,
 * section by section, and which of the area's subtopics have never been
 * written about.
 *
 * Built from stored rows only. A model is never asked what the site contains.
 */
export function buildGraphBlock(themeId: number | null, themeName: string | null, excludeArticleId?: number): string {
  const db = getDatabase();
  const articles = db
    .prepare(
      `SELECT a.article_id, a.title, a.theme_id, t.name AS theme_name FROM coverage_articles a
       LEFT JOIN themes t ON t.id = a.theme_id
       WHERE (? IS NULL OR a.article_id != ?) ORDER BY a.article_id DESC`,
    )
    .all(excludeArticleId ?? null, excludeArticleId ?? null) as {
    article_id: number;
    title: string;
    theme_id: number | null;
    theme_name: string | null;
  }[];

  const lines: string[] = ['=== WHAT THIS PUBLICATION HAS ALREADY WRITTEN ==='];
  const sameArea = articles.filter((a) => themeId !== null && a.theme_id === themeId);
  const otherAreas = articles.filter((a) => a.theme_id !== themeId).slice(0, OTHER_AREA_LIMIT);

  if (sameArea.length) {
    lines.push(`In THIS area (${sameArea.length}), with the sections each one already contains:`);
    const headingsOf = db.prepare(
      `SELECT heading, parent_heading FROM coverage_points WHERE article_id = ? AND heading != ? ORDER BY ordinal`,
    );
    for (const article of sameArea) {
      const headings = (headingsOf.all(article.article_id, INTRODUCTION_HEADING) as { heading: string; parent_heading: string | null }[])
        .map((h) => h.heading)
        .slice(0, MAX_HEADINGS_PER_ARTICLE);
      lines.push(`  - "${article.title}"`);
      if (headings.length) lines.push(`      sections: ${headings.join(' | ')}`);
    }
  } else {
    lines.push('In THIS area: nothing has been written yet.');
  }

  if (otherAreas.length) {
    lines.push('', 'In other areas (context only — do not propose topics from these areas, and do not re-explain what they cover):');
    for (const article of otherAreas) lines.push(`  - [${article.theme_name ?? 'unassigned'}] "${article.title}"`);
  }

  const scope = themeName ? AREA_SCOPES[themeName] : null;
  if (themeId !== null && scope) {
    const coverage = subtopicCoverage(themeId);
    const label = (sub: SubtopicCoverage) => {
      if (!isCovered(sub)) return sub.name;
      const articles = new Set([...sub.primaryArticles.map((a) => a.id), ...sub.touchedBy.map((t) => t.id)]).size;
      return `${sub.name} (in ${articles} article${articles === 1 ? '' : 's'})`;
    };
    const uncoveredCore = coverage.filter((s) => s.ring === 'core' && !isCovered(s));
    const coveredCore = coverage.filter((s) => s.ring === 'core' && isCovered(s));
    const ring = coverage.filter((s) => s.ring === 'adjacent' || s.ring === 'approved');
    const pending = coverage.filter((s) => s.ring === 'proposed');
    const rejected = coverage.filter((s) => s.ring === 'rejected');

    lines.push(
      '',
      '=== THIS AREA\'S SCOPE, AND HOW MUCH OF IT HAS BEEN REACHED ===',
      `Core idea every article here serves: ${scope.coreIdea}`,
      `Core subtopics NOT yet written about (${uncoveredCore.length}): ${uncoveredCore.map((s) => s.name).join(' | ') || 'none'}`,
      `Core subtopics already covered (${coveredCore.length}): ${coveredCore.map(label).join(' | ') || 'none'}`,
      `Adjacent ring — in scope, further from the centre: ${ring.map(label).join(' | ') || 'none'}`,
    );
    if (pending.length) lines.push(`Proposed and waiting for the editor (do not propose again): ${pending.map((s) => s.name).join(' | ')}`);
    if (rejected.length) lines.push(`Rejected by the editor (never propose): ${rejected.map((s) => s.name).join(' | ')}`);
  }

  lines.push(
    '',
    'HOW TO USE THIS:',
    '- Every section listed above is already written. A new article must not explain any of them again, in any area. Where a new article needs one of those points, it will link to the existing article in a sentence instead.',
    '- Do not propose a topic that is substantially the same article as one above, however differently worded. Cynth measures this, and a topic that is too close is discarded before anyone sees it.',
    '- Widen the area: prefer an uncovered core subtopic first, then the adjacent ring. A subtopic already covered is only worth another article if it answers a clearly different question.',
    '- Every topic must name the subtopic it serves, exactly as written above. If it serves none of them, name a NEW subtopic and say which part of the core idea it serves. A new subtopic is not written until the editor approves it, so propose one only when it is genuinely worth widening the area for.',
  );

  return lines.join('\n');
}

/**
 * The same-area section map on its own, for the keyword stage: it plans the
 * article's sections, and a section it plans that is already written would
 * only be cut at the section gate.
 */
export function buildSectionMapBlock(themeId: number | null, excludeArticleId?: number): string {
  if (themeId === null) return '';
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT a.article_id, a.title, p.heading FROM coverage_articles a
       JOIN coverage_points p ON p.article_id = a.article_id
       WHERE a.theme_id = ? AND (? IS NULL OR a.article_id != ?) AND p.heading != ?
       ORDER BY a.article_id DESC, p.ordinal`,
    )
    .all(themeId, excludeArticleId ?? null, excludeArticleId ?? null, INTRODUCTION_HEADING) as {
    article_id: number;
    title: string;
    heading: string;
  }[];
  if (!rows.length) return '';

  const byArticle = new Map<number, { title: string; headings: string[] }>();
  for (const row of rows) {
    const entry = byArticle.get(row.article_id) ?? { title: row.title, headings: [] };
    if (entry.headings.length < MAX_HEADINGS_PER_ARTICLE) entry.headings.push(row.heading);
    byArticle.set(row.article_id, entry);
  }

  return [
    '=== SECTIONS ALREADY WRITTEN IN THIS AREA ===',
    ...[...byArticle.values()].map((a) => `- "${a.title}": ${a.headings.join(' | ')}`),
    'Do not plan a section whose job one of these already does. Where the reader needs that point, the article will link to it in a sentence. Cynth compares every planned section against what is written, and one that repeats an existing section is cut before drafting.',
    '',
  ].join('\n');
}
