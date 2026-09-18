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

/**
 * Columns added to `products` for product research (Milestone 17).
 *
 * `affiliate_link` is deliberately NOT among them: it already exists, it
 * already holds the link the user supplied, and this milestone's whole point
 * is that nothing rewrites it. `source_url` is a separate column so that the
 * page Cynth read and the link Cynth publishes can never be confused for one
 * another.
 */
const PRODUCT_RESEARCH_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'source_url', type: 'TEXT' },
  // Derived from the source URL's host, never hardcoded. 'amazon' is data.
  { name: 'vendor', type: 'TEXT' },
  // The image the source page published about itself. A candidate for the
  // product card; an uploaded image always wins over it.
  { name: 'source_image_url', type: 'TEXT' },
  // What the product is for, and who it suits. Written by research.
  { name: 'use_case', type: 'TEXT' },
  { name: 'problem_solved', type: 'TEXT' },
  { name: 'best_for', type: 'TEXT' },
  // JSON array of short feature strings.
  { name: 'key_features', type: 'TEXT' },
  // 'none' | 'retrieved' | 'researched' | 'failed'
  { name: 'research_status', type: "TEXT NOT NULL DEFAULT 'none'" },
  { name: 'researched_at', type: 'TEXT' },
];

/**
 * Columns added for product improvements (Milestone 18).
 *
 * `theme_id` is a single nullable reference rather than a join table: a
 * product belongs to one content area or to none, which is what was asked
 * for. ON DELETE SET NULL, because retiring a thematic area must never delete
 * a product — the association goes, the product stays.
 */
const PRODUCT_THEME_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'theme_id', type: 'INTEGER REFERENCES themes(id) ON DELETE SET NULL' },
];

/**
 * The product-placement review (Milestone 18), stored beside the placement it
 * describes.
 *
 * A review is an OPINION about a decision the author already made. It never
 * moves a product: `placement_section` above stays whatever the author chose,
 * and `suggested_section` records what the reviewer would have done instead.
 * The two are separate columns so a suggestion can never be mistaken for a
 * change that happened.
 */
const ARTICLE_PRODUCT_REVIEW_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  // 'good' | 'acceptable' | 'weak' | 'misplaced'
  { name: 'review_verdict', type: 'TEXT' },
  { name: 'review_assessment', type: 'TEXT' },
  { name: 'review_suggested_section', type: 'TEXT' },
  // 0..1, the reviewer's own stated confidence.
  { name: 'review_confidence', type: 'REAL' },
  { name: 'review_model', type: 'TEXT' },
  { name: 'reviewed_at', type: 'TEXT' },
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

/**
 * Which CMS user an author's articles are attributed to.
 *
 * Lives on the author rather than on the connection because the relationship
 * is one persona to one CMS account: five authors write for EveryFiveDays and
 * each has their own WordPress user. `cms_connections.default_remote_author_id`
 * remains the fallback for an author with no mapping of their own, and for
 * every article whose author is not set.
 *
 * Text, not an integer, for the same reason `CmsRemotePost.id` is text —
 * nothing here may assume a CMS numbers its users.
 */
const AUTHOR_CMS_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'remote_author_id', type: 'TEXT' },
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
  /**
   * Image output pricing (Milestone 25.1). NULL on every row synced before
   * this column existed, which reads as unknown — and unknown is treated as
   * paid, so an un-resynced image model is gated rather than assumed free.
   */
  { name: 'image_output_price', type: 'REAL' },
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

/**
 * Model validation state (Milestone 15).
 *
 * Two different questions, kept in two different sets of columns because they
 * have two different answers:
 *
 *   validation_*  Did the configuration check out when this model was saved?
 *                 Written by the save path. A model is only stored as `valid`
 *                 after the provider itself confirmed the model exists.
 *   last_test_*   What happened the last time a human pressed Test Model?
 *                 Written only by the test path, so an old passing test is
 *                 never mistaken for a fresh one, and a failed test never
 *                 silently rewrites the record's saved validation state.
 *
 * No column here ever holds a credential: `validation_message` and
 * `last_test_message` are the redacted, truncated messages the error layer
 * already produces for display.
 */
/**
 * Registry metadata the multi-model pipeline needs (Milestone 20).
 *
 * `cost_tier` is stored rather than derived: prices can be unknown, and role
 * assignment still needs a stable answer to "is this the cheap one". The three
 * capability flags are what a provider catalogue reports — NULL means "not
 * reported", never "no".
 */
const AI_MODEL_PIPELINE_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'description', type: 'TEXT' },
  // 'free' | 'low' | 'standard' | 'premium' | 'unknown'
  { name: 'cost_tier', type: "TEXT NOT NULL DEFAULT 'unknown'" },
  { name: 'priority', type: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'fallback_eligible', type: 'INTEGER NOT NULL DEFAULT 1' },
  { name: 'supports_structured_output', type: 'INTEGER' },
  { name: 'supports_tools', type: 'INTEGER' },
  { name: 'supports_web_search', type: 'INTEGER' },
];

/**
 * Cost and provenance on generation_history (Milestone 20).
 *
 * The table recorded tokens but not money, and knew nothing about pipelines.
 * A per-article cost breakdown needs both, and `was_fallback` puts a technical
 * substitution in the same record as the spend it caused.
 */
const GENERATION_HISTORY_PIPELINE_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'pipeline_id', type: 'INTEGER' },
  { name: 'stage', type: 'TEXT' },
  { name: 'requested_model', type: 'TEXT' },
  { name: 'estimated_cost', type: 'REAL' },
  { name: 'cached_tokens', type: 'INTEGER' },
  { name: 'was_fallback', type: 'INTEGER NOT NULL DEFAULT 0' },
];

/**
 * The structured article (Milestone 20).
 *
 * `content` stays exactly as it is — the rendered markdown body that the CMS
 * push and the SEO engine already read. `structured_content` holds the same
 * article as the template's sections, which is what final validation checks
 * and what carries to WordPress. The template id and version travel with the
 * article so EFD can choose a presentation template without re-deriving it.
 */
const ARTICLE_PIPELINE_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'article_type_slug', type: 'TEXT' },
  // Set when a human overrode the classifier, so the override is recorded
  // rather than silently indistinguishable from the model's own answer.
  { name: 'article_type_override', type: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'template_id', type: 'TEXT' },
  { name: 'template_version', type: 'INTEGER' },
  { name: 'structured_content', type: 'TEXT' },
  { name: 'excerpt', type: 'TEXT' },
  { name: 'review_score', type: 'REAL' },
];

/**
 * GUIDED RUNS (Milestone 24).
 *
 * Existing pipelines predate the idea of being driven step by step, so they
 * default to 'automatic' — which is exactly how they already behaved. No run
 * changes character because the column arrived.
 */
const PIPELINE_RUN_MODE_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'run_mode', type: "TEXT NOT NULL DEFAULT 'automatic'" },
];

/**
 * How faithfully topic research treats the editor's idea.
 *
 * 'explore' is what every run did before this column existed: a steer is a
 * direction, and research proposes alternatives within it. 'exact' means the
 * editor has already decided the subject and wants it researched, not
 * reinterpreted.
 *
 * Existing rows default to 'explore', which is exactly how they already
 * behaved, so no run changes character because the column arrived.
 */
const PIPELINE_TOPIC_MODE_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  { name: 'topic_mode', type: "TEXT NOT NULL DEFAULT 'explore'" },
];

const AI_MODEL_VALIDATION_COLUMNS_TO_ADD: { name: string; type: string }[] = [
  /** 'unvalidated' | 'valid' | 'invalid'. NULL on rows saved before this milestone. */
  { name: 'validation_status', type: 'TEXT' },
  /** The machine-readable reason, e.g. 'model_not_found'. NULL when valid. */
  { name: 'validation_code', type: 'TEXT' },
  { name: 'validation_message', type: 'TEXT' },
  { name: 'validated_at', type: 'TEXT' },
  /** 'passed' | 'failed' — the outcome of the last explicit Test Model run. */
  { name: 'last_test_status', type: 'TEXT' },
  { name: 'last_test_message', type: 'TEXT' },
  /** 'catalog' (metadata only, free) or 'live' (a real minimal request was sent). */
  { name: 'last_test_mode', type: 'TEXT' },
  { name: 'last_tested_at', type: 'TEXT' },
];

/**
 * MODEL CAPABILITY BACKFILL AND CONSOLIDATION (Milestone 15).
 *
 * Before this milestone a model row carried exactly one `purpose`, so
 * registering one model for two jobs meant registering it twice. Both halves
 * of that are undone here, additively:
 *
 *   1. Every existing row's `purpose` becomes a row in ai_model_capabilities,
 *      carrying its is_default_for_purpose flag with it. No capability is
 *      lost, and a row with no purpose simply contributes none.
 *
 *   2. Rows that were only ever duplicates of each other — same provider,
 *      same model id, different purpose — are merged into the lowest-numbered
 *      row, which inherits the union of their capabilities. The surplus rows
 *      are then removed, because they no longer represent anything: their
 *      capability now lives on the surviving row, and their provider metadata
 *      was a copy of it.
 *
 * Both steps are idempotent: step 1 skips a (model, purpose) already present,
 * and step 2 finds nothing to merge once it has run.
 *
 * The `purpose` column itself is left in place and untouched — deprecated but
 * preserved, per the same policy as authors.approved_writing_samples.
 */
function backfillModelCapabilities(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT id, provider_id, model_name, purpose, is_default_for_purpose
       FROM ai_provider_models
       ORDER BY id ASC`,
    )
    .all() as unknown as {
    id: number;
    provider_id: number;
    model_name: string;
    purpose: string | null;
    is_default_for_purpose: number;
  }[];

  if (rows.length === 0) return;

  const insertCapability = db.prepare(
    `INSERT OR IGNORE INTO ai_model_capabilities (model_id, purpose, is_default_for_purpose)
     VALUES (?, ?, ?)`,
  );

  // Step 1 — every stored purpose becomes a capability.
  for (const row of rows) {
    const purpose = row.purpose?.trim();
    if (!purpose) continue;
    insertCapability.run(row.id, purpose, row.is_default_for_purpose === 1 ? 1 : 0);
  }

  // Step 2 — merge rows that differ only by the purpose they were created for.
  const survivorByModel = new Map<string, number>();
  const moveCapability = db.prepare(
    `UPDATE OR IGNORE ai_model_capabilities SET model_id = ? WHERE model_id = ?`,
  );
  const dropModel = db.prepare('DELETE FROM ai_provider_models WHERE id = ?');

  for (const row of rows) {
    const key = `${row.provider_id}\u0000${row.model_name}`;
    const survivor = survivorByModel.get(key);

    if (survivor === undefined) {
      survivorByModel.set(key, row.id);
      continue;
    }

    // A UNIQUE(model_id, purpose) clash means the survivor already holds this
    // capability, so the duplicate's row is redundant either way; UPDATE OR
    // IGNORE moves what is new and leaves what is not, and the DELETE below
    // cascades away anything that could not move.
    moveCapability.run(survivor, row.id);
    dropModel.run(row.id);
  }
}

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
 * - `articles.product_id` (Milestone 2) — an article's products now live in
 *   `article_products`, which allows several (Milestone 17). The column is
 *   still read, so drafts created before that table exists keep their
 *   product, but nothing writes a second one to it.
 */
export function runMigrations(db: DatabaseSync): void {
  addMissingColumns(db, 'authors', AUTHOR_COLUMNS_TO_ADD);
  addMissingColumns(db, 'products', PRODUCT_COLUMNS_TO_ADD);
  addMissingColumns(db, 'products', PRODUCT_RESEARCH_COLUMNS_TO_ADD);
  addMissingColumns(db, 'products', PRODUCT_THEME_COLUMNS_TO_ADD);
  addMissingColumns(db, 'article_products', ARTICLE_PRODUCT_REVIEW_COLUMNS_TO_ADD);
  addMissingColumns(db, 'ai_provider_models', AI_MODEL_PIPELINE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'generation_history', GENERATION_HISTORY_PIPELINE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'articles', ARTICLE_PIPELINE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'article_pipelines', PIPELINE_RUN_MODE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'article_pipelines', PIPELINE_TOPIC_MODE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'articles', ARTICLE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'articles', ARTICLE_GENERATION_COLUMNS_TO_ADD);
  addMissingColumns(db, 'articles', ARTICLE_CONTENT_COLUMNS_TO_ADD);
  addMissingColumns(db, 'generation_history', GENERATION_HISTORY_COLUMNS_TO_ADD);
  addMissingColumns(db, 'authors', AUTHOR_PERSONA_COLUMNS_TO_ADD);
  addMissingColumns(db, 'authors', AUTHOR_CMS_COLUMNS_TO_ADD);
  addMissingColumns(db, 'topics', TOPIC_GUIDANCE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'ai_provider_models', AI_MODEL_PRICING_COLUMNS_TO_ADD);
  addMissingColumns(db, 'projects', PROJECT_GUIDANCE_COLUMNS_TO_ADD);
  addMissingColumns(db, 'ai_provider_models', AI_MODEL_REGISTRY_COLUMNS_TO_ADD);
  addMissingColumns(db, 'ai_provider_models', AI_MODEL_VALIDATION_COLUMNS_TO_ADD);
  // Must run after the capability table exists (schema.ts) and after the
  // columns above, since it reads is_default_for_purpose off the old shape.
  backfillModelCapabilities(db);
}
