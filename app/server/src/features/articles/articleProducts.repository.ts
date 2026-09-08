import { getDatabase } from '../../shared/database/index.js';
import type { ArticleProductRow } from '../../shared/database/types.js';

/**
 * The products attached to one article, and where each one ended up.
 *
 * Milestone 2 gave an article a single `product_id`. Milestone 17 needs
 * several — the use case is three products across one workspace-setup
 * article — so the relationship moved here. The old column is still READ, so
 * a draft created before this table existed keeps its product; nothing writes
 * to it any more.
 *
 * `status` records an outcome the model is explicitly allowed to reach:
 * 'omitted' means the product was offered and the author judged it did not
 * belong. That is a success, not a failure, and it is stored as one.
 */

export type ArticleProductStatus = 'provided' | 'placed' | 'omitted';

/**
 * What the review concluded about a placement (Milestone 18).
 *
 * 'good' is a first-class outcome, not the absence of a problem: the review
 * is asked to say when a placement works, and that answer is stored.
 */
export type PlacementVerdict = 'good' | 'acceptable' | 'weak' | 'misplaced';

export const PLACEMENT_VERDICTS: PlacementVerdict[] = ['good', 'acceptable', 'weak', 'misplaced'];

export interface ArticleProductDto {
  id: number;
  articleId: number;
  productId: number;
  position: number;
  editorialNote: string | null;
  status: ArticleProductStatus;
  placementSection: string | null;
  placementRationale: string | null;
  placedAt: string | null;
  /* --- The review. An opinion about the placement above, never a change to it. --- */
  reviewVerdict: PlacementVerdict | null;
  reviewAssessment: string | null;
  /** Where the reviewer would have put it instead. Advice; nothing acts on it. */
  reviewSuggestedSection: string | null;
  reviewConfidence: number | null;
  reviewModel: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

function readStatus(raw: string): ArticleProductStatus {
  return raw === 'placed' || raw === 'omitted' ? raw : 'provided';
}

function readVerdict(raw: string | null): PlacementVerdict | null {
  return raw && (PLACEMENT_VERDICTS as string[]).includes(raw) ? (raw as PlacementVerdict) : null;
}

function map(row: ArticleProductRow): ArticleProductDto {
  return {
    id: row.id,
    articleId: row.article_id,
    productId: row.product_id,
    position: row.position,
    editorialNote: row.editorial_note,
    status: readStatus(row.status),
    placementSection: row.placement_section,
    placementRationale: row.placement_rationale,
    placedAt: row.placed_at,
    reviewVerdict: readVerdict(row.review_verdict ?? null),
    reviewAssessment: row.review_assessment ?? null,
    reviewSuggestedSection: row.review_suggested_section ?? null,
    reviewConfidence: row.review_confidence ?? null,
    reviewModel: row.review_model ?? null,
    reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at,
  };
}

export function listArticleProducts(articleId: number): ArticleProductDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM article_products WHERE article_id = ? ORDER BY position, id')
    .all(articleId) as unknown as ArticleProductRow[];
  return rows.map(map);
}

/**
 * The product ids for an article, including the legacy single `product_id`.
 *
 * The one place that reconciles the old shape with the new. A draft that
 * predates `article_products` still has its product carried into generation,
 * and a product recorded both ways appears once.
 */
export function resolveProductIdsForArticle(articleId: number): number[] {
  const db = getDatabase();
  const attached = listArticleProducts(articleId).map((row) => row.productId);

  const legacy = db.prepare('SELECT product_id FROM articles WHERE id = ?').get(articleId) as
    | { product_id: number | null }
    | undefined;

  if (legacy?.product_id && !attached.includes(legacy.product_id)) {
    return [...attached, legacy.product_id];
  }
  return attached;
}

export interface AttachProductInput {
  productId: number;
  editorialNote?: string | null;
  position?: number;
}

/** Attaches a product to an article. Re-attaching one already there updates its note rather than failing. */
export function attachProduct(articleId: number, input: AttachProductInput): ArticleProductDto | { error: string } {
  const db = getDatabase();

  if (!db.prepare('SELECT id FROM articles WHERE id = ?').get(articleId)) {
    return { error: 'Draft not found.' };
  }
  if (!db.prepare('SELECT id FROM products WHERE id = ?').get(input.productId)) {
    return { error: 'Product not found.' };
  }

  const existing = db
    .prepare('SELECT * FROM article_products WHERE article_id = ? AND product_id = ?')
    .get(articleId, input.productId) as unknown as ArticleProductRow | undefined;

  if (existing) {
    db.prepare('UPDATE article_products SET editorial_note = ?, position = ? WHERE id = ?').run(
      input.editorialNote ?? existing.editorial_note,
      input.position ?? existing.position,
      existing.id,
    );
    return map(
      db.prepare('SELECT * FROM article_products WHERE id = ?').get(existing.id) as unknown as ArticleProductRow,
    );
  }

  const nextPosition =
    input.position ??
    ((db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM article_products WHERE article_id = ?').get(
      articleId,
    ) as { max: number }).max +
      1);

  const result = db
    .prepare(
      'INSERT INTO article_products (article_id, product_id, position, editorial_note) VALUES (?, ?, ?, ?)',
    )
    .run(articleId, input.productId, nextPosition, input.editorialNote ?? null);

  return map(
    db.prepare('SELECT * FROM article_products WHERE id = ?').get(Number(result.lastInsertRowid)) as unknown as ArticleProductRow,
  );
}

export function detachProduct(articleId: number, productId: number): boolean {
  const db = getDatabase();
  return (
    db.prepare('DELETE FROM article_products WHERE article_id = ? AND product_id = ?').run(articleId, productId)
      .changes > 0
  );
}

export interface PlacementResult {
  productId: number;
  section: string | null;
  rationale?: string | null;
}

/**
 * Records where each product actually ended up after a generation.
 *
 * Called with what the generated draft contains, so it describes the article
 * rather than instructing it. Every attached product is written: the ones the
 * author placed become 'placed', and the ones they did not become 'omitted' —
 * an outcome the prompt explicitly permits, recorded rather than hidden.
 */
export function recordPlacements(articleId: number, placements: PlacementResult[]): void {
  const db = getDatabase();
  const placedByProductId = new Map(placements.map((placement) => [placement.productId, placement]));

  const placed = db.prepare(
    `UPDATE article_products SET status = 'placed', placement_section = ?, placement_rationale = ?,
     placed_at = datetime('now') WHERE article_id = ? AND product_id = ?`,
  );
  const omitted = db.prepare(
    `UPDATE article_products SET status = 'omitted', placement_section = NULL, placement_rationale = NULL,
     placed_at = NULL WHERE article_id = ? AND product_id = ?`,
  );

  for (const row of listArticleProducts(articleId)) {
    const placement = placedByProductId.get(row.productId);
    if (placement) placed.run(placement.section, placement.rationale ?? null, articleId, row.productId);
    else omitted.run(articleId, row.productId);
  }

  // A new generation invalidates every review: they described where products
  // used to be. Clearing them is more honest than showing a verdict about a
  // placement that no longer exists.
  db.prepare(
    `UPDATE article_products SET review_verdict = NULL, review_assessment = NULL,
     review_suggested_section = NULL, review_confidence = NULL, review_model = NULL, reviewed_at = NULL
     WHERE article_id = ?`,
  ).run(articleId);
}

export interface PlacementReviewInput {
  productId: number;
  verdict: PlacementVerdict;
  assessment: string;
  suggestedSection?: string | null;
  confidence?: number | null;
  model?: string | null;
}

/**
 * Records what the review concluded about each placement.
 *
 * Writes only the review columns. `status`, `placement_section` and
 * `placement_rationale` — the author's decisions — are untouched, which is
 * what makes this a review rather than an edit.
 */
export function recordPlacementReviews(articleId: number, reviews: PlacementReviewInput[]): void {
  const db = getDatabase();
  const update = db.prepare(
    `UPDATE article_products SET review_verdict = ?, review_assessment = ?, review_suggested_section = ?,
     review_confidence = ?, review_model = ?, reviewed_at = datetime('now')
     WHERE article_id = ? AND product_id = ?`,
  );

  for (const review of reviews) {
    update.run(
      review.verdict,
      review.assessment,
      review.suggestedSection ?? null,
      review.confidence ?? null,
      review.model ?? null,
      articleId,
      review.productId,
    );
  }
}

/** Every article that currently has products attached — used to offer the review only where it applies. */
export function articleHasProducts(articleId: number): boolean {
  return resolveProductIdsForArticle(articleId).length > 0;
}
