import { getDatabase } from '../../shared/database/index.js';
import type { AiProviderRow, AiProviderModelRow } from '../../shared/database/types.js';
import { hasSecret, getSecret, applySecretEdit, deleteSecret } from '../../shared/secrets/secretStore.js';
import type { ProviderInput, ModelInput } from './aiProviders.validation.js';
import type { ModelCapabilities, ProviderModelInfo } from '../generation/generation.types.js';
import { classifyModel } from '../generation/generationPolicy.service.js';
import type { ModelCostClass } from '../generation/generationPolicy.service.js';

export interface ProviderModelDto {
  id: number;
  modelName: string;
  displayName: string | null;
  purpose: string | null;
  isEnabled: boolean;
  isDefaultForPurpose: boolean;
  /**
   * Pricing per token, exactly as the provider published it at sync time.
   * Null means the catalogue has not been synced for this model — the cost
   * layer reports "unknown", and never treats unknown as free.
   */
  promptPrice: number | null;
  completionPrice: number | null;
  contextLength: number | null;
  /** True only when both prices are known and both are zero. */
  isFree: boolean | null;
  pricingSyncedAt: string | null;
  /**
   * Registry metadata, all of it published by the provider and refreshable
   * (Milestone 13). None of it is typed in by hand or inferred from a name.
   */
  vendor: string | null;
  /** A flat per-request charge. Non-zero means the model is not free whatever its per-token prices say. */
  requestPrice: number | null;
  catalogStatus: string | null;
  capabilities: ModelCapabilities | null;
  /** Whether the provider's catalogue still listed this model at the last refresh. Null = never refreshed. */
  inCatalog: boolean | null;
  /**
   * free / paid / unknown, derived from the stored pricing at read time so
   * every surface classifies identically. Never derived from the model name.
   */
  costClass: ModelCostClass;
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

/** A stored capability blob back into an object. A malformed blob must not break reading the model it belongs to. */
function parseCapabilities(raw: string | null): ModelCapabilities | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as ModelCapabilities) : null;
  } catch {
    return null;
  }
}

function mapModel(row: AiProviderModelRow): ProviderModelDto {
  return {
    id: row.id,
    modelName: row.model_name,
    displayName: row.display_name,
    purpose: row.purpose,
    isEnabled: row.is_enabled === 1,
    isDefaultForPurpose: row.is_default_for_purpose === 1,
    promptPrice: row.prompt_price,
    completionPrice: row.completion_price,
    contextLength: row.context_length,
    isFree: row.is_free === null ? null : row.is_free === 1,
    pricingSyncedAt: row.pricing_synced_at,
    vendor: row.vendor,
    requestPrice: row.request_price,
    catalogStatus: row.catalog_status,
    capabilities: parseCapabilities(row.capabilities),
    inCatalog: row.in_catalog === null ? null : row.in_catalog === 1,
    costClass: classifyModel({
      promptPrice: row.prompt_price,
      completionPrice: row.completion_price,
      requestPrice: row.request_price,
    }),
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
    hasApiKey: hasSecret(row.api_key_env_var),
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
 * database — see shared/secrets/secretStore.ts.
 */
export function getProviderApiKey(providerId: number): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT api_key_env_var FROM ai_providers WHERE id = ?').get(providerId) as unknown as
    | { api_key_env_var: string | null }
    | undefined;
  return getSecret(row?.api_key_env_var ?? null);
}

function applySecret(providerId: number, apiKey: string | undefined, existingEnvVar: string | null): string | null {
  return applySecretEdit(apiKey, existingEnvVar, () => `CYNTH_PROVIDER_${providerId}_API_KEY`);
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
  if (row.api_key_env_var) deleteSecret(row.api_key_env_var);
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

/* ------------------------------------------------- catalogue-backed models --- */

/**
 * The model ids already saved under a provider. Used by discovery to mark
 * which catalogue entries are in the registry, and by the add path to avoid
 * creating a second row for a model that is already there.
 */
export function listRegisteredModelNames(providerId: number): string[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT model_name FROM ai_provider_models WHERE provider_id = ?')
    .all(providerId) as unknown as { model_name: string }[];
  return rows.map((row) => row.model_name);
}

function rowsForModelName(providerId: number, modelName: string): AiProviderModelRow[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM ai_provider_models WHERE provider_id = ? AND model_name = ? ORDER BY id ASC')
    .all(providerId, modelName) as unknown as AiProviderModelRow[];
}

/**
 * Which existing registry row an "add from catalogue" should refresh, if any.
 *
 * The registry deliberately allows the SAME model to appear more than once
 * under one provider, assigned to different purposes — one Claude row for
 * Article Generation and another for SEO Review is a legitimate, already-used
 * configuration, not a duplicate. So identity here is (model, purpose), not
 * model alone.
 *
 * The rules, in order:
 *
 *   1. A row for this model AND this purpose already exists -> refresh it.
 *      Adding the same model for the same job twice is the duplicate this
 *      function exists to prevent.
 *   2. A purpose was supplied and the model is registered only under OTHER
 *      purposes -> null, so a new row is created. The user is registering
 *      the model for an additional job, which is a real thing to want.
 *   3. No purpose was supplied and the model is already registered -> refresh
 *      the first row. "Add" on a model already in the registry means "bring
 *      its pricing up to date", not "make another copy of it".
 */
function findRowToRefresh(
  providerId: number,
  modelName: string,
  purpose: string | null | undefined,
): AiProviderModelRow | null {
  const rows = rowsForModelName(providerId, modelName);
  if (rows.length === 0) return null;

  if (purpose === undefined || purpose === null) return rows[0];

  return rows.find((row) => row.purpose === purpose) ?? null;
}

/**
 * Provider-published metadata, in the one shape the registry writes.
 *
 * `isFree` is derived here rather than stored as an opinion: it is true only
 * when the classification says free, and the classification only ever reads
 * prices. A NULL price produces a NULL isFree — "unknown", never "free".
 */
function metadataColumnsFor(entry: ProviderModelInfo) {
  const costClass = classifyModel(entry);
  return {
    promptPrice: entry.promptPrice,
    completionPrice: entry.completionPrice,
    requestPrice: entry.requestPrice,
    contextLength: entry.contextLength,
    isFree: costClass === 'unknown' ? null : costClass === 'free' ? 1 : 0,
    vendor: entry.vendor,
    catalogStatus: entry.status,
    capabilities: Object.keys(entry.capabilities).length ? JSON.stringify(entry.capabilities) : null,
  };
}

export interface AddModelFromCatalogInput {
  /** The model id exactly as the provider's catalogue publishes it. */
  modelName: string;
  /** Optional override; defaults to the catalogue's own display name. */
  displayName?: string | null;
  purpose?: string | null;
  isEnabled?: boolean;
}

export interface AddModelFromCatalogResult {
  model: ProviderModelDto;
  /** False when the model was already registered and was refreshed instead of duplicated. */
  created: boolean;
}

/**
 * Saves a model from the provider's catalogue into Cynth's registry, with the
 * pricing and capability metadata the provider published for it.
 *
 * DUPLICATE PROTECTION: a model already registered for the same purpose is
 * refreshed in place rather than added a second time — see findRowToRefresh()
 * for the exact rule, and for why registering one model under two different
 * purposes is a legitimate configuration rather than a duplicate.
 *
 * When refreshing an existing entry, the user's own configuration — purpose,
 * enabled state and default-for-purpose — is left exactly as it was unless
 * this call explicitly supplies a new value.
 */
export function addModelFromCatalog(
  providerId: number,
  entry: ProviderModelInfo,
  input: AddModelFromCatalogInput,
): AddModelFromCatalogResult | null {
  const db = getDatabase();
  const provider = db.prepare('SELECT id FROM ai_providers WHERE id = ?').get(providerId);
  if (!provider) return null;

  const meta = metadataColumnsFor(entry);
  const existing = findRowToRefresh(providerId, input.modelName, input.purpose);

  if (existing) {
    db.prepare(`
      UPDATE ai_provider_models SET
        display_name = ?, purpose = ?, is_enabled = ?,
        prompt_price = ?, completion_price = ?, request_price = ?, context_length = ?,
        is_free = ?, vendor = ?, catalog_status = ?, capabilities = ?, in_catalog = 1,
        pricing_synced_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(
      input.displayName === undefined ? existing.display_name : input.displayName || entry.displayName,
      input.purpose === undefined ? existing.purpose : input.purpose,
      input.isEnabled === undefined ? existing.is_enabled : input.isEnabled ? 1 : 0,
      meta.promptPrice,
      meta.completionPrice,
      meta.requestPrice,
      meta.contextLength,
      meta.isFree,
      meta.vendor,
      meta.catalogStatus,
      meta.capabilities,
      existing.id,
    );

    const row = db
      .prepare('SELECT * FROM ai_provider_models WHERE id = ?')
      .get(existing.id) as unknown as AiProviderModelRow;
    return { model: mapModel(row), created: false };
  }

  const result = db
    .prepare(`
      INSERT INTO ai_provider_models (
        provider_id, model_name, display_name, purpose, is_enabled,
        prompt_price, completion_price, request_price, context_length, is_free,
        vendor, catalog_status, capabilities, in_catalog, pricing_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `)
    .run(
      providerId,
      input.modelName,
      input.displayName || entry.displayName,
      input.purpose ?? null,
      input.isEnabled === false ? 0 : 1,
      meta.promptPrice,
      meta.completionPrice,
      meta.requestPrice,
      meta.contextLength,
      meta.isFree,
      meta.vendor,
      meta.catalogStatus,
      meta.capabilities,
    );

  const row = db
    .prepare('SELECT * FROM ai_provider_models WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as unknown as AiProviderModelRow;
  return { model: mapModel(row), created: true };
}

export interface RefreshMetadataResult {
  updated: number;
  missingFromCatalog: string[];
}

/**
 * Re-applies provider-published metadata to every registered model.
 *
 * Only provider-owned columns are written. display_name, purpose, is_enabled
 * and is_default_for_purpose are the user's configuration and are never
 * touched here — a refresh that silently un-set someone's default model would
 * be a bug, not a feature.
 *
 * A registered model missing from today's catalogue keeps its last known
 * pricing and is flagged in_catalog = 0. Blanking its prices would turn
 * "we no longer know what this costs" into "this is free".
 */
export function refreshRegisteredModelMetadata(
  providerId: number,
  catalog: ProviderModelInfo[],
): RefreshMetadataResult {
  const db = getDatabase();
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));

  const registered = db
    .prepare('SELECT id, model_name FROM ai_provider_models WHERE provider_id = ?')
    .all(providerId) as unknown as { id: number; model_name: string }[];

  const update = db.prepare(`
    UPDATE ai_provider_models SET
      prompt_price = ?, completion_price = ?, request_price = ?, context_length = ?, is_free = ?,
      vendor = ?, catalog_status = ?, capabilities = ?, in_catalog = 1,
      pricing_synced_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `);
  const markMissing = db.prepare(
    `UPDATE ai_provider_models SET in_catalog = 0, updated_at = datetime('now') WHERE id = ?`,
  );

  let updated = 0;
  const missingFromCatalog: string[] = [];

  for (const model of registered) {
    const entry = byId.get(model.model_name);
    if (!entry) {
      missingFromCatalog.push(model.model_name);
      markMissing.run(model.id);
      continue;
    }

    const meta = metadataColumnsFor(entry);
    update.run(
      meta.promptPrice,
      meta.completionPrice,
      meta.requestPrice,
      meta.contextLength,
      meta.isFree,
      meta.vendor,
      meta.catalogStatus,
      meta.capabilities,
      model.id,
    );
    updated += 1;
  }

  return { updated, missingFromCatalog };
}

/* --------------------------------------------------------- model selection --- */

/**
 * One model the user may choose for a generation task, with everything the
 * choice depends on: which provider reaches it, what it costs, and whether it
 * can actually run right now.
 */
export interface SelectableModelDto {
  modelId: number;
  modelName: string;
  displayName: string | null;
  vendor: string | null;
  providerId: number;
  providerName: string;
  providerType: string;
  promptPrice: number | null;
  completionPrice: number | null;
  requestPrice: number | null;
  contextLength: number | null;
  costClass: ModelCostClass;
  purpose: string | null;
  isDefaultForPurpose: boolean;
  /** False when no credential is stored for the provider — the model is listed, but says why it cannot be used. */
  hasApiKey: boolean;
  pricingSyncedAt: string | null;
}

interface SelectableRow extends AiProviderModelRow {
  provider_name: string;
  provider_type: string;
  api_key_env_var: string | null;
}

/**
 * Every model that could serve a generation task: enabled, and belonging to
 * an active provider.
 *
 * Deliberately not filtered by purpose — a model saved for one task is still
 * a legitimate choice for another, and hiding it would force a trip through
 * settings to do something the user already asked for. The purpose default is
 * surfaced, not enforced.
 */
export function listSelectableModels(): SelectableModelDto[] {
  const db = getDatabase();
  const rows = db
    .prepare(`
      SELECT m.*, p.name AS provider_name, p.provider_type, p.api_key_env_var
      FROM ai_provider_models m
      JOIN ai_providers p ON p.id = m.provider_id
      WHERE m.is_enabled = 1 AND p.is_active = 1
      ORDER BY p.name ASC, m.model_name ASC
    `)
    .all() as unknown as SelectableRow[];

  return rows.map((row) => ({
    modelId: row.id,
    modelName: row.model_name,
    displayName: row.display_name,
    vendor: row.vendor,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerType: row.provider_type,
    promptPrice: row.prompt_price,
    completionPrice: row.completion_price,
    requestPrice: row.request_price,
    contextLength: row.context_length,
    costClass: classifyModel({
      promptPrice: row.prompt_price,
      completionPrice: row.completion_price,
      requestPrice: row.request_price,
    }),
    purpose: row.purpose,
    isDefaultForPurpose: row.is_default_for_purpose === 1,
    hasApiKey: hasSecret(row.api_key_env_var),
    pricingSyncedAt: row.pricing_synced_at,
  }));
}
