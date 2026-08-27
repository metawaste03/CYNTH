/**
 * Row shapes mirroring schema.ts. Type-only — no queries or business logic.
 * Columns stay snake_case here to match the SQLite columns directly.
 */

export interface AuthorRow {
  id: number;
  name: string;
  category: string | null;
  short_biography: string | null;
  philosophy: string | null;
  writing_style: string | null;
  tone: string | null;
  target_audience: string | null;
  preferred_expressions: string | null;
  prohibited_expressions: string | null;
  writing_notes: string | null;
  /** Author persona (Milestone 11) — the dimensions not already covered by the voice fields above. */
  expertise: string | null;
  perspective: string | null;
  editorial_principles: string | null;
  boundaries: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AuthorWritingSampleRow {
  id: number;
  author_id: number;
  title: string;
  notes: string | null;
  full_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
  id: number;
  title: string;
  brand: string | null;
  category: string | null;
  short_description: string | null;
  description: string | null;
  image_path: string | null;
  affiliate_link: string | null;
  editorial_fit: string | null;
  notes: string | null;
  status: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ProductImageRow {
  id: number;
  product_id: number;
  file_path: string;
  original_filename: string | null;
  is_primary: number;
  position: number;
  created_at: string;
}

export interface ArticleTypeRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface ArticleRow {
  id: number;
  title: string | null;
  slug: string | null;
  author_id: number | null;
  article_type_id: number | null;
  product_id: number | null;
  /** Content configuration (Milestone 10). Nullable: a draft is valid before any of it is chosen. */
  project_id: number | null;
  theme_id: number | null;
  topic_id: number | null;
  /** Resolved names captured at generation time, as JSON — the historical record, immune to later renames. */
  provenance_snapshot: string | null;
  status: string;
  content: string | null;
  topic: string | null;
  target_audience: string | null;
  search_intent: string | null;
  reader_pain_points: string | null;
  questions_to_answer: string | null;
  important_topics: string | null;
  notes: string | null;
  generated_title: string | null;
  generated_at: string | null;
  generated_provider: string | null;
  generated_model: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeywordRow {
  id: number;
  article_id: number | null;
  primary_keyword: string | null;
  secondary_keywords: string | null;
  long_tail_keywords: string | null;
  created_at: string;
}

export interface SettingRow {
  key: string;
  value: string | null;
  updated_at: string;
}

export interface GenerationHistoryRow {
  id: number;
  article_id: number | null;
  /** The configured provider's display name — never a credential. */
  provider: string | null;
  /** The task type, e.g. 'article_generation' (column named in Milestone 2). */
  action: string | null;
  /** Small JSON metadata blob. Never contains keys, headers, or raw provider payloads. */
  payload: string | null;
  provider_type: string | null;
  model: string | null;
  status: string | null;
  error_code: string | null;
  error_message: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface AiProviderRow {
  id: number;
  name: string;
  provider_type: string;
  description: string | null;
  base_url: string | null;
  default_model: string | null;
  api_key_env_var: string | null;
  is_active: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface AiProviderModelRow {
  /** Pricing metadata from the provider's catalogue (Milestone 12). NULL = not known, never assumed free. */
  prompt_price: number | null;
  completion_price: number | null;
  context_length: number | null;
  is_free: number | null;
  pricing_synced_at: string | null;
  /** Registry metadata from the provider's catalogue (Milestone 13). All refreshable, none inferred. */
  vendor: string | null;
  /** A flat per-request charge. Non-zero means the model is not free regardless of per-token prices. */
  request_price: number | null;
  catalog_status: string | null;
  /** JSON capability blob, exactly as normalised from the catalogue. Opaque to Cynth. */
  capabilities: string | null;
  in_catalog: number | null;
  id: number;
  provider_id: number;
  model_name: string;
  display_name: string | null;
  purpose: string | null;
  is_enabled: number;
  is_default_for_purpose: number;
  created_at: string;
  updated_at: string;
}

/**
 * A configured CMS destination (Milestone 13). WordPress is the first
 * connector_type; the shape is deliberately CMS-agnostic.
 *
 * No credential value is ever stored — credential_env_var holds the NAME of
 * the environment variable, exactly as ai_providers.api_key_env_var does.
 */
export interface CmsConnectionRow {
  id: number;
  name: string;
  connector_type: string;
  description: string | null;
  base_url: string;
  auth_method: string;
  username: string | null;
  credential_env_var: string | null;
  default_remote_author_id: string | null;
  default_remote_author_name: string | null;
  is_active: number;
  is_default: number;
  last_status: string | null;
  last_stage: string | null;
  last_message: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The durable link between one Cynth Article and its copy in one CMS. Its existence is what makes a second push an update rather than a duplicate. */
export interface ArticleCmsLinkRow {
  id: number;
  article_id: number;
  connection_id: number;
  /** Text, not integer: Cynth must not assume every CMS numbers its posts. */
  external_id: string;
  external_status: string | null;
  external_url: string | null;
  external_edit_url: string | null;
  site_url: string | null;
  first_pushed_at: string | null;
  last_pushed_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One synchronisation attempt, success or failure. Audit trail only — never a credential. */
export interface CmsPushHistoryRow {
  id: number;
  article_id: number | null;
  connection_id: number | null;
  connection_name: string | null;
  site_url: string | null;
  operation: string;
  status: string;
  external_id: string | null;
  external_status: string | null;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}
