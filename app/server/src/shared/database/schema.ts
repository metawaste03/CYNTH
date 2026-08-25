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
-- never written to SQLite. See shared/secrets/providerSecrets.ts.
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
CREATE TABLE IF NOT EXISTS ai_provider_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  display_name TEXT,
  purpose TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  is_default_for_purpose INTEGER NOT NULL DEFAULT 0,
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
`;
