/**
 * Engine-level defaults for AI generation (Milestone 9).
 *
 * Nothing in the binder specifies these numbers — they are implementation
 * details required to make a request at all, kept in one place so they are
 * easy to change without touching adapter code (see
 * docs/04_DEVELOPMENT_RULES.md rule 7).
 */

/**
 * Anthropic's Messages API requires max_tokens, so Cynth has to supply one.
 * Deliberately below the smallest output cap across current Anthropic models
 * so a correctly configured model is never rejected for asking too much.
 *
 * The OpenAI-compatible endpoints (OpenAI, OpenRouter) treat an output limit
 * as optional and are sent none, which avoids the max_tokens vs.
 * max_completion_tokens split between older and newer OpenAI models.
 */
export const ANTHROPIC_MAX_OUTPUT_TOKENS = 4000;

/**
 * How long one provider request may take before Cynth gives up. A single
 * attempt only — Cynth never retries on its own; retrying is the user's
 * explicit decision (Milestone 9, "RETRY").
 */
export const GENERATION_TIMEOUT_MS = 180_000;

/** Used when a provider record has no base_url of its own. */
export const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  anthropic: 'https://api.anthropic.com',
};

/** Anthropic requires an explicit API version header. */
export const ANTHROPIC_API_VERSION = '2023-06-01';
