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
  /** The CMS user this author's articles are attributed to. Null falls back to the connection default. */
  remote_author_id: string | null;
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

/** A long-form authoring document (Milestone 16). `body` is markdown, stored verbatim. */
export interface AuthorSkillRow {
  id: number;
  /** Null while the document is imported but not yet assigned to an author, and always null for a shared skill. */
  author_id: number | null;
  /** 'author' | 'shared'. A shared skill applies to every author. */
  scope: string;
  name: string;
  slug: string;
  body: string;
  /** The file in the Author library this row was imported from, if any. */
  source_filename: string | null;
  position: number;
  is_active: number;
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
  /** Product research (Milestone 17). `affiliate_link` above stays the user's authoritative link. */
  source_url: string | null;
  vendor: string | null;
  source_image_url: string | null;
  use_case: string | null;
  problem_solved: string | null;
  best_for: string | null;
  /** JSON array of short feature strings. */
  key_features: string | null;
  research_status: string;
  researched_at: string | null;
  /** The thematic area this product belongs to (Milestone 18). Null means none chosen. */
  theme_id: number | null;
  created_at: string;
  updated_at: string;
}

/** One product's place in one article (Milestone 17). */
export interface ArticleProductRow {
  id: number;
  article_id: number;
  product_id: number;
  position: number;
  editorial_note: string | null;
  /** 'provided' | 'placed' | 'omitted'. */
  status: string;
  placement_section: string | null;
  placement_rationale: string | null;
  placed_at: string | null;
  /** The placement review (Milestone 18). An opinion about the placement above, never a change to it. */
  review_verdict: string | null;
  review_assessment: string | null;
  review_suggested_section: string | null;
  review_confidence: number | null;
  review_model: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/** One research pass over one product, with its provenance (Milestone 17). */
export interface ProductResearchRow {
  id: number;
  product_id: number;
  retrieval_id: number | null;
  source_url: string | null;
  /** 'manual' | 'structured_metadata' | 'ai'. */
  extraction_method: string;
  extraction_model: string | null;
  /** JSON: the structured metadata the page published about itself. */
  extracted: string | null;
  use_case: string | null;
  problem_solved: string | null;
  best_for: string | null;
  /** JSON array of short feature strings. */
  key_features: string | null;
  summary: string | null;
  notes: string | null;
  created_at: string;
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
  /** What image output costs. Non-zero means the model is not free even when its per-token prices are zero. */
  image_output_price: number | null;
  catalog_status: string | null;
  /** JSON capability blob, exactly as normalised from the catalogue. Opaque to Cynth. */
  capabilities: string | null;
  in_catalog: number | null;
  id: number;
  provider_id: number;
  model_name: string;
  display_name: string | null;
  /**
   * DEPRECATED (Milestone 15), preserved rather than dropped.
   *
   * A model's capabilities are now a set, held in ai_model_capabilities. This
   * column keeps whatever the row was created with and is no longer read.
   */
  purpose: string | null;
  is_enabled: number;
  /** DEPRECATED (Milestone 15) — the default flag is now per capability. */
  is_default_for_purpose: number;
  /** Validation state written by the save path (Milestone 15). Never holds a credential. */
  validation_status: string | null;
  validation_code: string | null;
  validation_message: string | null;
  validated_at: string | null;
  /** The last explicit Test Model run, written only by the test path. */
  last_test_status: string | null;
  last_test_message: string | null;
  last_test_mode: string | null;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One capability a registered model holds (Milestone 15). A model may hold several. */
export interface AiModelCapabilityRow {
  id: number;
  model_id: number;
  purpose: string;
  is_default_for_purpose: number;
  created_at: string;
}

/**
 * The latest Quality Gate evaluation for an article (Milestone 15).
 *
 * Separate from every SEO table on purpose: quality and SEO are different
 * questions with different answers, and an article may legitimately pass one
 * while failing the other.
 */
export interface ArticleQualityGateRow {
  id: number;
  article_id: number;
  status: string;
  failed_count: number;
  warning_count: number;
  passed_count: number;
  /** JSON array of per-check results. */
  checks: string | null;
  content_fingerprint: string | null;
  evaluated_at: string | null;
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

/* ------------------------------------------------------ SEO Engine (M14) --- */

/** SEO configuration and derived SEO metadata, 1:1 with an article. */
export interface ArticleSeoRow {
  id: number;
  article_id: number;
  target_query: string | null;
  search_intent: string | null;
  secondary_intents: string | null;
  secondary_keywords: string | null;
  semantic_topics: string | null;
  target_audience: string | null;
  geo_target: string | null;
  seo_objectives: string | null;
  notes: string | null;
  seo_title: string | null;
  meta_description: string | null;
  seo_slug: string | null;
  canonical_url: string | null;
  structured_data_types: string | null;
  structured_data: string | null;
  latest_analysis_id: number | null;
  latest_score: number | null;
  readiness: string | null;
  created_at: string;
  updated_at: string;
}

/** One SEO analysis attempt. Never carries a credential or a raw provider payload. */
export interface SeoAnalysisRunRow {
  id: number;
  article_id: number;
  mode: string;
  status: string;
  provider: string | null;
  provider_type: string | null;
  model: string | null;
  cost_class: string | null;
  generation_mode: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  score: number | null;
  score_breakdown: string | null;
  content_fingerprint: string | null;
  config_fingerprint: string | null;
  created_at: string;
}

export interface SeoFindingRow {
  id: number;
  analysis_id: number;
  article_id: number;
  code: string;
  category: string;
  dimension: string;
  severity: string;
  origin: string;
  summary: string;
  explanation: string | null;
  recommendation: string | null;
  element: string | null;
  /** JSON passage anchor — heading, paragraph index, offsets, excerpt. */
  locator: string | null;
  confidence: number | null;
  status: string;
  created_at: string;
}

export interface SeoRecommendationRow {
  id: number;
  article_id: number;
  finding_id: number | null;
  analysis_id: number | null;
  field: string;
  recommendation: string;
  current_value: string | null;
  proposed_value: string | null;
  rationale: string | null;
  confidence: number | null;
  origin: string;
  status: string;
  approved_at: string | null;
  applied_at: string | null;
  created_at: string;
}

export interface SeoInternalLinkRow {
  id: number;
  analysis_id: number | null;
  source_article_id: number;
  target_article_id: number;
  anchor_suggestion: string | null;
  anchor_found_in_source: number;
  reason: string | null;
  relevance: number | null;
  confidence: number | null;
  origin: string;
  status: string;
  created_at: string;
}

export interface SeoExternalSourceRow {
  id: number;
  analysis_id: number | null;
  article_id: number;
  purpose: string | null;
  claim_context: string | null;
  source_type: string | null;
  suggested_domain: string | null;
  suggested_url: string | null;
  verification_status: string;
  verified_at: string | null;
  verified_retrieval_id: number | null;
  rationale: string | null;
  confidence: number | null;
  origin: string;
  status: string;
  created_at: string;
}

export interface SeoImageRequirementRow {
  id: number;
  analysis_id: number | null;
  article_id: number;
  placement: string | null;
  purpose: string | null;
  alt_text: string | null;
  filename_suggestion: string | null;
  caption: string | null;
  descriptive_context: string | null;
  existing_source: string | null;
  origin: string;
  status: string;
  created_at: string;
}

/* ---------------------------------------- Web intelligence foundation (M14) */

/** A domain the USER authorised Cynth to investigate. Never created by Cynth. */
export interface WebSourceRow {
  id: number;
  project_id: number | null;
  name: string;
  domain: string;
  description: string | null;
  purpose: string | null;
  is_active: number;
  crawl_permitted: number;
  search_permitted: number;
  respect_robots: number;
  rate_limit_per_minute: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** The provenance record: one retrieval of one URL. Nothing writes this in M14. */
export interface WebRetrievalRow {
  id: number;
  web_source_id: number;
  url: string;
  http_status: number | null;
  retrieved_at: string;
  content_type: string | null;
  content_hash: string | null;
  title: string | null;
  retrieval_method: string | null;
  robots_allowed: number | null;
  notes: string | null;
}

/** One insight extracted from one retrieval. retrieval_id is NOT NULL by design. */
export interface WebFindingRow {
  id: number;
  retrieval_id: number;
  web_source_id: number;
  url: string;
  topic: string | null;
  finding_type: string | null;
  insight: string;
  seo_relevance: string | null;
  confidence: number | null;
  citation: string | null;
  extraction_method: string | null;
  extraction_model: string | null;
  extracted_at: string;
  status: string;
}

export interface BacklinkOpportunityRow {
  id: number;
  target_article_id: number;
  web_source_id: number | null;
  source_domain: string;
  source_url: string | null;
  anchor_suggestion: string | null;
  relevance: string | null;
  authority_signal: string | null;
  authority_source: string | null;
  evidence_retrieval_id: number | null;
  status: string;
  decided_at: string | null;
  notes: string | null;
  origin: string;
  created_at: string;
  updated_at: string;
}
