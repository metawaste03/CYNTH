import type { DatabaseSync } from 'node:sqlite';

interface ColumnInfo {
  name: string;
}

/** Columns added to `authors` after it was first created in Milestone 2. */
const AUTHOR_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'short_biography', type: 'TEXT' },
  { name: 'tone', type: 'TEXT' },
  { name: 'target_audience', type: 'TEXT' },
  { name: 'writing_notes', type: 'TEXT' },
];

/** Columns added to `products` after it was first created in Milestone 2. */
const PRODUCT_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'short_description', type: 'TEXT' },
  { name: 'editorial_fit', type: 'TEXT' },
  { name: 'is_active', type: 'INTEGER NOT NULL DEFAULT 1' },
];

/** Columns added to `articles` after it was first created in Milestone 2, for the Content Brief workflow (Milestone 6). */
const ARTICLE_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'topic', type: 'TEXT' },
  { name: 'target_audience', type: 'TEXT' },
  { name: 'search_intent', type: 'TEXT' },
  { name: 'reader_pain_points', type: 'TEXT' },
  { name: 'questions_to_answer', type: 'TEXT' },
  { name: 'important_topics', type: 'TEXT' },
  { name: 'notes', type: 'TEXT' },
];

/** Columns added to `articles` for the generated draft (Milestone 9). `content` already existed and holds the generated body. */
const ARTICLE_GENERATION_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'generated_title', type: 'TEXT' },
  { name: 'generated_at', type: 'TEXT' },
  { name: 'generated_provider', type: 'TEXT' },
  { name: 'generated_model', type: 'TEXT' },
];

/**
 * Columns added to `generation_history`, which was created in Milestone 2 as
 * a placeholder (article_id/provider/action/payload) and first actually
 * written to in Milestone 9. Nothing secret is recorded — see schema.ts.
 */
const GENERATION_HISTORY_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'provider_type', type: 'TEXT' },
  { name: 'model', type: 'TEXT' },
  { name: 'status', type: 'TEXT' },
  { name: 'error_code', type: 'TEXT' },
  { name: 'error_message', type: 'TEXT' },
  { name: 'prompt_tokens', type: 'INTEGER' },
  { name: 'completion_tokens', type: 'INTEGER' },
  { name: 'total_tokens', type: 'INTEGER' },
  { name: 'duration_ms', type: 'INTEGER' },
];

function addMissingColumns(db: DatabaseSync, table: string, columns: { name: string; type: string }[]): void {
  const existingColumns = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[]).map((column) => column.name),
  );

  for (const column of columns) {
    if (!existingColumns.has(column.name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.type}`);
    }
  }
}

/**
 * Brings a database created under an earlier schema version up to date.
 * Checks `PRAGMA table_info` before altering, so this is idempotent and
 * safe to run on every startup — matching the pattern schema.ts already
 * uses for table creation.
 *
 * Deprecated-but-preserved columns (left in place, unused, rather than
 * dropped, so no existing data is ever destroyed):
 * - `authors.approved_writing_samples` (Milestone 2) — samples now live in
 *   `author_writing_samples` (Milestone 3).
 * - `products.image_path` and `products.status` (Milestone 2) — images now
 *   live in `product_images`, active/inactive now uses `is_active`
 *   (Milestone 4).
 */
export function runMigrations(db: DatabaseSync): void {
  addMissingColumns(db, 'authors', AUTHOR_COLUMNS_TO_ADD);
  addMissingColumns(db, 'products', PRODUCT_COLUMNS_TO_ADD);
  addMissingColumns(db, 'articles', ARTICLE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'articles', ARTICLE_GENERATION_COLUMNS_TO_ADD);
  addMissingColumns(db, 'generation_history', GENERATION_HISTORY_COLUMNS_TO_ADD);
}
