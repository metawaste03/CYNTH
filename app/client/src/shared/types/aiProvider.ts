export type ModelPurpose =
  | 'article_generation'
  | 'seo_review'
  | 'quality_review'
  | 'title_generation'
  | 'keyword_expansion';

export interface ProviderModel {
  id: number;
  modelName: string;
  displayName: string | null;
  purpose: ModelPurpose | null;
  isEnabled: boolean;
  isDefaultForPurpose: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Provider {
  id: number;
  name: string;
  providerType: string;
  description: string | null;
  baseUrl: string | null;
  defaultModel: string | null;
  apiKeyEnvVar: string | null;
  hasApiKey: boolean;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  modelCount: number;
}

export interface ProviderDetail extends Provider {
  models: ProviderModel[];
}

export interface ProviderInput {
  name: string;
  providerType: string;
  description?: string;
  baseUrl?: string;
  defaultModel?: string;
  /** Omit to leave the stored key untouched; '' clears it; any other value sets/rotates it. */
  apiKey?: string;
}

export interface ModelInput {
  modelName: string;
  displayName?: string;
  purpose?: ModelPurpose | '';
  isEnabled: boolean;
}
