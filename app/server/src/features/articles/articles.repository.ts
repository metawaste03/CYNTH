import { getDatabase } from '../../shared/database/index.js';
import type { ArticleRow, KeywordRow } from '../../shared/database/types.js';
import type { ArticleDraftInput } from './articles.validation.js';
import { UNTITLED_ARTICLE_LABEL, slugify } from './articles.constants.js';
import type { ArticleStatus } from './articles.constants.js';
import { listLinksForArticle } from '../cms/cmsLinks.repository.js';
import type { ArticleCmsLinkDto } from '../cms/cmsLinks.repository.js';

export interface ArticleKeywordsDto {
  primaryKeyword: string | null;
  secondaryKeywords: string | null;
}

/**
 * The AI-generated draft attached to an article (Milestone 9). `title` here
 * is the title the model wrote — it is stored separately from the article's
 * working title, which generation never overwrites.
 */
export interface GeneratedArticleDto {
  title: string | null;
  content: string;
  generatedAt: string;
  provider: string | null;
  model: string | null;
}

export interface ArticleDraftDto {
  id: number;
  title: string | null;
  /** Stable URL-safe handle derived from the title. Null while the article has no title at all. */
  slug: string | null;
  topic: string | null;
  articleTypeId: number | null;
  authorId: number | null;
  productId: number | null;
  projectId: number | null;
  themeId: number | null;
  topicId: number | null;
  targetAudience: string | null;
  searchIntent: string | null;
  readerPainPoints: string | null;
  questionsToAnswer: string | null;
  importantTopics: string | null;
  notes: string | null;
  status: string;
  /* --- The editorial pipeline (Milestone 20-22). Null until an article has been classified. --- */
  /** The classified type, and the template it was written to. Carried to WordPress so EFD can pick a layout. */
  articleTypeSlug: string | null;
  articleTypeOverride: boolean;
  templateId: string | null;
  templateVersion: number | null;
  /** The article as the template s sections, as JSON. What final validation checks. */
  structuredContent: string | null;
  excerpt: string | null;
  reviewScore: number | null;
  createdAt: string;
  updatedAt: string;
  keywords: ArticleKeywordsDto | null;
  /** Null until an AI generation has succeeded for this draft. */
  generated: GeneratedArticleDto | null;
  /** Resolved configuration names as they stood when this article was generated. Null before generation. */
  provenance: ArticleProvenance | null;
  /**
   * Where this article currently lives outside Cynth (Milestone 13).
   *
   * Empty until it has been pushed to a CMS. Its presence is what makes a
   * second push an update rather than a duplicate, so it belongs on the
   * Article itself rather than being looked up separately at the point of
   * clicking a button.
   */
  cmsLinks: ArticleCmsLinkDto[];
}

/**
 * What the article's configuration was called at the moment it was generated.
 *
 * The foreign keys are the live relationship; this is the historical one.
 * Renaming a thematic area or an author afterwards must not silently rewrite
 * the identity of work already produced under the old name.
 */
export interface ArticleProvenance {
  projectName: string | null;
  themeName: string | null;
  topicTitle: string | null;
  authorName: string | null;
  articleTypeName: string | null;
  /** Reproducibility: which provider, model and prompt structure produced this article. */
  providerName: string | null;
  modelName: string | null;
  promptVersion: string | null;
  generationMode: string | null;
  capturedAt: string;
}

/** Only present once generated_at is set, so a half-written row can never look like a generated article. */
function mapGenerated(row: ArticleRow): GeneratedArticleDto | null {
  if (!row.generated_at) return null;
  return {
    title: row.generated_title,
    content: row.content ?? '',
    generatedAt: row.generated_at,
    provider: row.generated_provider,
    model: row.generated_model,
  };
}

function mapArticle(row: ArticleRow, keywords: ArticleKeywordsDto | null): ArticleDraftDto {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    topic: row.topic,
    articleTypeId: row.article_type_id,
    authorId: row.author_id,
    productId: row.product_id,
    projectId: row.project_id,
    themeId: row.theme_id,
    topicId: row.topic_id,
    articleTypeSlug: (row as any).article_type_slug ?? null,
    articleTypeOverride: (row as any).article_type_override === 1,
    templateId: (row as any).template_id ?? null,
    templateVersion: (row as any).template_version ?? null,
    structuredContent: (row as any).structured_content ?? null,
    excerpt: (row as any).excerpt ?? null,
    reviewScore: (row as any).review_score ?? null,
    targetAudience: row.target_audience,
    searchIntent: row.search_intent,
    readerPainPoints: row.reader_pain_points,
    questionsToAnswer: row.questions_to_answer,
    importantTopics: row.important_topics,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    keywords,
    generated: mapGenerated(row),
    provenance: parseProvenance(row.provenance_snapshot),
    cmsLinks: listLinksForArticle(row.id),
  };
}

function parseProvenance(raw: string | null): ArticleProvenance | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ArticleProvenance;
  } catch {
    // A malformed snapshot must not break reading the article it belongs to.
    return null;
  }
}

/**
 * Resolves the article's configuration to plain names and freezes them.
 *
 * Called once, when a generation succeeds — that is the moment the article
 * acquires a history worth protecting.
 */
function captureProvenance(id: number, extra: ProvenanceExtras = {}): void {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT p.name AS project_name, th.name AS theme_name, tp.title AS topic_title,
             au.name AS author_name, at.name AS article_type_name
      FROM articles a
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN themes th ON th.id = a.theme_id
      LEFT JOIN topics tp ON tp.id = a.topic_id
      LEFT JOIN authors au ON au.id = a.author_id
      LEFT JOIN article_types at ON at.id = a.article_type_id
      WHERE a.id = ?
    `)
    .get(id) as unknown as Record<string, string | null> | undefined;
  if (!row) return;

  const snapshot: ArticleProvenance = {
    projectName: row.project_name ?? null,
    themeName: row.theme_name ?? null,
    topicTitle: row.topic_title ?? null,
    authorName: row.author_name ?? null,
    articleTypeName: row.article_type_name ?? null,
    providerName: extra.providerName ?? null,
    modelName: extra.modelName ?? null,
    promptVersion: extra.promptVersion ?? null,
    generationMode: extra.generationMode ?? null,
    capturedAt: new Date().toISOString(),
  };

  db.prepare('UPDATE articles SET provenance_snapshot = ? WHERE id = ?').run(JSON.stringify(snapshot), id);
}

function getKeywordsForArticle(articleId: number): ArticleKeywordsDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM keywords WHERE article_id = ?').get(articleId) as unknown as
    | KeywordRow
    | undefined;
  if (!row) return null;
  return { primaryKeyword: row.primary_keyword, secondaryKeywords: row.secondary_keywords };
}

/** Insert-or-update the single keywords row for this article (1:1). */
function upsertKeywords(articleId: number, input: ArticleDraftInput): void {
  const db = getDatabase();

  // Nothing to store and nothing to clear — skip entirely rather than
  // create an empty row.
  if (!input.primaryKeyword && !input.secondaryKeywords && !getKeywordsForArticle(articleId)) {
    return;
  }

  const existing = db.prepare('SELECT id FROM keywords WHERE article_id = ?').get(articleId);
  if (existing) {
    db.prepare('UPDATE keywords SET primary_keyword = ?, secondary_keywords = ? WHERE article_id = ?').run(
      input.primaryKeyword,
      input.secondaryKeywords,
      articleId,
    );
  } else {
    db.prepare('INSERT INTO keywords (article_id, primary_keyword, secondary_keywords) VALUES (?, ?, ?)').run(
      articleId,
      input.primaryKeyword,
      input.secondaryKeywords,
    );
  }
}

/* ---------------------------------------------------------------- slugs --- */

/**
 * The slug column has existed since Milestone 2 but nothing ever wrote to it.
 * An Article is a first-class record, so it carries a stable, URL-safe handle
 * derived from whatever title it has.
 *
 * Uniqueness is enforced here rather than by a UNIQUE constraint: the column
 * is nullable and already live in an existing database, so adding a
 * constraint would mean rebuilding the table for no functional gain.
 */
function ensureUniqueSlug(base: string, excludeId: number): string {
  const db = getDatabase();
  let candidate = base;
  let suffix = 2;

  while (
    db.prepare('SELECT id FROM articles WHERE slug = ? AND id != ?').get(candidate, excludeId) !== undefined
  ) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

/**
 * Recomputes an article's slug from its best available title. Called after
 * any write that can change a title, so the slug never drifts from the
 * article it identifies. An article with no title at all keeps a null slug —
 * inventing one would put a meaningless handle on a blank draft.
 */
function refreshSlug(id: number): void {
  const db = getDatabase();
  const row = db.prepare('SELECT title, generated_title FROM articles WHERE id = ?').get(id) as unknown as
    | { title: string | null; generated_title: string | null }
    | undefined;
  if (!row) return;

  const source = row.title?.trim() || row.generated_title?.trim() || '';
  const base = source ? slugify(source) : '';

  db.prepare('UPDATE articles SET slug = ? WHERE id = ?').run(base ? ensureUniqueSlug(base, id) : null, id);
}

export function articleTypeExists(articleTypeId: number): boolean {
  const db = getDatabase();
  return Boolean(db.prepare('SELECT id FROM article_types WHERE id = ?').get(articleTypeId));
}

export function authorExists(authorId: number): boolean {
  const db = getDatabase();
  return Boolean(db.prepare('SELECT id FROM authors WHERE id = ?').get(authorId));
}

export function productExists(productId: number): boolean {
  const db = getDatabase();
  return Boolean(db.prepare('SELECT id FROM products WHERE id = ?').get(productId));
}

export function getArticleById(id: number): ArticleDraftDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as unknown as ArticleRow | undefined;
  if (!row) return null;
  return mapArticle(row, getKeywordsForArticle(id));
}

/** Creates a draft with whatever fields the wizard has collected so far — only articleTypeId is mandatory. */
export function createArticleDraft(input: ArticleDraftInput): ArticleDraftDto {
  const db = getDatabase();
  const result = db
    .prepare(`
      INSERT INTO articles (
        article_type_id, author_id, product_id, project_id, theme_id, topic_id, title, topic,
        target_audience, search_intent, reader_pain_points, questions_to_answer, important_topics, notes,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `)
    .run(
      input.articleTypeId,
      input.authorId,
      input.productId,
      input.projectId,
      input.themeId,
      input.topicId,
      input.title,
      input.topic,
      input.targetAudience,
      input.searchIntent,
      input.readerPainPoints,
      input.questionsToAnswer,
      input.importantTopics,
      input.notes,
    );

  const articleId = Number(result.lastInsertRowid);
  upsertKeywords(articleId, input);
  refreshSlug(articleId);
  return getArticleById(articleId)!;
}

/** Full-replace update — the wizard always sends its complete current state. */
export function updateArticleDraft(id: number, input: ArticleDraftInput): ArticleDraftDto | null {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM articles WHERE id = ?').get(id);
  if (!existing) return null;

  db.prepare(`
    UPDATE articles SET
      article_type_id = ?, author_id = ?, product_id = ?,
      project_id = ?, theme_id = ?, topic_id = ?, title = ?, topic = ?,
      target_audience = ?, search_intent = ?, reader_pain_points = ?, questions_to_answer = ?,
      important_topics = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.articleTypeId,
    input.authorId,
    input.productId,
    input.projectId,
    input.themeId,
    input.topicId,
    input.title,
    input.topic,
    input.targetAudience,
    input.searchIntent,
    input.readerPainPoints,
    input.questionsToAnswer,
    input.importantTopics,
    input.notes,
    id,
  );

  upsertKeywords(id, input);
  refreshSlug(id);
  return getArticleById(id);
}

export interface SaveGeneratedArticleInput {
  title: string | null;
  content: string;
  provider: string | null;
  model: string | null;
  /** Recorded in the provenance snapshot so a draft can say exactly how it was produced. */
  promptVersion?: string | null;
  generationMode?: string | null;
}

interface ProvenanceExtras {
  providerName?: string | null;
  modelName?: string | null;
  promptVersion?: string | null;
  generationMode?: string | null;
}

/**
 * Stores a successful generation against an existing draft (Milestone 9).
 *
 * Three things this deliberately does not do: it does not touch `title`
 * (the editor's working title survives generation), it does not touch any
 * Content Brief field, and it does not change `status` — the article stays a
 * draft until a human approves it (docs/00_PROJECT_VISION.md).
 */
export function saveGeneratedArticle(id: number, input: SaveGeneratedArticleInput): GeneratedArticleDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`
      UPDATE articles SET
        content = ?, generated_title = ?, generated_provider = ?, generated_model = ?,
        generated_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `)
    .run(input.content, input.title, input.provider, input.model, id);

  if (result.changes === 0) return null;
  refreshSlug(id);
  captureProvenance(id, {
    providerName: input.provider,
    modelName: input.model,
    promptVersion: input.promptVersion ?? null,
    generationMode: input.generationMode ?? null,
  });
  return getArticleById(id)?.generated ?? null;
}

/* ------------------------------------------------- Article listing (M9.1) --- */

/**
 * What the Dashboard and the Drafts list need to render one row.
 *
 * This reads the `articles` table — the Article entity — and never
 * `generation_history`. History records generation *attempts*; it is an audit
 * trail, not a content store, and an article with three failed attempts and
 * one success is still exactly one Article.
 */
export interface ArticleSummaryDto {
  id: number;
  /** Never null, so a list row always has something to show. A display fallback — not stored. */
  displayTitle: string;
  /** The editor's working title, exactly as stored. */
  workingTitle: string | null;
  /** The title the model wrote, if it wrote one. */
  generatedTitle: string | null;
  slug: string | null;
  status: string;
  topic: string | null;
  /** The article type's name — the closest thing Cynth has to a category. */
  articleTypeName: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  /** True once a generation has succeeded against this article. */
  isGenerated: boolean;
  generatedAt: string | null;
  generatedModel: string | null;
  generatedProvider: string | null;
  /** First line or so of the stored content, for a list preview. Null when nothing is stored. */
  excerpt: string | null;
  wordCount: number | null;
  /** True once this article has been pushed to at least one CMS (Milestone 13). */
  isPushedToCms: boolean;
  /** The remote status of the most recently pushed copy, as the CMS last reported it. */
  cmsStatus: string | null;
  cmsSiteUrl: string | null;
}

interface ArticleSummaryRow extends ArticleRow {
  article_type_name: string | null;
  author_name: string | null;
  /** Joined from article_cms_links — null when the article has never been pushed anywhere. */
  cms_status: string | null;
  cms_site_url: string | null;
}

/** A short, single-line preview of the stored body. Markdown markers are stripped so a list row doesn't open with "#" or "*". */
function buildExcerpt(content: string | null): string | null {
  if (!content) return null;

  const flattened = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    // Strip Markdown markers from both ends — a leading "#" or "*" is noise in
    // a list row, and stripping only the opening one leaves a dangling "*".
    .map((line) => line.replace(/^\s*[#>*_\-\s]+/, '').replace(/[*_\s]+$/, '').trim())
    .find((line) => line.length > 0);

  if (!flattened) return null;
  return flattened.length > 180 ? `${flattened.slice(0, 180)}…` : flattened;
}

function countWords(content: string | null): number | null {
  if (!content) return null;
  const words = content.trim().split(/\s+/).filter(Boolean);
  return words.length || null;
}

function mapSummary(row: ArticleSummaryRow): ArticleSummaryDto {
  return {
    id: row.id,
    displayTitle: row.title?.trim() || row.generated_title?.trim() || UNTITLED_ARTICLE_LABEL,
    workingTitle: row.title,
    generatedTitle: row.generated_title,
    slug: row.slug,
    status: row.status,
    topic: row.topic,
    articleTypeName: row.article_type_name,
    authorName: row.author_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isGenerated: Boolean(row.generated_at),
    generatedAt: row.generated_at,
    generatedModel: row.generated_model,
    generatedProvider: row.generated_provider,
    excerpt: buildExcerpt(row.content),
    wordCount: countWords(row.content),
    isPushedToCms: row.cms_status !== null,
    cmsStatus: row.cms_status,
    cmsSiteUrl: row.cms_site_url,
  };
}

export interface ListArticlesOptions {
  /** Filter to one lifecycle state. Omit for every article. */
  status?: string;
  /** Only articles that have actually been generated. Used by nothing yet; the Drafts list deliberately shows ungenerated drafts too. */
  generatedOnly?: boolean;
  limit?: number;
}

/**
 * Real article records, most recently touched first. No counts, no
 * placeholders, no fabricated rows — if the table holds one article this
 * returns one article.
 */
export function listArticles(options: ListArticlesOptions = {}): ArticleSummaryDto[] {
  const db = getDatabase();

  const where: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    where.push('a.status = ?');
    params.push(options.status);
  }
  if (options.generatedOnly) {
    where.push('a.generated_at IS NOT NULL');
  }

  const limit = Number.isInteger(options.limit) && options.limit! > 0 ? options.limit! : 200;
  params.push(limit);

  // The CMS link is joined rather than fetched per row: a list of 200 drafts
  // must not become 200 extra queries.
  const rows = db
    .prepare(`
      SELECT a.*, t.name AS article_type_name, au.name AS author_name,
             l.external_status AS cms_status, l.site_url AS cms_site_url
      FROM articles a
      LEFT JOIN article_types t ON t.id = a.article_type_id
      LEFT JOIN authors au ON au.id = a.author_id
      LEFT JOIN article_cms_links l
        ON l.id = (SELECT id FROM article_cms_links WHERE article_id = a.id ORDER BY last_pushed_at DESC, id DESC LIMIT 1)
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY datetime(a.updated_at) DESC, a.id DESC
      LIMIT ?
    `)
    .all(...(params as never[])) as unknown as ArticleSummaryRow[];

  return rows.map(mapSummary);
}

/** Counts per lifecycle state, for the Dashboard. Derived from the Article table, never hardcoded. */
export function countArticlesByStatus(): Record<string, number> {
  const db = getDatabase();
  const rows = db.prepare('SELECT status, COUNT(*) AS count FROM articles GROUP BY status').all() as unknown as {
    status: string;
    count: number;
  }[];

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/**
 * Moves an article along its lifecycle. Publication is a deliberate human
 * act — nothing in the generation path may call this (docs/00_PROJECT_VISION.md).
 */
export function setArticleStatus(id: number, status: ArticleStatus): ArticleDraftDto | null {
  const db = getDatabase();
  const result = db
    .prepare("UPDATE articles SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);

  if (result.changes === 0) return null;
  return getArticleById(id);
}

/**
 * Gives a slug to any article that predates slug support. Idempotent — it
 * only touches rows whose slug is still NULL, so it is safe to run on every
 * startup alongside the schema migrations. Articles with no title at all are
 * left alone.
 */
/* ------------------------------------------------------------ deletion --- */

export interface DeletionPreflight {
  articleId: number;
  title: string | null;
  status: string;
  /** Reasons deletion is refused without an explicit override. */
  blockers: string[];
  /** Things the user should know but which do not refuse. */
  warnings: string[];
  /** What deleting actually removes, so nothing is a surprise. */
  removes: string[];
  /** What survives, for the same reason. */
  keeps: string[];
  canDelete: boolean;
}

/**
 * What deleting this article would do, answered before anything is destroyed.
 *
 * The one real blocker is a CMS link. Cynth's connector has no ability to
 * delete a remote post — by design, since Milestone 13 — so deleting an
 * article that lives on WordPress does NOT remove the post. It only removes
 * Cynth's record that the post exists, and the next push of anything similar
 * would create a duplicate rather than updating it. That is worth refusing
 * over, and worth explaining rather than silently allowing.
 */
export function getDeletionPreflight(id: number): DeletionPreflight | null {
  const db = getDatabase();
  const article = getArticleById(id);
  if (!article) return null;

  const blockers: string[] = [];
  const warnings: string[] = [];

  const links = db
    .prepare('SELECT external_id, external_status FROM article_cms_links WHERE article_id = ?')
    .all(id) as { external_id: string | null; external_status: string | null }[];

  if (links.length) {
    const described = links
      .map((link) => `post ${link.external_id ?? 'unknown'}${link.external_status ? ` (${link.external_status})` : ''}`)
      .join(', ');
    blockers.push(
      `This article has been pushed to a CMS as ${described}. Cynth cannot delete a remote post, so deleting here removes only the link — the post stays published and a later push would create a duplicate. Delete the post in WordPress first, or confirm you want to break the link.`,
    );
  }

  if (article.status === 'published') {
    warnings.push('This article is marked as published in Cynth.');
  }

  const count = (sql: string): number =>
    (db.prepare(sql).get(id) as { count: number }).count;

  const removes: string[] = ['The article and its generated content'];
  const keywords = count('SELECT COUNT(*) AS count FROM keywords WHERE article_id = ?');
  if (keywords) removes.push('Its keyword record');

  const products = count('SELECT COUNT(*) AS count FROM article_products WHERE article_id = ?');
  if (products) removes.push(`Its ${products} product attachment(s) — the products themselves are kept`);

  const media = count('SELECT COUNT(*) AS count FROM article_media WHERE article_id = ?');
  if (media) removes.push(`Its ${media} image attachment(s) — the images themselves are kept`);

  const seo = count('SELECT COUNT(*) AS count FROM article_seo WHERE article_id = ?');
  if (seo) removes.push('Its SEO configuration and analysis');

  const pipelines = count('SELECT COUNT(*) AS count FROM article_pipelines WHERE article_id = ?');
  if (pipelines) removes.push(`Its ${pipelines} pipeline run(s), including every stage result`);

  const keeps = [
    'The generation history, including what each attempt cost — it is detached, not deleted',
    'Any products, images and authors it referenced',
  ];
  if (links.length) keeps.push('The remote CMS post, which Cynth cannot delete');

  return {
    articleId: id,
    title: article.title ?? article.generated?.title ?? null,
    status: article.status,
    blockers,
    warnings,
    removes,
    keeps,
    canDelete: blockers.length === 0,
  };
}

/**
 * Deletes an article.
 *
 * Refuses when the preflight found a blocker, unless the caller explicitly
 * overrides — the override exists because "I already deleted the WordPress
 * post" is a real situation Cynth cannot verify, and the user is the one who
 * knows. It is never the default.
 *
 * The cascades are declared in the schema: everything belonging to the article
 * goes with it, while generation_history and cms_push_history keep their rows
 * with a null article_id, so the record of what was spent survives the thing
 * it was spent on.
 */
export function deleteArticle(id: number, options: { force?: boolean } = {}): { deleted: true } | { error: string } {
  const preflight = getDeletionPreflight(id);
  if (!preflight) return { error: 'Draft not found.' };

  if (!preflight.canDelete && !options.force) {
    return { error: preflight.blockers.join(' ') };
  }

  const db = getDatabase();
  // Foreign keys are ON for the connection (see shared/database/index.ts), so
  // the declared cascades do the work rather than a hand-written sequence of
  // deletes that could drift from the schema.
  db.prepare('DELETE FROM articles WHERE id = ?').run(id);
  return { deleted: true };
}

export function backfillMissingSlugs(): number {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT id FROM articles WHERE slug IS NULL AND (COALESCE(TRIM(title), '') != '' OR COALESCE(TRIM(generated_title), '') != '')")
    .all() as unknown as { id: number }[];

  for (const row of rows) refreshSlug(row.id);
  return rows.length;
}
