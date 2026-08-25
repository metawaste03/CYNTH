import { api } from '../../shared/services/apiClient';
import type { ModelPurpose, ModelInput, Provider, ProviderDetail, ProviderInput, ProviderModel } from '../../shared/types/aiProvider';

export interface ProviderMeta {
  providerTypes: readonly string[];
  purposes: readonly ModelPurpose[];
}

export function fetchProviderMeta(): Promise<ProviderMeta> {
  return api.get<ProviderMeta>('/ai-providers/meta');
}

export function fetchProviders(): Promise<Provider[]> {
  return api.get<{ providers: Provider[] }>('/ai-providers').then((r) => r.providers);
}

export function fetchProvider(id: number): Promise<ProviderDetail> {
  return api.get<{ provider: ProviderDetail }>(`/ai-providers/${id}`).then((r) => r.provider);
}

export function createProvider(input: ProviderInput): Promise<ProviderDetail> {
  return api.post<{ provider: ProviderDetail }>('/ai-providers', input).then((r) => r.provider);
}

export function updateProvider(id: number, input: ProviderInput): Promise<ProviderDetail> {
  return api.put<{ provider: ProviderDetail }>(`/ai-providers/${id}`, input).then((r) => r.provider);
}

export function setProviderStatus(id: number, isActive: boolean): Promise<ProviderDetail> {
  return api.patch<{ provider: ProviderDetail }>(`/ai-providers/${id}/status`, { isActive }).then((r) => r.provider);
}

export function setDefaultProvider(id: number): Promise<ProviderDetail> {
  return api.patch<{ provider: ProviderDetail }>(`/ai-providers/${id}/default`, {}).then((r) => r.provider);
}

export function deleteProvider(id: number): Promise<void> {
  return api.delete(`/ai-providers/${id}`);
}

export function testProviderConnection(id: number): Promise<{ message: string }> {
  return api.post<{ message: string }>(`/ai-providers/${id}/test-connection`, {});
}

export function addModel(providerId: number, input: ModelInput): Promise<ProviderModel> {
  return api.post<{ model: ProviderModel }>(`/ai-providers/${providerId}/models`, input).then((r) => r.model);
}

export function updateModel(providerId: number, modelId: number, input: ModelInput): Promise<ProviderModel> {
  return api.put<{ model: ProviderModel }>(`/ai-providers/${providerId}/models/${modelId}`, input).then((r) => r.model);
}

export function setModelStatus(providerId: number, modelId: number, isEnabled: boolean): Promise<ProviderModel> {
  return api
    .patch<{ model: ProviderModel }>(`/ai-providers/${providerId}/models/${modelId}/status`, { isEnabled })
    .then((r) => r.model);
}

export function setModelDefault(providerId: number, modelId: number): Promise<ProviderModel> {
  return api.patch<{ model: ProviderModel }>(`/ai-providers/${providerId}/models/${modelId}/default`, {}).then((r) => r.model);
}

export function deleteModel(providerId: number, modelId: number): Promise<void> {
  return api.delete(`/ai-providers/${providerId}/models/${modelId}`);
}
