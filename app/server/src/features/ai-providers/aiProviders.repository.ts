import { getDatabase } from '../../shared/database/index.js';
import type { AiProviderRow, AiProviderModelRow } from '../../shared/database/types.js';
import { hasProviderSecret, setProviderSecret, deleteProviderSecret } from '../../shared/secrets/providerSecrets.js';
import type { ProviderInput, ModelInput } from './aiProviders.validation.js';

export interface ProviderModelDto {
  id: number;
  modelName: string;
  displayName: string | null;
  purpose: string | null;
  isEnabled: boolean;
  isDefaultForPurpose: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderDto {
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

export interface ProviderDetailDto extends ProviderDto {
  models: ProviderModelDto[];
}

function mapModel(row: AiProviderModelRow): ProviderModelDto {
  return {
    id: row.id,
    modelName: row.model_name,
    displayName: row.display_name,
    purpose: row.purpose,
    isEnabled: row.is_enabled === 1,
    isDefaultForPurpose: row.is_default_for_purpose === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProvider(row: AiProviderRow, modelCount: number): ProviderDto {
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    description: row.description,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    // The env var *name* is safe to expose (it's not a secret); the value never leaves the server.
    apiKeyEnvVar: row.api_key_env_var,
    hasApiKey: hasProviderSecret(row.api_key_env_var),
    isActive: row.is_active === 1,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    modelCount,
  };
}

function getModelsForProvider(providerId: number): ProviderModelDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM ai_provider_models WHERE provider_id = ? ORDER BY id ASC')
    .all(providerId) as unknown as AiProviderModelRow[];
  return rows.map(mapModel);
}

export function listProviders(): ProviderDto[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM ai_providers ORDER BY name ASC').all() as unknown as AiProviderRow[];
  const counts = db
    .prepare('SELECT provider_id, COUNT(*) AS count FROM ai_provider_models GROUP BY provider_id')
    .all() as unknown as { provider_id: number; count: number }[];
  const countByProvider = new Map(counts.map((c) => [c.provider_id, c.count]));
  return rows.map((row) => mapProvider(row, countByProvider.get(row.id) ?? 0));
}

export function getProviderById(id: number): ProviderDetailDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as unknown as AiProviderRow | undefined;
  if (!row) return null;
  const models = getModelsForProvider(id);
  return { ...mapProvider(row, models.length), models };
}

/**
 * Server-side only: the actual API key value for a provider, read from
 * process.env via the env var name stored on the record.
 *
 * This is the one function in Cynth that returns a key, and it exists solely
 * so a provider adapter can authenticate its own request (Milestone 9). The
 * value must never reach a DTO, a route response, a log line, or the
 * database — see shared/secrets/providerSecrets.ts.
 */
export function getProviderApiKey(providerId: number): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT api_key_env_var FROM ai_providers WHERE id = ?').get(providerId) as unknown as
    | { api_key_env_var: string | null }
    | undefined;
  if (!row?.api_key_env_var) return null;
  return process.env[row.api_key_env_var] || null;
}

function applySecret(providerId: number, apiKey: string | undefined, existingEnvVar: string | null): string | null {
  if (apiKey === undefined) return existingEnvVar; // no change
  if (apiKey === '') {
    if (existingEnvVar) deleteProviderSecret(existingEnvVar);
    return null;
  }
  const envVar = existingEnvVar ?? `CYNTH_PROVIDER_${providerId}_API_KEY`;
  setProviderSecret(envVar, apiKey);
  return envVar;
}

export function createProvider(input: ProviderInput): ProviderDetailDto {
  const db = getDatabase();
  const result = db
    .prepare(`
      INSERT INTO ai_providers (name, provider_type, description, base_url, default_model, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `)
    .run(input.name, input.providerType, input.description, input.baseUrl, input.defaultModel);

  const providerId = Number(result.lastInsertRowid);
  const envVar = applySecret(providerId, input.apiKey, null);
  if (envVar) {
    db.prepare('UPDATE ai_providers SET api_key_env_var = ? WHERE id = ?').run(envVar, providerId);
  }

  return getProviderById(providerId)!;
}

export function updateProvider(id: number, input: ProviderInput): ProviderDetailDto | null {
  const db = getDatabase();
  const existing = db.prepare('SELECT api_key_env_var FROM ai_providers WHERE id = ?').get(id) as unknown as
    | { api_key_env_var: string | null }
    | undefined;
  if (!existing) return null;

  const envVar = applySecret(id, input.apiKey, existing.api_key_env_var);

  db.prepare(`
    UPDATE ai_providers SET
      name = ?, provider_type = ?, description = ?, base_url = ?, default_model = ?,
      api_key_env_var = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(input.name, input.providerType, input.description, input.baseUrl, input.defaultModel, envVar, id);

  return getProviderById(id);
}

export function setProviderActiveStatus(id: number, isActive: boolean): ProviderDetailDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`UPDATE ai_providers SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(isActive ? 1 : 0, id);
  if (result.changes === 0) return null;
  return getProviderById(id);
}

/** Only one default provider system-wide — unset any other before setting this one. */
export function setDefaultProvider(id: number): ProviderDetailDto | null {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM ai_providers WHERE id = ?').get(id);
  if (!existing) return null;

  db.prepare('UPDATE ai_providers SET is_default = 0').run();
  db.prepare(`UPDATE ai_providers SET is_default = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  return getProviderById(id);
}

export function deleteProvider(id: number): boolean {
  const db = getDatabase();
  const row = db.prepare('SELECT api_key_env_var FROM ai_providers WHERE id = ?').get(id) as unknown as
    | { api_key_env_var: string | null }
    | undefined;
  if (!row) return false;

  db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id); // cascades ai_provider_models
  if (row.api_key_env_var) deleteProviderSecret(row.api_key_env_var);
  return true;
}

export function addModel(providerId: number, input: ModelInput): ProviderModelDto | null {
  const db = getDatabase();
  const provider = db.prepare('SELECT id FROM ai_providers WHERE id = ?').get(providerId);
  if (!provider) return null;

  const result = db
    .prepare(`
      INSERT INTO ai_provider_models (provider_id, model_name, display_name, purpose, is_enabled)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(providerId, input.modelName, input.displayName, input.purpose, input.isEnabled ? 1 : 0);

  const row = db
    .prepare('SELECT * FROM ai_provider_models WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as unknown as AiProviderModelRow;
  return mapModel(row);
}

export function updateModel(providerId: number, modelId: number, input: ModelInput): ProviderModelDto | null {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM ai_provider_models WHERE id = ? AND provider_id = ?')
    .get(modelId, providerId);
  if (!existing) return null;

  db.prepare(`
    UPDATE ai_provider_models SET
      model_name = ?, display_name = ?, purpose = ?, is_enabled = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(input.modelName, input.displayName, input.purpose, input.isEnabled ? 1 : 0, modelId);

  const row = db.prepare('SELECT * FROM ai_provider_models WHERE id = ?').get(modelId) as unknown as AiProviderModelRow;
  return mapModel(row);
}

export function setModelEnabled(providerId: number, modelId: number, isEnabled: boolean): ProviderModelDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`UPDATE ai_provider_models SET is_enabled = ?, updated_at = datetime('now') WHERE id = ? AND provider_id = ?`)
    .run(isEnabled ? 1 : 0, modelId, providerId);
  if (result.changes === 0) return null;
  const row = db.prepare('SELECT * FROM ai_provider_models WHERE id = ?').get(modelId) as unknown as AiProviderModelRow;
  return mapModel(row);
}

export interface SetDefaultModelResult {
  errors: string[];
  model?: ProviderModelDto;
}

/** Only one default model per purpose, system-wide across all providers. */
export function setModelDefaultForPurpose(providerId: number, modelId: number): SetDefaultModelResult {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM ai_provider_models WHERE id = ? AND provider_id = ?')
    .get(modelId, providerId) as unknown as AiProviderModelRow | undefined;
  if (!row) return { errors: ['Model not found.'] };
  if (!row.purpose) return { errors: ['This model has no purpose set — assign one before making it the default.'] };

  db.prepare('UPDATE ai_provider_models SET is_default_for_purpose = 0 WHERE purpose = ?').run(row.purpose);
  db.prepare(`UPDATE ai_provider_models SET is_default_for_purpose = 1, updated_at = datetime('now') WHERE id = ?`).run(modelId);

  const updated = db.prepare('SELECT * FROM ai_provider_models WHERE id = ?').get(modelId) as unknown as AiProviderModelRow;
  return { errors: [], model: mapModel(updated) };
}

export function deleteModel(providerId: number, modelId: number): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM ai_provider_models WHERE id = ? AND provider_id = ?').run(modelId, providerId);
  return result.changes > 0;
}
