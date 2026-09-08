import { getDatabase } from '../../shared/database/index.js';
import type { AiProviderRow, AiProviderModelRow } from '../../shared/database/types.js';
import { hasSecret, getSecret, applySecretEdit, deleteSecret } from '../../shared/secrets/secretStore.js';
import type { ProviderInput, ModelInput } from './aiProviders.validation.js';
import type { ModelCapabilities, ProviderModelInfo } from '../generation/generation.types.js';
import { classifyModel } from '../generation/generationPolicy.service.js';
import type { ModelCostClass } from '../generation/generationPolicy.service.js';
import {
  capabilitiesByModel,
  listCapabilitiesForModel,
  setCapabilities,
  setDefaultForPurpose,
} from './modelCapabilities.repository.js';
import type { ModelCapabilityDto } from './modelCapabilities.repository.js';

/**
 * What Cynth knows about a model's configuration having actually been checked
 * (Milestone 15).
 *
 * `status` answers "did this configuration verify when it was saved?";
 * `lastTest` answers "what happened when someone last pressed Test Model?".
 * They are separate because a stale passing test must never be mistaken for a
 * fresh one, and a failed test must not silently rewrite what was verified at
 * save time.
 */
export interface ModelValidationDto {
  /** 'unvalidated' | 'valid' | 'invalid'. */
  status: string;
  code: string | null;
  message: string | null;
  validatedAt: string | null;
  lastTest: {
    /** 'passed' | 'failed'. */
    status: string;
    /** 'catalog' = metadata only and free; 'live' = a real minimal request was sent. */
    mode: string | null;
    message: string | null;
    testedAt: string | null;
  } | null;
}

export interface ProviderModelDto {
  id: number;
  modelName: string;
  displayName: string | null;
  /**
   * The jobs this model is registered to do. A model may hold several — the
   * best article writer is not automatically the best SEO reviewer, but one
   * model can legitimately be both.
   *
   * Named `assignedCapabilities` rather than `capabilities` because the
   * catalogue already publishes a field by that name, meaning something
   * entirely different: what the model can technically do (modalities,
   * tokenizer, output limits). This is what the USER assigned it to do.
   */
  assignedCapabilities: ModelCapabilityDto[];
  /** @deprecated Milestone 15 — read `assignedCapabilities`. Retained so an older client keeps rendering. */
  purpose: string | null;
  isEnabled: boolean;
  /** @deprecated Milestone 15 — the default flag is per capability. True when the model is default for any of them. */
  isDefaultForPurpose: boolean;
  /** Whether this model's configuration was ever verified against the provider, and what happened last. */
  validation: ModelValidationDto;
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
  /**
   * What image output costs, where the catalogue publishes it.
   *
   * Decisive for image models, which routinely publish zero per-token prices
   * and charge here instead — so this is what stops one being classified free.
   */
  imageOutputPrice: number | null;
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

/** The validation and last-test state, in the shape the UI reads it. Never contains a credential. */
function mapValidation(row: AiProviderModelRow): ModelValidationDto {
  return {
    status: row.validation_status ?? 'unvalidated',
    code: row.validation_code,
    message: row.validation_message,
    validatedAt: row.validated_at,
    lastTest: row.last_test_status
      ? {
          status: row.last_test_status,
          mode: row.last_test_mode,
          message: row.last_test_message,
          testedAt: row.last_tested_at,
        }
      : null,
  };
}

/**
 * @param capabilities pass the already-loaded set when mapping a list, so a
 * page of models costs one capability query rather than one per row.
 */
function mapModel(row: AiProviderModelRow, capabilities?: ModelCapabilityDto[]): ProviderModelDto {
  const held = capabilities ?? listCapabilitiesForModel(row.id);
  return {
    id: row.id,
    modelName: row.model_name,
    displayName: row.display_name,
    assignedCapabilities: held,
    // Kept populated from the capability set rather than from the deprecated
    // column, so an older client reading `purpose` still sees something true.
    purpose: held[0]?.purpose ?? null,
    isEnabled: row.is_enabled === 1,
    isDefaultForPurpose: held.some((capability) => capability.isDefaultForPurpose),
    validation: mapValidation(row),
    promptPrice: row.prompt_price,
    completionPrice: row.completion_price,
    contextLength: row.context_length,
    isFree: row.is_free === null ? null : row.is_free === 1,
    pricingSyncedAt: row.pricing_synced_at,
    vendor: row.vendor,
    requestPrice: row.request_price,
    imageOutputPrice: row.image_output_price,
    catalogStatus: row.catalog_status,
    capabilities: parseCapabilities(row.capabilities),
    inCatalog: row.in_catalog === null ? null : row.in_catalog === 1,
    costClass: classifyModel({
      promptPrice: row.prompt_price,
      completionPrice: row.completion_price,
      imageOutputPrice: row.image_output_price,
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
  const byModel = capabilitiesByModel(rows.map((row) => row.id));
  return rows.map((row) => mapModel(row, byModel.get(row.id) ?? []));
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

export function getModel(providerId: number, modelId: number): ProviderModelDto | null {
  const row = getDatabase()
    .prepare('SELECT * FROM ai_provider_models WHERE id = ? AND provider_id = ?')
    .get(modelId, providerId) as unknown as AiProviderModelRow | undefined;
  return row ? mapModel(row) : null;
}

export function addModel(providerId: number, input: ModelInput): ProviderModelDto | null {
  const db = getDatabase();
  const provider = db.prepare('SELECT id FROM ai_providers WHERE id = ?').get(providerId);
  if (!provider) return null;

  const result = db
    .prepare(`
      INSERT INTO ai_provider_models (provider_id, model_name, display_name, is_enabled, validation_status)
      VALUES (?, ?, ?, ?, 'unvalidated')
    `)
    .run(providerId, input.modelName, input.displayName, input.isEnabled ? 1 : 0);

  const modelId = Number(result.lastInsertRowid);
  setCapabilities(modelId, input.purposes);

  const row = db
    .prepare('SELECT * FROM ai_provider_models WHERE id = ?')
    .get(modelId) as unknown as AiProviderModelRow;
  return mapModel(row);
}

export function updateModel(providerId: number, modelId: number, input: ModelInput): ProviderModelDto | null {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT model_name FROM ai_provider_models WHERE id = ? AND provider_id = ?')
    .get(modelId, providerId) as unknown as { model_name: string } | undefined;
  if (!existing) return null;

  /**
   * Changing the model id invalidates what was verified: the stored
   * validation described the OLD model, and carrying it over would report a
   * model as checked when nothing had checked it. Editing the display name or
   * the capability set leaves the verification intact, because neither
   * changes what would be sent to the provider.
   */
  const modelChanged = existing.model_name !== input.modelName;

  db.prepare(`
    UPDATE ai_provider_models SET
      model_name = ?, display_name = ?, is_enabled = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(input.modelName, input.displayName, input.isEnabled ? 1 : 0, modelId);

  if (modelChanged) {
    db.prepare(`
      UPDATE ai_provider_models SET
        validation_status = 'unvalidated', validation_code = NULL, validation_message = NULL, validated_at = NULL,
        last_test_status = NULL, last_test_message = NULL, last_test_mode = NULL, last_tested_at = NULL
      WHERE id = ?
    `).run(modelId);
  }

  setCapabilities(modelId, input.purposes);

  const row = db.prepare('SELECT * FROM ai_provider_models WHERE id = ?').get(modelId) as unknown as AiProviderModelRow;
  return mapModel(row);
}

/* ------------------------------------------------------------- validation --- */

export interface ValidationStateInput {
  status: 'unvalidated' | 'valid' | 'invalid';
  code: string | null;
  message: string | null;
}

/**
 * Records what a validation attempt concluded.
 *
 * The message is whatever the validation layer produced for display — already
 * redacted and truncated by generation.errors.ts, which is the only place
 * provider wording is ever prepared for storage.
 */
export function recordValidationState(modelId: number, state: ValidationStateInput): ProviderModelDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`
      UPDATE ai_provider_models SET
        validation_status = ?, validation_code = ?, validation_message = ?,
        validated_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `)
    .run(state.status, state.code, state.message, modelId);
  if (result.changes === 0) return null;

  const row = db.prepare('SELECT * FROM ai_provider_models WHERE id = ?').get(modelId) as unknown as AiProviderModelRow;
  return mapModel(row);
}

export interface TestStateInput {
  status: 'passed' | 'failed';
  /** 'catalog' = metadata only and free; 'live' = a real minimal request was sent. */
  mode: 'catalog' | 'live';
  message: string;
}

/**
 * Records the outcome of an explicit Test Model run.
 *
 * A test also updates the saved validation state, because a test IS a
 * verification — but only the fields it actually established. A passing test
 * marks the model valid; a failing one marks it invalid with the reason,
 * which is the honest reading of "the provider just refused this".
 */
export function recordTestState(modelId: number, state: TestStateInput, code: string | null): ProviderModelDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`
      UPDATE ai_provider_models SET
        last_test_status = ?, last_test_mode = ?, last_test_message = ?, last_tested_at = datetime('now'),
        validation_status = ?, validation_code = ?, validation_message = ?, validated_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `)
    .run(
      state.status,
      state.mode,
      state.message,
      state.status === 'passed' ? 'valid' : 'invalid',
      state.status === 'passed' ? null : code,
      state.status === 'passed' ? null : state.message,
      modelId,
    );
  if (result.changes === 0) return null;

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

/**
 * Makes a model the system-wide default for ONE of its capabilities.
 *
 * The purpose is now required. Before Milestone 15 a row held a single
 * purpose, so "make this the default" was unambiguous; a model that can do
 * three jobs has three separate default questions, and guessing which one was
 * meant would silently reassign a default the user never touched.
 */
export function setModelDefaultForPurpose(
  providerId: number,
  modelId: number,
  purpose: string,
): SetDefaultModelResult {
  const db = getDatabase();
  const row = db
    .prepare('SELECT id FROM ai_provider_models WHERE id = ? AND provider_id = ?')
    .get(modelId, providerId);
  if (!row) return { errors: ['Model not found.'] };

  const result = setDefaultForPurpose(modelId, purpose);
  if (result.errors.length) return { errors: result.errors };

  db.prepare(`UPDATE ai_provider_models SET updated_at = datetime('now') WHERE id = ?`).run(modelId);

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

/**
 * Which existing registry row an "add from catalogue" should refresh, if any.
 *
 * Identity is (provider, model) — one row per model, full stop.
 *
 * Through Milestone 14 identity was (provider, model, purpose), because a row
 * could only hold one purpose and registering a model for a second job
 * genuinely needed a second row. Capabilities are a set now
 * (ai_model_capabilities), so that second row would be a plain duplicate: two
 * entries for the same model, priced and validated separately, both appearing
 * in every picker. Adding a model that is already registered therefore
 * refreshes it and adds the requested capability to the set it already holds.
 */
function findRowToRefresh(providerId: number, modelName: string): AiProviderModelRow | null {
  const row = getDatabase()
    .prepare('SELECT * FROM ai_provider_models WHERE provider_id = ? AND model_name = ? ORDER BY id ASC')
    .get(providerId, modelName) as unknown as AiProviderModelRow | undefined;
  return row ?? null;
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
    imageOutputPrice: entry.imageOutputPrice,
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
  /**
   * The jobs this model is being registered for. On a model already in the
   * registry these are ADDED to the capabilities it holds rather than
   * replacing them — "also use this for SEO Review" must not quietly stop it
   * being the article model.
   */
  purposes?: string[];
  isEnabled?: boolean;
  /** The validation result that permitted this save. Recorded so the registry says what was actually checked. */
  validation?: ValidationStateInput;
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
  const existing = findRowToRefresh(providerId, input.modelName);
  const validation = input.validation ?? { status: 'unvalidated' as const, code: null, message: null };

  if (existing) {
    db.prepare(`
      UPDATE ai_provider_models SET
        display_name = ?, is_enabled = ?,
        prompt_price = ?, completion_price = ?, request_price = ?, image_output_price = ?, context_length = ?,
        is_free = ?, vendor = ?, catalog_status = ?, capabilities = ?, in_catalog = 1,
        validation_status = ?, validation_code = ?, validation_message = ?, validated_at = datetime('now'),
        pricing_synced_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(
      input.displayName === undefined ? existing.display_name : input.displayName || entry.displayName,
      input.isEnabled === undefined ? existing.is_enabled : input.isEnabled ? 1 : 0,
      meta.promptPrice,
      meta.completionPrice,
      meta.requestPrice,
      meta.imageOutputPrice,
      meta.contextLength,
      meta.isFree,
      meta.vendor,
      meta.catalogStatus,
      meta.capabilities,
      validation.status,
      validation.code,
      validation.message,
      existing.id,
    );

    // ADD to what the model already does, never replace it.
    if (input.purposes?.length) {
      const held = listCapabilitiesForModel(existing.id).map((capability) => capability.purpose);
      setCapabilities(existing.id, [...held, ...input.purposes]);
    }

    const row = db
      .prepare('SELECT * FROM ai_provider_models WHERE id = ?')
      .get(existing.id) as unknown as AiProviderModelRow;
    return { model: mapModel(row), created: false };
  }

  const result = db
    .prepare(`
      INSERT INTO ai_provider_models (
        provider_id, model_name, display_name, is_enabled,
        prompt_price, completion_price, request_price, image_output_price, context_length, is_free,
        vendor, catalog_status, capabilities, in_catalog, pricing_synced_at,
        validation_status, validation_code, validation_message, validated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, datetime('now'))
    `)
    .run(
      providerId,
      input.modelName,
      input.displayName || entry.displayName,
      input.isEnabled === false ? 0 : 1,
      meta.promptPrice,
      meta.completionPrice,
      meta.requestPrice,
      meta.imageOutputPrice,
      meta.contextLength,
      meta.isFree,
      meta.vendor,
      meta.catalogStatus,
      meta.capabilities,
      validation.status,
      validation.code,
      validation.message,
    );

  const modelId = Number(result.lastInsertRowid);
  setCapabilities(modelId, input.purposes ?? []);

  const row = db
    .prepare('SELECT * FROM ai_provider_models WHERE id = ?')
    .get(modelId) as unknown as AiProviderModelRow;
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
  /** Every job this model is registered for. */
  assignedCapabilities: ModelCapabilityDto[];
  /** @deprecated Milestone 15 — read `assignedCapabilities`. */
  purpose: string | null;
  /**
   * True when this model is the system default for the purpose being listed.
   * Without a purpose filter, true when it is the default for any of them.
   */
  isDefaultForPurpose: boolean;
  /** False when no credential is stored for the provider — the model is listed, but says why it cannot be used. */
  hasApiKey: boolean;
  /** Whether the model's configuration has ever been verified against the provider. */
  validation: ModelValidationDto;
  pricingSyncedAt: string | null;
}

interface SelectableRow extends AiProviderModelRow {
  provider_name: string;
  provider_type: string;
  api_key_env_var: string | null;
}

/**
 * The models that may serve a task: enabled, belonging to an active provider,
 * and — when a purpose is given — registered for that purpose.
 *
 * PURPOSE FILTERING (Milestone 15). Passing a purpose returns only the models
 * assigned to it, which is what makes "which models can write an article?"
 * and "which models can review SEO?" different questions with different
 * answers. The New Article workflow asks for article_generation; the SEO
 * workflow asks for seo_review; neither is offered the other's models.
 *
 * Omitting the purpose still returns everything, for the registry screens
 * whose job is to show the whole registry.
 */
export function listSelectableModels(purpose?: string | null): SelectableModelDto[] {
  const db = getDatabase();
  const rows = purpose
    ? (db
        .prepare(`
          SELECT m.*, p.name AS provider_name, p.provider_type, p.api_key_env_var
          FROM ai_provider_models m
          JOIN ai_providers p ON p.id = m.provider_id
          JOIN ai_model_capabilities c ON c.model_id = m.id
          WHERE m.is_enabled = 1 AND p.is_active = 1 AND c.purpose = ?
          ORDER BY p.name ASC, m.model_name ASC
        `)
        .all(purpose) as unknown as SelectableRow[])
    : (db
        .prepare(`
          SELECT m.*, p.name AS provider_name, p.provider_type, p.api_key_env_var
          FROM ai_provider_models m
          JOIN ai_providers p ON p.id = m.provider_id
          WHERE m.is_enabled = 1 AND p.is_active = 1
          ORDER BY p.name ASC, m.model_name ASC
        `)
        .all() as unknown as SelectableRow[]);

  const byModel = capabilitiesByModel(rows.map((row) => row.id));

  return rows.map((row) => {
    const held = byModel.get(row.id) ?? [];
    return {
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
      imageOutputPrice: row.image_output_price,
      contextLength: row.context_length,
      costClass: classifyModel({
        promptPrice: row.prompt_price,
        completionPrice: row.completion_price,
        requestPrice: row.request_price,
        imageOutputPrice: row.image_output_price,
      }),
      assignedCapabilities: held,
      purpose: held[0]?.purpose ?? null,
      isDefaultForPurpose: purpose
        ? held.some((capability) => capability.purpose === purpose && capability.isDefaultForPurpose)
        : held.some((capability) => capability.isDefaultForPurpose),
      hasApiKey: hasSecret(row.api_key_env_var),
      validation: mapValidation(row),
      pricingSyncedAt: row.pricing_synced_at,
    };
  });
}
