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
`;
