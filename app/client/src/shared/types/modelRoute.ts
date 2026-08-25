export interface RoutedProvider {
  id: number;
  name: string;
  providerType: string;
  baseUrl: string | null;
  hasApiKey: boolean;
}

export interface RoutedModel {
  id: number;
  modelName: string;
  displayName: string | null;
}

export interface ModelRouteResult {
  purpose: string;
  configured: boolean;
  provider: RoutedProvider | null;
  model: RoutedModel | null;
  reason?: string;
}
