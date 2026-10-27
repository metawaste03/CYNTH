import { getDatabase } from '../../shared/database/index.js';
import type { ProductResearchRow } from '../../shared/database/types.js';
import type { ExtractedProduct } from './productExtract.js';

/**
 * Storage for what Cynth learned about a product, and how.
 *
 * Two things are kept apart on purpose:
 *
 *   - `product_research` is the provenance record. One row per pass, naming
 *     the retrieval it came from and whether a field was published by the
 *     page or written by a model. Rows accumulate; nothing is overwritten.
 *   - The research columns on `products` are the CURRENT answer, which is
 *     what generation reads. They are derived from the latest pass.
 *
 * Neither ever touches `products.affiliate_link`. That column holds the link
 * the user supplied, and no function in this file writes to it.
 */

export type ExtractionMethod = 'manual' | 'structured_metadata' | 'creators_api' | 'ai';

export interface ProductResearchDto {
  id: number;
  productId: number;
  retrievalId: number | null;
  sourceUrl: string | null;
  extractionMethod: ExtractionMethod;
  extractionModel: string | null;
  extracted: ExtractedProduct | null;
  useCase: string | null;
  problemSolved: string | null;
  bestFor: string | null;
  keyFeatures: string[];
  summary: string | null;
  notes: string | null;
  createdAt: string;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function map(row: ProductResearchRow): ProductResearchDto {
  return {
    id: row.id,
    productId: row.product_id,
    retrievalId: row.retrieval_id,
    sourceUrl: row.source_url,
    extractionMethod: row.extraction_method as ExtractionMethod,
    extractionModel: row.extraction_model,
    extracted: parseJson<ExtractedProduct | null>(row.extracted, null),
    useCase: row.use_case,
    problemSolved: row.problem_solved,
    bestFor: row.best_for,
    keyFeatures: parseJson<string[]>(row.key_features, []),
    summary: row.summary,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export interface RecordResearchInput {
  productId: number;
  retrievalId?: number | null;
  sourceUrl?: string | null;
  extractionMethod: ExtractionMethod;
  extractionModel?: string | null;
  extracted?: ExtractedProduct | null;
  useCase?: string | null;
  problemSolved?: string | null;
  bestFor?: string | null;
  keyFeatures?: string[];
  summary?: string | null;
  notes?: string | null;
}

export function recordResearch(input: RecordResearchInput): ProductResearchDto {
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO product_research (
         product_id, retrieval_id, source_url, extraction_method, extraction_model,
         extracted, use_case, problem_solved, best_for, key_features, summary, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.productId,
      input.retrievalId ?? null,
      input.sourceUrl ?? null,
      input.extractionMethod,
      input.extractionModel ?? null,
      input.extracted ? JSON.stringify(input.extracted) : null,
      input.useCase ?? null,
      input.problemSolved ?? null,
      input.bestFor ?? null,
      input.keyFeatures?.length ? JSON.stringify(input.keyFeatures) : null,
      input.summary ?? null,
      input.notes ?? null,
    );

  return getResearchById(Number(result.lastInsertRowid))!;
}

export function getResearchById(id: number): ProductResearchDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM product_research WHERE id = ?').get(id) as unknown as
    | ProductResearchRow
    | undefined;
  return row ? map(row) : null;
}

/** Every pass over one product, newest first. The audit trail. */
export function listResearchForProduct(productId: number): ProductResearchDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM product_research WHERE product_id = ? ORDER BY created_at DESC, id DESC')
    .all(productId) as unknown as ProductResearchRow[];
  return rows.map(map);
}

export function getLatestResearch(productId: number): ProductResearchDto | null {
  return listResearchForProduct(productId)[0] ?? null;
}

export type ResearchStatus = 'none' | 'retrieved' | 'researched' | 'failed';

export interface ProductResearchFieldsInput {
  sourceUrl?: string | null;
  vendor?: string | null;
  sourceImageUrl?: string | null;
  useCase?: string | null;
  problemSolved?: string | null;
  bestFor?: string | null;
  keyFeatures?: string[];
  researchStatus: ResearchStatus;
}

/**
 * Updates the current research answer on the product.
 *
 * Only the columns named here are touched. Title, brand, description,
 * editorial fit and above all `affiliate_link` are the user's, and a research
 * pass does not get to rewrite them — a separate, explicit call applies
 * extracted values to those fields, and only where the user left them empty.
 */
export function applyResearchFields(productId: number, input: ProductResearchFieldsInput): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE products SET
       source_url = COALESCE(?, source_url),
       vendor = COALESCE(?, vendor),
       source_image_url = COALESCE(?, source_image_url),
       use_case = COALESCE(?, use_case),
       problem_solved = COALESCE(?, problem_solved),
       best_for = COALESCE(?, best_for),
       key_features = COALESCE(?, key_features),
       research_status = ?,
       researched_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    input.sourceUrl ?? null,
    input.vendor ?? null,
    input.sourceImageUrl ?? null,
    input.useCase ?? null,
    input.problemSolved ?? null,
    input.bestFor ?? null,
    input.keyFeatures?.length ? JSON.stringify(input.keyFeatures) : null,
    input.researchStatus,
    productId,
  );
}

/**
 * Fills in descriptive fields the user left empty, and only those.
 *
 * A value the user typed always wins over a value a page published. This is
 * the only function that writes extracted data into the product's own
 * editorial fields, and it never overwrites.
 */
export function fillEmptyProductFields(
  productId: number,
  values: { title?: string | null; brand?: string | null; description?: string | null; category?: string | null },
): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE products SET
       title = CASE WHEN title IS NULL OR trim(title) = '' THEN COALESCE(?, title) ELSE title END,
       brand = CASE WHEN brand IS NULL OR trim(brand) = '' THEN COALESCE(?, brand) ELSE brand END,
       description = CASE WHEN description IS NULL OR trim(description) = '' THEN COALESCE(?, description) ELSE description END,
       category = CASE WHEN category IS NULL OR trim(category) = '' THEN COALESCE(?, category) ELSE category END,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(values.title ?? null, values.brand ?? null, values.description ?? null, values.category ?? null, productId);
}

export function setResearchStatus(productId: number, status: ResearchStatus): void {
  const db = getDatabase();
  db.prepare(`UPDATE products SET research_status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    status,
    productId,
  );
}
