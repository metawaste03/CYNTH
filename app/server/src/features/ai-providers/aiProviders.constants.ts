/**
 * The three supported provider types (Milestone 8). "Supported" curates
 * what the UI suggests — it does not restrict what can be stored: provider
 * records also accept any other freeform type string, so a future provider
 * can be added without a schema or validation change.
 */
export const SUPPORTED_PROVIDER_TYPES = ['openrouter', 'anthropic', 'openai'] as const;

/** Built-in task purposes a model can be assigned to. Fixed for this milestone — not user-editable reference data like article_types. */
export const MODEL_PURPOSES = [
  'article_generation',
  'seo_review',
  'quality_review',
  'title_generation',
  'keyword_expansion',
] as const;

export type ModelPurpose = (typeof MODEL_PURPOSES)[number];

export function isValidPurpose(value: unknown): value is ModelPurpose {
  return typeof value === 'string' && (MODEL_PURPOSES as readonly string[]).includes(value);
}
