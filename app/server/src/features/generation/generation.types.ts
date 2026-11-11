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
  /**
   * A hard cap on what the model may write back (Milestone 15).
   *
   * Article generation leaves this unset, so nothing truncates an article.
   * It exists for the model TEST path, where the answer's content is
   * irrelevant and the only question is whether the endpoint, the key and the
   * model id work — so the request is capped at a handful of tokens rather
   * than paying for a full response nobody reads.
   */
  maxOutputTokens?: number;
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

/**
 * Capability metadata a catalogue may publish about a model.
 *
 * Every field is optional because every field is optional in practice — a
 * catalogue that says nothing about modalities leaves them absent rather than
 * being credited with a guess. Cynth displays this and stores it; it does not
 * interpret it, and no routing or cost decision depends on it.
 */
export interface ModelCapabilities {
  /** What the model accepts, e.g. ['text', 'image']. */
  inputModalities?: string[];
  outputModalities?: string[];
  /** Maximum tokens the model will write, when the catalogue publishes a limit. */
  maxCompletionTokens?: number | null;
  tokenizer?: string | null;
  /** Request parameters the provider says this model honours. */
  supportedParameters?: string[];
  /** Whether the provider applies its own moderation layer, when it says. */
  moderated?: boolean | null;
}

/**
 * One model as a provider's own catalogue describes it.
 *
 * Provider-independent on purpose: this is the shape every catalogue is
 * normalised into, so the registry, the free/paid classifier and the UI never
 * learn any one vendor's JSON. OpenRouter is simply the first catalogue that
 * fills it in.
 *
 * Prices are per token, exactly as published. Null means the provider does
 * not publish a price for this model — Cynth records that as "unknown" and
 * never rounds it down to free.
 */
export interface ProviderModelInfo {
  /** The model id as the provider expects it in a request. */
  id: string;
  displayName: string | null;
  /**
   * The upstream house behind the model (e.g. "anthropic"), as distinct from
   * the Cynth provider record used to reach it (e.g. an OpenRouter account).
   * Null when the catalogue does not say and it cannot be read off the id.
   */
  vendor: string | null;
  description: string | null;
  promptPrice: number | null;
  completionPrice: number | null;
  /**
   * A flat per-request charge, where a catalogue publishes one. A non-zero
   * value means the model is not free however cheap its per-token prices are.
   */
  requestPrice: number | null;
  /**
   * The price of image OUTPUT, where the catalogue publishes one.
   *
   * Separate from the per-token prices because for an image model they are
   * not the same number and can disagree completely: OpenRouter lists
   * Seedream 4.5 at prompt 0 and completion 0 with image output at
   * $9.58/M tokens. Reading only the first two says "free" about a model that
   * charges for every image it draws, which is exactly the mistake the cost
   * layer exists to prevent.
   */
  imageOutputPrice: number | null;
  contextLength: number | null;
  /** Availability/status exactly as the provider reports it. Null = not reported. */
  status: string | null;
  capabilities: ModelCapabilities;
  /** When the provider says the model was published, if it says. */
  publishedAt: string | null;
}

export interface ProviderAdapter {
  /** Matches ai_providers.provider_type. */
  readonly providerType: string;
  generate(request: GenerationRequest, context: ProviderCallContext): Promise<NormalizedGeneration>;
  /**
   * The provider's model catalogue, when it publishes one.
   *
   * Optional because not every provider exposes pricing. This is a metadata
   * read — it generates nothing and costs nothing — but it is still a network
   * call, so only the sync endpoint invokes it, never generation.
   */
  listModels?(context: ProviderCallContext): Promise<ProviderModelInfo[]>;
  /**
   * Draws images, where the provider offers it.
   *
   * Optional, and absent on most adapters. A provider without this cannot be
   * asked for a featured image, and the caller is told that rather than being
   * silently routed somewhere else.
   */
  generateImages?(
    request: ImageGenerationRequest,
    context: ProviderCallContext,
  ): Promise<NormalizedImageGeneration>;
}

/* ------------------------------------------------------- image output --- */

/**
 * What Cynth asks an image model for (Milestone 25).
 *
 * Deliberately small. Cynth does not expose seeds, samplers, negative
 * prompts or style presets: the prompt is assembled from the article by one
 * builder, exactly as text generation works, and the only knobs are the ones
 * that change what a featured image IS rather than how it was made.
 */
export interface ImageGenerationRequest {
  prompt: string;
  model: string;
  /** How many candidates to produce. Every one of them is charged for. */
  count: number;
  /** e.g. '16:9'. Featured images are wide; a square hero is a different thing. */
  aspectRatio?: string;
  timeoutMs: number;
}

/** One generated image, held in memory until something decides to keep it. */
export interface GeneratedImage {
  /** Raw bytes. Never a data URI and never a remote URL: the file is ours or it does not exist. */
  data: Buffer;
  mimeType: string;
}

export interface NormalizedImageGeneration {
  images: GeneratedImage[];
  /**
   * What the provider says this actually cost, in USD.
   *
   * Reported rather than estimated. Image models are priced per image, so
   * there is no honest way to compute this from a token count beforehand —
   * null means the provider did not say, which is recorded as unknown and
   * never as zero.
   */
  reportedCost: number | null;
  reportedModel: string | null;
}
