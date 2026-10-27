/** Mirrors the server's generation feature (Milestone 9). Nothing here ever carries an API key — the server never sends one. */

export interface GeneratedArticle {
  /** The title the model wrote, or null when it did not clearly write one. Never replaces the working title. */
  title: string | null;
  content: string;
  generatedAt: string;
  provider: string | null;
  model: string | null;
}

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

/** How a model is classified for cost. `unknown` is deliberately distinct from `free`. */
export type ModelCostClass = 'free' | 'paid' | 'unknown';

export type GenerationMode = 'test' | 'production';

export interface CostEstimate {
  costClass: ModelCostClass;
  currency: 'USD' | null;
  promptTokens: number | null;
  estimatedCompletionTokens: number | null;
  promptCost: number | null;
  completionCost: number | null;
  /** Null whenever pricing is unknown — never a guess. */
  totalCost: number | null;
  note: string;
}

export interface SpendDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  costClass: ModelCostClass;
  mode: GenerationMode;
  reason: string | null;
}

export interface GenerationPreflight {
  articleId: number;
  taskType: string;
  articleTypeName: string | null;
  authorName: string | null;
  productName: string | null;
  provider: { name: string; providerType: string; hasApiKey: boolean } | null;
  model: {
    /** The registry entry id, so the picker can pre-select the model that will actually be used. */
    id: number;
    modelName: string;
    displayName: string | null;
    vendor: string | null;
    promptPrice: number | null;
    completionPrice: number | null;
    requestPrice: number | null;
    contextLength: number | null;
    pricingSyncedAt: string | null;
  } | null;
  /** True when this preflight describes a model the user chose rather than the configured default. */
  isExplicitSelection: boolean;
  promptCharacterCount: number | null;
  promptWordCount: number | null;
  ready: boolean;
  issues: string[];
  configurationErrorCode: string | null;
  /** COST SAFETY — surfaced before the user commits to anything. */
  mode: GenerationMode;
  costClass: ModelCostClass;
  cost: CostEstimate | null;
  spend: SpendDecision | null;
}

export interface GenerationModeResponse {
  mode: GenerationMode;
  assumedCompletionTokens: number;
  description: string;
}

export interface GenerationStatusResponse {
  preflight: GenerationPreflight;
  generation: GeneratedArticle | null;
}

export interface GenerationResponse {
  generation: GeneratedArticle;
  usage: TokenUsage | null;
  historyId: number;
}

export interface GenerationHistoryEntry {
  id: number;
  articleId: number | null;
  taskType: string | null;
  provider: string | null;
  providerType: string | null;
  model: string | null;
  status: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  createdAt: string;
}
