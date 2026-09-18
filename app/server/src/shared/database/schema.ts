/**
 * SQLite schema for Cynth. Every statement is idempotent
 * (CREATE TABLE IF NOT EXISTS) so initialization can run safely on every
 * startup without needing a separate migration step.
 *
 * This is storage shape only — no queries, no business logic. See
 * Milestone 2 (Database Foundation) and docs/06_DATABASE_DESIGN.md.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  short_biography TEXT,
  philosophy TEXT,
  writing_style TEXT,
  tone TEXT,
  target_audience TEXT,
  preferred_expressions TEXT,
  prohibited_expressions TEXT,
  writing_notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Multiple writing samples per author (Milestone 3). Superseded the single
-- approved_writing_samples TEXT column that Milestone 2's authors table
-- originally had — see migrations.ts for how existing databases catch up.
CREATE TABLE IF NOT EXISTS author_writing_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  full_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Author skills (Milestone 16). A long-form authoring document — identity,
-- philosophy, voice, structural habits, the "never does" list — stored and
-- injected VERBATIM.
--
-- This does not replace the structured persona columns on authors; it sits
-- beside them. Those fields answer specific questions in a fixed shape, which
-- suits an author described field by field. A skill document is the same
-- editorial identity written as prose the Product Owner authored elsewhere,
-- where decomposing it into columns would mean rewriting it and losing the
-- voice samples and prohibitions that are the actual guardrails.
--
-- author_id is nullable so a document can be imported before it is assigned,
-- and there may be several rows per author, so a second document (SEO
-- conventions, say) is an INSERT rather than a schema change. source_filename
-- records which file in the Author library a row came from, which is what makes
-- re-import and export round-trip to the same file.
--
-- scope distinguishes the two kinds of document:
--   'author' — belongs to one author (or to none yet, and is then inert).
--   'shared' — applies to every author, with author_id NULL. A shared
--              editorial philosophy is one row here rather than the same
--              paragraphs copied into five personas.
CREATE TABLE IF NOT EXISTS author_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER REFERENCES authors(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'author',
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  -- The markdown, exactly as written. Cynth never edits this on the way in or
  -- on the way to the model.
  body TEXT NOT NULL,
  source_filename TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  short_description TEXT,
  description TEXT,
  image_path TEXT,
  affiliate_link TEXT,
  editorial_fit TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Multiple images per product (Milestone 4), one flagged is_primary.
-- Superseded the single image_path TEXT column that Milestone 2's products
-- table originally had — see migrations.ts for how existing databases catch
-- up. image_path and status are left in place, unused, rather than dropped,
-- matching the precedent set for authors.approved_writing_samples.
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  original_filename TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- PRODUCT RESEARCH & INSERTION (Milestone 17).
--
-- Products the user selected, researched from the page they named, and placed
-- into an article where they are genuinely relevant.
--
-- Two rules the tables below make structural:
--
--   1. THE USER'S URL IS AUTHORITATIVE. products.affiliate_link is the link
--      the user supplied. Nothing in Cynth rewrites it, appends to it, or
--      derives a replacement for it. source_url below records the page that
--      was read for research, which may or may not be the same string; the
--      two are kept apart so that reading a page can never edit a link.
--   2. RESEARCH IS NOT INGESTION. product_research stores extracted fields
--      and a derived understanding, never page text. Its provenance points at
--      a web_retrieval, so any claim can name the fetch it came from.
-- ---------------------------------------------------------------------------

-- One product's place in one article. Replaces articles.product_id, which was
-- one product per article and is left in place, deprecated, rather than
-- dropped -- see migrations.ts.
--
-- placement_* is written after generation, from the markers the author emitted.
-- It records where a product actually landed, which is a fact about a
-- generated draft rather than an instruction to the model.
CREATE TABLE IF NOT EXISTS article_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  -- Why the user attached this product, in their words. Optional, and the
  -- strongest signal the placement step has when it is present.
  editorial_note TEXT,
  -- 'provided' | 'placed' | 'omitted'. 'omitted' is a real outcome: the model
  -- was told not to force a product where it does not belong.
  status TEXT NOT NULL DEFAULT 'provided',
  -- The heading the product ended up under, and the model's stated reason.
  placement_section TEXT,
  placement_rationale TEXT,
  placed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (article_id, product_id)
);

-- One research pass over one product, with its provenance.
--
-- retrieval_id is nullable ONLY because a product may be described by hand,
-- with no page read at all. When a page WAS read, the row that proves it is
-- required -- the same rule web_findings enforces.
CREATE TABLE IF NOT EXISTS product_research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  retrieval_id INTEGER REFERENCES web_retrievals(id) ON DELETE SET NULL,
  -- The page this research describes. Never used as a link in an article.
  source_url TEXT,
  -- 'manual' | 'structured_metadata' | 'ai'. Recorded rather than assumed, so
  -- a field a model wrote is never mistaken for one the page published.
  extraction_method TEXT NOT NULL,
  extraction_model TEXT,
  -- The structured metadata the page published about itself, as JSON. What
  -- was found, not the page it was found in.
  extracted TEXT,
  -- The derived understanding: what the product is for and who it suits.
  use_case TEXT,
  problem_solved TEXT,
  best_for TEXT,
  -- JSON array of short feature strings.
  key_features TEXT,
  summary TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- THE EDITORIAL PIPELINE (Milestone 20).
--
-- Cynth owns orchestration, state, cost control and idempotency; models own
-- research, writing and critique. These tables are the orchestration half.
--
-- Three properties the schema makes structural rather than hoped for:
--
--   1. A COMPLETED PAID STAGE IS NEVER RE-RUN. pipeline_stage_runs is unique
--      on (pipeline_id, pipeline_version, stage, attempt) and the service
--      refuses to start a stage that already has a successful run for the
--      current version. A restart, a refresh or a reopened article cannot
--      spend money twice.
--   2. REVISIONS ARE CAPPED AT ONE. revision_count lives on the pipeline and
--      is checked in code against MAX_AUTOMATIC_REVISIONS before a revision
--      stage may start.
--   3. EVERY TRANSITION IS RECORDED. pipeline_transitions is append-only, so
--      "how did this article get here" is always answerable.
-- ---------------------------------------------------------------------------

-- One run of the editorial pipeline over one article.
CREATE TABLE IF NOT EXISTS article_pipelines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- Bumped when the user deliberately starts over. Stage results are scoped to
  -- a version, so a new version re-runs stages while the previous version's
  -- results and costs remain readable.
  version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'DRAFT',
  -- 'development' | 'production'. Chooses which models the roles resolve to;
  -- the stages and rules are identical in both.
  mode TEXT NOT NULL DEFAULT 'production',
  -- 'automatic' | 'guided'. Guided stops at each checkpoint and waits for a
  -- person. It changes who decides, never what a stage is allowed to do.
  run_mode TEXT NOT NULL DEFAULT 'automatic',
  -- 'explore' | 'exact'. How faithfully topic research treats the editor's
  -- idea: a direction to find angles within, or a decided subject to research
  -- as given.
  topic_mode TEXT NOT NULL DEFAULT 'explore',
  theme_id INTEGER REFERENCES themes(id) ON DELETE SET NULL,
  -- Counted in the database rather than inferred from history, so the cap is
  -- enforceable with one read.
  revision_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  -- Why a run ended where it did, when that is not self-evident.
  outcome_note TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (article_id, version)
);

-- One execution of one stage. The idempotency record and the cost record.
--
-- output holds the stage's structured result as JSON, so a stage's product
-- survives independently of whatever it was later used to build — topic
-- research is not discarded once an article exists.
CREATE TABLE IF NOT EXISTS pipeline_stage_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL REFERENCES article_pipelines(id) ON DELETE CASCADE,
  pipeline_version INTEGER NOT NULL,
  stage TEXT NOT NULL,
  -- 1 for the first execution; incremented only by an explicit RERUN STAGE.
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'running',
  role TEXT,
  -- The model asked for, and the model that actually answered. They differ
  -- when a technical fallback occurred, and both are recorded so a fallback is
  -- visible rather than silent.
  requested_model TEXT,
  actual_model TEXT,
  provider TEXT,
  was_fallback INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cached_tokens INTEGER,
  total_tokens INTEGER,
  -- Estimated from the model's stored prices. NULL means the prices were
  -- unknown, which is reported as unknown rather than as zero.
  estimated_cost REAL,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  output TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE (pipeline_id, pipeline_version, stage, attempt)
);

-- Append-only history of state changes.
CREATE TABLE IF NOT EXISTS pipeline_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL REFERENCES article_pipelines(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  stage TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- GUIDED-RUN CHECKPOINTS (Milestone 24).
--
-- A checkpoint is a persisted pause. It exists so a guided run survives a
-- closed tab, a restart or a week of neglect: the decision, and who made it,
-- is a row rather than component state.
--
-- The options are NOT stored here. They already live in the stage run output
-- this checkpoint sits behind, and copying them would create a second version
-- of the truth that could drift from the first. Only the decision is stored.
CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL REFERENCES article_pipelines(id) ON DELETE CASCADE,
  -- Scoped to the version, exactly as stage runs are, so starting over asks
  -- the questions again rather than reusing last time's answers.
  pipeline_version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  stage TEXT NOT NULL,
  -- 'open' | 'resolved'.
  status TEXT NOT NULL DEFAULT 'open',
  -- 'chosen' when the editor picked something other than the recommendation,
  -- 'accepted' when they took it, 'automatic' when guided mode was switched
  -- off and Cynth settled it. An automatic choice must never read as a human
  -- one in the history.
  resolution TEXT,
  decision TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  UNIQUE (pipeline_id, pipeline_version, kind)
);

-- Which model runs which role, per mode.
--
-- Primary and fallback are separate columns rather than a priority list,
-- because the distinction is meaningful: the fallback is used ONLY when the
-- primary fails technically, never because a result was judged poor. An
-- editorial failure triggers a revision, not a different model.
CREATE TABLE IF NOT EXISTS pipeline_role_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'production',
  primary_model_id INTEGER REFERENCES ai_provider_models(id) ON DELETE SET NULL,
  fallback_model_id INTEGER REFERENCES ai_provider_models(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (role, mode)
);

-- ---------------------------------------------------------------------------
-- ARTICLE TEMPLATES (Milestone 20).
--
-- A template has two layers, and the separation is the point: the CONTENT
-- schema says what sections an article must contain, and the PRESENTATION
-- schema says how EveryFiveDays is expected to render them. Cynth produces
-- structured content; the website owns layout. No model writes site HTML.
--
-- Templates are versioned and never overwritten: an article records the
-- template id AND version it was written to, so republishing an old article
-- does not silently reinterpret it under a newer schema.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS article_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Stable identity across versions, e.g. 'buying-guide-v1'.
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  -- The article type this template serves, e.g. 'buying-guide'.
  article_type_slug TEXT NOT NULL,
  description TEXT,
  -- JSON: required/optional sections, order, and the editorial elements each
  -- section must carry.
  content_schema TEXT NOT NULL,
  -- JSON: rendering expectations for the site. Advisory to EFD, never HTML.
  presentation_schema TEXT,
  -- Exactly one default per article type, enforced in the repository.
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (template_id, version)
);

-- ---------------------------------------------------------------------------
-- MEDIA LIBRARY (Milestone 22).
--
-- Images the editor uploads for ARTICLES, as distinct from product images.
-- The two are deliberately separate systems because they are found in
-- completely different ways:
--
--   product_images  belong to one product. An article gets them by attaching
--                   that product, so there is never anything to match.
--   media_assets    are loose. An article has to FIND one, so every asset
--                   carries the things a search can filter on: a thematic
--                   area, a kind, tags, and a description.
--
-- Cynth proposes an asset and the editor confirms it. Nothing here is ever
-- attached to an article automatically.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Relative path under the uploads root, as product_images stores it. Only
  -- the path lives in SQLite; the file itself is on disk.
  file_path TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  width INTEGER,
  height INTEGER,
  title TEXT NOT NULL,
  -- What the image actually shows. The single most useful field for matching,
  -- and the one a person must write: Cynth does not look at pixels.
  description TEXT,
  -- Accessibility text, carried through to the CMS.
  alt_text TEXT,
  -- Which content area this belongs to. The primary filter, so a workspace
  -- article never considers a pet-care photograph.
  theme_id INTEGER REFERENCES themes(id) ON DELETE SET NULL,
  -- 'featured' | 'inline' | 'diagram' | 'screenshot' | 'other'.
  kind TEXT NOT NULL DEFAULT 'featured',
  -- Free-form comma-separated keywords the editor supplies.
  tags TEXT,
  credit TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One asset used by one article, in one role.
--
-- A join table rather than a column on articles, because an article may carry
-- a featured image and several inline ones, and because the same asset is
-- reusable across articles without being copied.
CREATE TABLE IF NOT EXISTS article_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  -- 'featured' | 'inline'. An article has at most one featured image,
  -- enforced in the repository.
  role TEXT NOT NULL DEFAULT 'featured',
  -- The section key it belongs with, for an inline image.
  section_key TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  -- How it got here: 'manual' when the editor chose it, 'suggested' when they
  -- accepted a Cynth proposal. Recorded so an accepted suggestion is never
  -- mistaken for an independent editorial choice.
  origin TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (article_id, media_id, role)
);

CREATE TABLE IF NOT EXISTS article_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  slug TEXT,
  author_id INTEGER REFERENCES authors(id) ON DELETE SET NULL,
  article_type_id INTEGER REFERENCES article_types(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  content TEXT,
  topic TEXT,
  target_audience TEXT,
  search_intent TEXT,
  reader_pain_points TEXT,
  questions_to_answer TEXT,
  important_topics TEXT,
  notes TEXT,
  -- The generated draft (Milestone 9). The existing content column holds the
  -- generated body. generated_title is kept separate from title on purpose:
  -- title is the editor's working title, which generation must never overwrite.
  generated_title TEXT,
  generated_at TEXT,
  generated_provider TEXT,
  generated_model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
  primary_keyword TEXT,
  secondary_keywords TEXT,
  long_tail_keywords TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI provider configuration (Milestone 8). No secrets live here — api_key_env_var
-- names the environment variable holding the key; the key value itself is
-- never written to SQLite. See shared/secrets/secretStore.ts.
CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  description TEXT,
  base_url TEXT,
  default_model TEXT,
  api_key_env_var TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Multiple models per provider, one flagged is_default_for_purpose per
-- purpose system-wide (enforced in application code, mirroring the
-- product_images.is_primary pattern).
--
-- (provider_id, model_name) is likewise unique in practice and enforced in
-- application code rather than by a constraint: the table is already live in
-- existing databases, and adding a UNIQUE constraint there would mean
-- rebuilding it — potentially destroying rows a user configured by hand.
-- addModelFromCatalog() upserts on that pair, so re-adding a model from the
-- catalogue refreshes the existing entry instead of duplicating it.
CREATE TABLE IF NOT EXISTS ai_provider_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  display_name TEXT,
  purpose TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  is_default_for_purpose INTEGER NOT NULL DEFAULT 0,
  -- Pricing metadata, populated by syncing the provider's catalogue. NULL
  -- means unknown, which the cost layer treats as "cannot estimate" rather
  -- than "free" — refusing to guess is the whole point.
  prompt_price REAL,
  completion_price REAL,
  context_length INTEGER,
  is_free INTEGER,
  pricing_synced_at TEXT,
  -- Registry metadata (Milestone 13), all provider-published and refreshable.
  -- vendor is the upstream house behind the model (e.g. 'anthropic') as
  -- distinct from the Cynth provider record that reaches it (e.g. OpenRouter).
  vendor TEXT,
  -- A flat per-request charge some catalogues publish alongside per-token
  -- prices. A non-zero value means the model is NOT free, whatever its
  -- per-token prices say.
  request_price REAL,
  -- What image OUTPUT costs, where the catalogue publishes it. Image models
  -- routinely publish zero per-token prices and charge here instead, so this
  -- column is what stops one being classified as free.
  image_output_price REAL,
  -- Availability/status as the provider reports it. NULL = not reported.
  catalog_status TEXT,
  -- Capability metadata as JSON (modalities, tokenizer, output limits,
  -- supported parameters). Opaque to Cynth; shown, never interpreted.
  capabilities TEXT,
  -- Whether the provider's catalogue still lists this model at the last sync.
  in_catalog INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per AI generation attempt, success or failure (Milestone 9).
-- No API keys, no authorization headers, and no raw provider payloads are
-- ever written here — see features/generation/generationHistory.repository.ts.
-- The action column (Milestone 2) now holds the task type, e.g. article_generation.
-- The provider column holds the configured provider's name, not a credential.
-- Token counts are only ever what the provider actually reported; they stay
-- NULL when a provider reports nothing, and are never estimated.
CREATE TABLE IF NOT EXISTS generation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  provider TEXT,
  action TEXT,
  payload TEXT,
  provider_type TEXT,
  model TEXT,
  status TEXT,
  error_code TEXT,
  error_message TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- CMS integration (Milestone 13).
--
-- Cynth publishes through a CMS *connector*, not through WordPress. WordPress
-- is simply the first connector implemented; nothing below names it. A second
-- CMS is another connector_type and another row, not a schema change.
--
-- No credentials live here. credential_env_var names the environment variable
-- holding the secret; the value itself never reaches SQLite, exactly as
-- ai_providers.api_key_env_var already works.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cms_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- Matches a connector in features/cms/connectors/index.ts, e.g. 'wordpress'.
  connector_type TEXT NOT NULL,
  description TEXT,
  -- The site root, e.g. http://everyfivedays.local. Never hardcoded anywhere.
  base_url TEXT NOT NULL,
  auth_method TEXT NOT NULL DEFAULT 'application_password',
  username TEXT,
  -- The NAME of the env var holding the secret. Never the secret.
  credential_env_var TEXT,
  -- Optional author mapping: the remote CMS user id posts are attributed to.
  -- Null means "whoever Cynth authenticates as", which is the CMS's own default.
  default_remote_author_id TEXT,
  default_remote_author_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  -- Result of the last Test Connection. Diagnostics only; never a credential.
  last_status TEXT,
  last_stage TEXT,
  last_message TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The durable relationship between one Cynth Article and its copy in one CMS.
--
-- This is what stops a second Push from creating a second remote post: the
-- presence of a row here means the article already exists over there, and the
-- only honest action left is an update.
CREATE TABLE IF NOT EXISTS article_cms_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  connection_id INTEGER NOT NULL REFERENCES cms_connections(id) ON DELETE CASCADE,
  -- The remote post id, as text: Cynth must not assume every CMS uses integers.
  external_id TEXT NOT NULL,
  external_status TEXT,
  external_url TEXT,
  external_edit_url TEXT,
  -- The site the post lives on, denormalised so a deleted connection still
  -- leaves a readable history of where the content went.
  site_url TEXT,
  first_pushed_at TEXT,
  last_pushed_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (article_id, connection_id)
);

-- One row per synchronisation attempt, success or failure. An audit trail,
-- deliberately separate from article_cms_links (which holds current state).
-- Never contains credentials — see features/cms/cmsPublish.service.ts.
CREATE TABLE IF NOT EXISTS cms_push_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  connection_id INTEGER REFERENCES cms_connections(id) ON DELETE SET NULL,
  connection_name TEXT,
  site_url TEXT,
  -- 'create' | 'update' | 'test' | 'refresh'
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  external_id TEXT,
  external_status TEXT,
  error_code TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Content architecture (Milestone 10).
--
-- Cynth is a general content engine. A Project owns a content universe;
-- EveryFiveDays is simply the first project seeded into it. Nothing below
-- names a theme, an author, or a topic — those are all data. Adding a sixth
-- thematic area is an INSERT, not a code change.
-- ---------------------------------------------------------------------------

-- One content universe. Cynth ships with EveryFiveDays seeded as the first
-- project; a second, unrelated content site would be another row.
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  -- Project-wide editorial rules that apply to every article. User-supplied.
  editorial_guidance TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  -- Exactly one default, enforced in the repository (same unset-others-then-set
  -- pattern used for ai_providers.is_default and product_images.is_primary).
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A thematic area (Cynth's generic term for a content area/category) belonging
-- to one project. "Smart Pet Care" is a row here, not a constant in code.
CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, slug)
);

-- A subject to write about, belonging to one theme. Persistent data, never a
-- string typed straight into a prompt.
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  -- Editorial guidance. These are what turn a topic from a label into
  -- instructions the generation engine can actually use. All optional and
  -- all supplied by the user — Cynth never invents editorial direction.
  scope TEXT,
  key_areas TEXT,
  considerations TEXT,
  exclusions TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (theme_id, slug)
);

-- Author <-> theme is deliberately many-to-many. EveryFiveDays may choose one
-- author per theme, but the engine must not enforce that: one author can cover
-- several themes, and a theme can have several authors.
CREATE TABLE IF NOT EXISTS author_themes (
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (author_id, theme_id)
);

-- Which of the shared article_types a project offers. The 10 seeded types are
-- Cynth's initial taxonomy; a different project can enable a different subset,
-- or add its own types to the same table.
CREATE TABLE IF NOT EXISTS project_article_types (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  article_type_id INTEGER NOT NULL REFERENCES article_types(id) ON DELETE CASCADE,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, article_type_id)
);

-- Optional narrowing: a theme that supports only some of its project's article
-- types. No rows for a theme means "every type the project enables" — absence
-- is permissive, so this stays opt-in and costs nothing until used.
CREATE TABLE IF NOT EXISTS theme_article_types (
  theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  article_type_id INTEGER NOT NULL REFERENCES article_types(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (theme_id, article_type_id)
);

-- ---------------------------------------------------------------------------
-- SEO ENGINE (Milestone 14).
--
-- SEO lives BESIDE the article, never inside it. Nothing below writes to
-- articles.content, articles.title, or any Content Brief field: an SEO
-- analysis can be run, discarded, and re-run without the article it describes
-- ever changing. That separation is the reason these are their own tables
-- rather than more columns on "articles".
-- ---------------------------------------------------------------------------

-- The article's SEO configuration and its derived SEO metadata, 1:1 with the
-- article. Configuration (what the article is trying to rank for) and
-- metadata (the SEO title, description and slug Cynth recommends) live
-- together because both are things the user owns and edits; findings and
-- scores, which Cynth derives and replaces, do not live here.
CREATE TABLE IF NOT EXISTS article_seo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,

  -- SEO CONFIGURATION (user-owned; Cynth never invents these).
  -- The primary search query. Deliberately nullable: not every article has an
  -- exact-match keyword, and the engine must work topically without one.
  target_query TEXT,
  -- 'informational' | 'commercial_investigation' | 'transactional' |
  -- 'navigational' | 'hybrid'. Free text at the storage layer so a future
  -- vocabulary change is data, not a migration.
  search_intent TEXT,
  -- For hybrid intent: the secondary intents, comma-separated.
  secondary_intents TEXT,
  -- Supporting queries. Semantic, not a stuffing list.
  secondary_keywords TEXT,
  -- Concepts/entities the article should cover, independent of exact wording.
  semantic_topics TEXT,
  target_audience TEXT,
  -- Where this article is meant to be relevant. Null = no geographic target,
  -- which is a real answer, not a missing one.
  geo_target TEXT,
  seo_objectives TEXT,
  notes TEXT,

  -- SEO METADATA (Cynth-recommended, user-approved).
  -- Distinct from articles.title on purpose: the H1/editorial title and the
  -- SERP title are different jobs and may legitimately differ.
  seo_title TEXT,
  meta_description TEXT,
  -- Distinct from articles.slug: the editorial slug follows the title, while
  -- a published URL must be stable. Null means "use the article slug".
  seo_slug TEXT,
  canonical_url TEXT,
  -- Schema types a human accepted, as a JSON array of strings. Eligibility is
  -- computed; acceptance is stored.
  structured_data_types TEXT,
  -- The structured data document itself, as JSON. Only ever written from
  -- values Cynth actually holds — never to satisfy a schema's shape.
  structured_data TEXT,

  -- LATEST ANALYSIS SUMMARY (denormalised for lists; the run itself is
  -- authoritative and is never overwritten).
  latest_analysis_id INTEGER REFERENCES seo_analysis_runs(id) ON DELETE SET NULL,
  latest_score INTEGER,
  -- 'not_analyzed' | 'blocked' | 'warnings' | 'ready'
  readiness TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (article_id)
);

-- One row per SEO analysis attempt, deterministic or AI-assisted.
--
-- An audit trail, like generation_history: it records what was analysed, by
-- what, at what cost, and what came out. Never a credential, never a raw
-- provider payload.
CREATE TABLE IF NOT EXISTS seo_analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- 'deterministic' | 'ai' | 'combined'
  mode TEXT NOT NULL,
  -- 'success' | 'partial' | 'failure'. 'partial' means the deterministic pass
  -- succeeded and the AI pass did not — an honest state that must not be
  -- reported as a complete analysis.
  status TEXT NOT NULL,
  -- Provider/model only when an AI pass actually ran.
  provider TEXT,
  provider_type TEXT,
  model TEXT,
  cost_class TEXT,
  generation_mode TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  -- The 0-100 readiness score and the per-dimension breakdown that explains it.
  score INTEGER,
  score_breakdown TEXT,
  -- Hash of the analysed content and of the SEO configuration. Two identical
  -- fingerprints mean a re-run would ask the model the same question about
  -- the same text — which is what makes caching honest rather than stale.
  content_fingerprint TEXT,
  config_fingerprint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One structured SEO finding. Never a paragraph of prose in a single blob:
-- category, severity, where it applies, why, and what to do are separate
-- fields because the UI, the score and the gate each need different ones.
CREATE TABLE IF NOT EXISTS seo_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER NOT NULL REFERENCES seo_analysis_runs(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- A stable machine code, e.g. 'meta_description_missing'. Deterministic
  -- findings always have one; AI findings carry the category as their code.
  code TEXT NOT NULL,
  category TEXT NOT NULL,
  -- Which scoring dimension this finding belongs to.
  dimension TEXT NOT NULL,
  -- 'blocking' | 'warning' | 'recommendation' | 'info'
  severity TEXT NOT NULL,
  -- 'deterministic' | 'ai'. Never blurred: a rule Cynth computed and a
  -- judgement a model made are different kinds of claim.
  origin TEXT NOT NULL,
  summary TEXT NOT NULL,
  explanation TEXT,
  recommendation TEXT,
  -- Which part of the article this is about: 'title' | 'seo_title' |
  -- 'meta_description' | 'slug' | 'heading' | 'introduction' | 'section' |
  -- 'paragraph' | 'body' | 'images' | 'links' | 'structured_data' | 'config'.
  element TEXT,
  -- PASSAGE-LEVEL ANCHOR, as JSON: heading text, heading path, paragraph
  -- index, character offsets, quoted excerpt. This is what turns "improve
  -- your article" into "this paragraph, under this heading".
  locator TEXT,
  -- 0..1. Deterministic findings are 1 by definition; AI findings carry the
  -- model's own stated confidence, which the score then weights by.
  confidence REAL,
  -- 'open' | 'dismissed' | 'resolved'
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recommendation -> Proposed Change -> Approved Change.
--
-- Three distinct things kept in three distinct columns, because collapsing
-- them is exactly how an "assistant" starts silently rewriting articles.
-- "recommendation" is what Cynth thinks should change; "proposed_value" is
-- concrete text it suggests; "status" records what the human decided. Nothing
-- in this milestone can move a row to 'applied' for article body content.
CREATE TABLE IF NOT EXISTS seo_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  finding_id INTEGER REFERENCES seo_findings(id) ON DELETE SET NULL,
  analysis_id INTEGER REFERENCES seo_analysis_runs(id) ON DELETE SET NULL,
  -- Which SEO field a proposal targets: 'seo_title' | 'meta_description' |
  -- 'seo_slug' | 'structured_data' | 'heading' | 'content' | 'image_alt'.
  field TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  -- What the field holds right now, captured when the proposal was made.
  current_value TEXT,
  -- What Cynth suggests instead. Null for a recommendation with no concrete
  -- replacement — a suggestion without text is still a legitimate finding.
  proposed_value TEXT,
  rationale TEXT,
  confidence REAL,
  origin TEXT NOT NULL,
  -- 'proposed' | 'approved' | 'rejected' | 'applied'
  status TEXT NOT NULL DEFAULT 'proposed',
  approved_at TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Internal link opportunities between two Cynth articles.
--
-- target_article_id is a real foreign key on purpose: an internal link
-- opportunity that does not point at an article Cynth actually holds cannot
-- be represented at all, so the engine cannot invent one.
CREATE TABLE IF NOT EXISTS seo_internal_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER REFERENCES seo_analysis_runs(id) ON DELETE CASCADE,
  source_article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- Anchor text. Where possible this is a phrase that genuinely appears in
  -- the source article, not a phrase Cynth made up.
  anchor_suggestion TEXT,
  -- Whether that anchor was actually found in the source text.
  anchor_found_in_source INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  relevance REAL,
  confidence REAL,
  origin TEXT NOT NULL,
  -- 'proposed' | 'approved' | 'rejected'. Never 'inserted' — this milestone
  -- has no code that writes a link into an article.
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- External source opportunities.
--
-- The distinction this table exists to keep: a RECOMMENDED source is a
-- suggestion, and a VERIFIED source is one something actually fetched and
-- confirmed. verification_status starts 'unverified' and nothing in this
-- milestone can move it, because nothing in this milestone fetches anything.
CREATE TABLE IF NOT EXISTS seo_external_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER REFERENCES seo_analysis_runs(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- What the source would do for the article: 'authority' | 'evidence' |
  -- 'factual_support' | 'reader_usefulness'.
  purpose TEXT,
  -- The claim or passage that would benefit, so the suggestion is anchored.
  claim_context TEXT,
  -- What kind of source would serve, e.g. "a veterinary association".
  source_type TEXT,
  -- A specific domain, only when one was actually named. Never required.
  suggested_domain TEXT,
  -- A specific URL, only when one was actually named. Stored exactly as
  -- given, never dereferenced, and never presented as checked.
  suggested_url TEXT,
  -- 'unverified' | 'verified' | 'unreachable' | 'rejected'
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  verified_at TEXT,
  -- Set once a retrieval actually happened, linking the claim to its evidence.
  verified_retrieval_id INTEGER REFERENCES web_retrievals(id) ON DELETE SET NULL,
  rationale TEXT,
  confidence REAL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- SEO requirements for an article's images.
--
-- Requirements only. This milestone creates no images and invents no image
-- URLs: a row here describes what an image should be and how it should be
-- described, for a human or a later milestone to satisfy.
CREATE TABLE IF NOT EXISTS seo_image_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER REFERENCES seo_analysis_runs(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- Where in the article this image belongs, e.g. 'featured' or a section.
  placement TEXT,
  -- What the image is for, editorially.
  purpose TEXT,
  alt_text TEXT,
  filename_suggestion TEXT,
  caption TEXT,
  descriptive_context TEXT,
  -- Set when this requirement describes an image that already exists in the
  -- article body, so a missing-alt finding can point at it.
  existing_source TEXT,
  origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- WEB INTELLIGENCE FOUNDATION (Milestone 14).
--
-- Architecture only. There is no crawler in this milestone, and the tables
-- below are deliberately shaped so that one cannot be bolted on without
-- provenance: a web_finding requires a web_retrieval, and a web_retrieval
-- requires a web_source the user explicitly authorised.
--
-- No row in web_sources is ever created by Cynth. Every one of them is a
-- domain the user supplied, and both permissions default to OFF.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS web_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Optional: a source can be scoped to one project or shared across all.
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  -- Host only, e.g. "example.org". Stored normalised, without scheme or path.
  domain TEXT NOT NULL,
  description TEXT,
  -- Why this source is in the list: 'research' | 'authority' | 'competitor' |
  -- 'backlink_target' | 'own_site' | 'other'.
  purpose TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  -- The two permissions, both defaulting to 0. Cynth must not read a site
  -- because it appears in a list; it may read it because the user said so.
  crawl_permitted INTEGER NOT NULL DEFAULT 0,
  search_permitted INTEGER NOT NULL DEFAULT 0,
  -- Technical boundaries the user sets and a future retriever must honour.
  respect_robots INTEGER NOT NULL DEFAULT 1,
  rate_limit_per_minute INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (domain)
);

-- One retrieval of one URL from one authorised source. The provenance record.
--
-- Nothing writes to this table in Milestone 14. It exists so that when a
-- retriever is built, "where did this come from" is already a required field
-- rather than something to be retrofitted.
CREATE TABLE IF NOT EXISTS web_retrievals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  web_source_id INTEGER NOT NULL REFERENCES web_sources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  http_status INTEGER,
  retrieved_at TEXT NOT NULL DEFAULT (datetime('now')),
  content_type TEXT,
  -- Hash of what was retrieved, so a later finding can prove which version of
  -- a page it came from.
  content_hash TEXT,
  title TEXT,
  -- How it was obtained, e.g. 'http_get'. Recorded rather than assumed.
  retrieval_method TEXT,
  -- Whether robots.txt permitted this fetch at the time. Null = not checked,
  -- which is itself information a reviewer needs.
  robots_allowed INTEGER,
  notes TEXT
);

-- One insight extracted from one retrieval.
--
-- web_retrieval_id is NOT NULL: a finding without a retrieval is a claim
-- without a source, and this schema refuses to store one.
CREATE TABLE IF NOT EXISTS web_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  retrieval_id INTEGER NOT NULL REFERENCES web_retrievals(id) ON DELETE CASCADE,
  web_source_id INTEGER NOT NULL REFERENCES web_sources(id) ON DELETE CASCADE,
  -- Denormalised from the retrieval so a citation survives independently.
  url TEXT NOT NULL,
  topic TEXT,
  -- 'fact' | 'statistic' | 'definition' | 'entity' | 'question' |
  -- 'competitor_coverage' | 'other'.
  finding_type TEXT,
  insight TEXT NOT NULL,
  -- Why this matters for SEO, when it does. Null when it is editorial only.
  seo_relevance TEXT,
  confidence REAL,
  -- A human-readable citation for the article, when the finding is used.
  citation TEXT,
  -- Whether an extraction was computed or model-assisted, and by which model.
  extraction_method TEXT,
  extraction_model TEXT,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'unreviewed'
);

-- ---------------------------------------------------------------------------
-- BACKLINK FOUNDATION (Milestone 14).
--
-- Architecture only. No discovery engine, and no code path that writes a link
-- into an article. The status column encodes the workflow that will govern
-- one when it exists: discovered -> recommended -> approved/rejected.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS backlink_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The Cynth article the backlink would point at.
  target_article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- The authorised source it would come from, when it came from one.
  web_source_id INTEGER REFERENCES web_sources(id) ON DELETE SET NULL,
  source_domain TEXT NOT NULL,
  source_url TEXT,
  anchor_suggestion TEXT,
  relevance TEXT,
  -- Authority indicators ONLY where a real signal exists, plus where it came
  -- from. Cynth does not publish a domain-authority number it cannot source.
  authority_signal TEXT,
  authority_source TEXT,
  -- The retrieval that evidences this opportunity, when one exists.
  evidence_retrieval_id INTEGER REFERENCES web_retrievals(id) ON DELETE SET NULL,
  -- 'discovered' | 'recommended' | 'approved' | 'rejected' | 'placed'
  status TEXT NOT NULL DEFAULT 'discovered',
  decided_at TEXT,
  notes TEXT,
  origin TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- MODEL CAPABILITIES (Milestone 15).
--
-- A registered model is Provider -> Model -> Capability, and a model may hold
-- SEVERAL capabilities. Before this table a capability was a single column on
-- ai_provider_models, which forced one row per purpose: the same model
-- registered for Article Generation and for SEO Review appeared twice, as two
-- unrelated entries that had to be configured, tested and priced separately.
--
-- The set lives here instead, so the registry holds one row per
-- (provider, model) and the capability list is data rather than shape.
-- ai_provider_models.purpose is deprecated-but-preserved: it is backfilled
-- into this table by migration and is no longer read anywhere.
--
-- is_default_for_purpose is per (model, purpose) — "the default SEO model"
-- and "the default article model" are independent choices, and one model can
-- be both.
CREATE TABLE IF NOT EXISTS ai_model_capabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL REFERENCES ai_provider_models(id) ON DELETE CASCADE,
  -- One of aiProviders.constants.ts MODEL_PURPOSES. Validated in application
  -- code rather than by a CHECK constraint, so adding a purpose stays a
  -- one-line change instead of a table rebuild.
  purpose TEXT NOT NULL,
  is_default_for_purpose INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (model_id, purpose)
);

-- ---------------------------------------------------------------------------
-- QUALITY GATE (Milestone 15).
--
-- Article readiness, kept deliberately separate from SEO: an article can pass
-- the Quality Gate and still fail SEO, and the two answer different questions.
-- Quality asks "is this a complete, coherent article that a person could
-- review?"; SEO asks "will it perform in search?".
--
-- One row per article, holding the LATEST evaluation. The per-check detail is
-- stored as JSON rather than as a child table because a check is a rendered
-- explanation, not something Cynth ever queries across articles — and because
-- the check list evolves, which a fixed schema would fight.
--
-- Nothing here writes to the articles table. The gate observes an article; it
-- never edits one.
CREATE TABLE IF NOT EXISTS article_quality_gate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  -- 'not_evaluated' | 'passed' | 'passed_with_warnings' | 'failed'
  status TEXT NOT NULL DEFAULT 'not_evaluated',
  -- Counts, so a list can show "3 failed, 2 warnings" without parsing JSON.
  failed_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  -- The full per-check result as JSON: key, label, severity, outcome, detail.
  checks TEXT,
  -- Fingerprint of the article at evaluation time, so a stale result can be
  -- reported as stale instead of being trusted.
  content_fingerprint TEXT,
  evaluated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
