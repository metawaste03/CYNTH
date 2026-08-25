import { getDatabase } from '../../shared/database/index.js';
import type { ArticleRow, KeywordRow } from '../../shared/database/types.js';
import type { ArticleDraftInput } from './articles.validation.js';

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
  topic: string | null;
  articleTypeId: number | null;
  authorId: number | null;
  productId: number | null;
  targetAudience: string | null;
  searchIntent: string | null;
  readerPainPoints: string | null;
  questionsToAnswer: string | null;
  importantTopics: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  keywords: ArticleKeywordsDto | null;
  /** Null until an AI generation has succeeded for this draft. */
  generated: GeneratedArticleDto | null;
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
    topic: row.topic,
    articleTypeId: row.article_type_id,
    authorId: row.author_id,
    productId: row.product_id,
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
  };
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
        article_type_id, author_id, product_id, title, topic,
        target_audience, search_intent, reader_pain_points, questions_to_answer, important_topics, notes,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `)
    .run(
      input.articleTypeId,
      input.authorId,
      input.productId,
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
  return getArticleById(articleId)!;
}

/** Full-replace update — the wizard always sends its complete current state. */
export function updateArticleDraft(id: number, input: ArticleDraftInput): ArticleDraftDto | null {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM articles WHERE id = ?').get(id);
  if (!existing) return null;

  db.prepare(`
    UPDATE articles SET
      article_type_id = ?, author_id = ?, product_id = ?, title = ?, topic = ?,
      target_audience = ?, search_intent = ?, reader_pain_points = ?, questions_to_answer = ?,
      important_topics = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.articleTypeId,
    input.authorId,
    input.productId,
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
  return getArticleById(id);
}

export interface SaveGeneratedArticleInput {
  title: string | null;
  content: string;
  provider: string | null;
  model: string | null;
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
  return getArticleById(id)?.generated ?? null;
}
