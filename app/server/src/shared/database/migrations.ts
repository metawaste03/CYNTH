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


/**
 * Columns added to `articles` for the content architecture (Milestone 10).
 *
 * SQLite permits a REFERENCES clause on ADD COLUMN as long as the default is
 * NULL, so these are real foreign keys rather than loose integers. ON DELETE
 * SET NULL throughout: retiring a theme or topic must never delete published
 * work, and an article keeps its own provenance snapshot regardless.
 */
const ARTICLE_CONTENT_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'project_id', type: 'INTEGER REFERENCES projects(id) ON DELETE SET NULL' },
  { name: 'theme_id', type: 'INTEGER REFERENCES themes(id) ON DELETE SET NULL' },
  { name: 'topic_id', type: 'INTEGER REFERENCES topics(id) ON DELETE SET NULL' },
  /**
   * Resolved names captured at generation time, as JSON.
   *
   * The foreign keys above are the live relationship; this is the historical
   * one. Renaming an author or a theme afterwards must not silently rewrite
   * what an already-generated article says it came from.
   */
  { name: 'provenance_snapshot', type: 'TEXT' },
];


/**
 * Author persona columns (Milestone 11).
 *
 * The existing voice fields are reused rather than duplicated — Voice is
 * writing_style, Tone is tone, Audience is target_audience, Identity is
 * short_biography, and Writing guidance is writing_notes. Only the four
 * genuinely missing dimensions are added here.
 */
const AUTHOR_PERSONA_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'expertise', type: 'TEXT' },
  { name: 'perspective', type: 'TEXT' },
  { name: 'editorial_principles', type: 'TEXT' },
  { name: 'boundaries', type: 'TEXT' },
];

/** Editorial guidance on a topic (Milestone 11) — what the topic means and what an article about it should do. */
const TOPIC_GUIDANCE_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'scope', type: 'TEXT' },
  { name: 'key_areas', type: 'TEXT' },
  { name: 'considerations', type: 'TEXT' },
  { name: 'exclusions', type: 'TEXT' },
];


/**
 * Model pricing and capability metadata (Milestone 12).
 *
 * Populated by syncing a provider's model catalogue — never typed in by hand
 * and never guessed. Prices are stored per token exactly as the provider
 * publishes them; NULL means "not known", which the cost layer treats as
 * "cannot estimate" rather than "free".
 */
const AI_MODEL_PRICING_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'prompt_price', type: 'REAL' },
  { name: 'completion_price', type: 'REAL' },
  { name: 'context_length', type: 'INTEGER' },
  /** 1 = both prices are known AND both are zero. Derived at sync time, never assumed. */
  { name: 'is_free', type: 'INTEGER' },
  { name: 'pricing_synced_at', type: 'TEXT' },
];

/** Project-level editorial rules that apply to every article in the project (Milestone 12). User-supplied. */
const PROJECT_GUIDANCE_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'editorial_guidance', type: 'TEXT' },
];

/**
 * Model registry metadata (Milestone 13).
 *
 * Everything here is published by the provider's own catalogue and refreshed
 * by syncing it — none of it is typed in by hand, and none of it is inferred
 * from a model's name. `vendor` is the upstream house behind a model
 * (e.g. "anthropic") as distinct from the Cynth provider record used to reach
 * it (e.g. an OpenRouter account).
 */
const AI_MODEL_REGISTRY_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'vendor', type: 'TEXT' },
  /** A flat per-request charge. Non-zero means the model is not free, whatever its per-token prices say. */
  { name: 'request_price', type: 'REAL' },
  { name: 'catalog_status', type: 'TEXT' },
  /** Capability metadata as JSON. Opaque to Cynth — displayed, never interpreted. */
  { name: 'capabilities', type: 'TEXT' },
  /** Whether the provider's catalogue still listed this model at the last sync. */
  { name: 'in_catalog', type: 'INTEGER' },
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
  addMissingColumns(db, 'articles', ARTICLE_CONTENT_COLUMNS_TO_ADD);
  addMissingColumns(db, 'generation_history', GENERATION_HISTORY_COLUMNS_TO_ADD);
  addMissingColumns(db, 'authors', AUTHOR_PERSONA_COLUMNS_TO_ADD);
  addMissingColumns(db, 'topics', TOPIC_GUIDANCE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'ai_provider_models', AI_MODEL_PRICING_COLUMNS_TO_ADD);
  addMissingColumns(db, 'projects', PROJECT_GUIDANCE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'ai_provider_models', AI_MODEL_REGISTRY_COLUMNS_TO_ADD);
}
