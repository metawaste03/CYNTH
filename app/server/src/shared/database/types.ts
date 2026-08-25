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
