/**
 * Cynth's provider-agnostic generation contract (Milestone 9).
 *
 * Everything upstream of a provider adapter speaks only these types. A new
 * provider is added by writing one adapter that translates them into that
 * vendor's API and back — nothing else in the engine changes.
 */

/** What Cynth asks a model to do. The prompt always comes from the Prompt Builder. */
export interface GenerationRequest {
  /** The complete assembled prompt. Cynth has exactly one prompt-building system. */
  prompt: string;
  /** The model id as the provider expects it, from the configured model record. */
  model: string;
  timeoutMs: number;
}

/** Per-call credentials and endpoint. Never logged, never persisted, never returned to the client. */
export interface ProviderCallContext {
  apiKey: string;
  /** The provider record's base_url, or null to use the adapter's default. */
  baseUrl: string | null;
}

/** Token usage exactly as the provider reported it. Never estimated or invented — absent stays absent. */
export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

/** What every adapter returns, whatever shape the provider actually sent. */
export interface NormalizedGeneration {
  text: string;
  usage: TokenUsage | null;
  /** e.g. 'stop', 'length', 'max_tokens' — provider wording, kept for the history record. */
  finishReason: string | null;
  /** The model id the provider says it actually served, when it says. */
  reportedModel: string | null;
}

export interface ProviderAdapter {
  /** Matches ai_providers.provider_type. */
  readonly providerType: string;
  generate(request: GenerationRequest, context: ProviderCallContext): Promise<NormalizedGeneration>;
}
