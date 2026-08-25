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

export interface GenerationPreflight {
  articleId: number;
  taskType: string;
  articleTypeName: string | null;
  authorName: string | null;
  productName: string | null;
  provider: { name: string; providerType: string; hasApiKey: boolean } | null;
  model: { modelName: string; displayName: string | null } | null;
  promptCharacterCount: number | null;
  promptWordCount: number | null;
  ready: boolean;
  issues: string[];
  configurationErrorCode: string | null;
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
