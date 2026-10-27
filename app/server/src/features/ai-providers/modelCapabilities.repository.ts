import { getDatabase } from '../../shared/database/index.js';
import type { AiModelCapabilityRow } from '../../shared/database/types.js';
import { isValidPurpose } from './aiProviders.constants.js';

/**
 * MODEL CAPABILITIES (Milestone 15).
 *
 * A registered model holds a SET of capabilities — Article Generation, SEO
 * Review, Research, and whatever is added later — rather than the single
 * `purpose` column it carried through Milestone 14.
 *
 * That column forced a real problem: registering one model for two jobs meant
 * registering it twice, as two independent rows that each had to be priced,
 * enabled and validated separately, and that appeared as two entries in every
 * picker. The set lives here instead, so the registry holds one row per
 * (provider, model).
 *
 * This file is the only place that writes the capability set, so the two
 * invariants it maintains cannot be bypassed:
 *
 *   1. A capability is one of the built-in purposes. An unknown string is
 *      refused rather than stored, because a capability nothing can route to
 *      is worse than none.
 *   2. At most one default per purpose SYSTEM-WIDE — the same rule the old
 *      column enforced, now scoped per capability rather than per row, so
 *      "default article model" and "default SEO model" are genuinely
 *      independent choices and one model can hold both.
 */

export interface ModelCapabilityDto {
  purpose: string;
  isDefaultForPurpose: boolean;
}

function mapCapability(row: AiModelCapabilityRow): ModelCapabilityDto {
  return { purpose: row.purpose, isDefaultForPurpose: row.is_default_for_purpose === 1 };
}

export function listCapabilitiesForModel(modelId: number): ModelCapabilityDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM ai_model_capabilities WHERE model_id = ? ORDER BY purpose ASC')
    .all(modelId) as unknown as AiModelCapabilityRow[];
  return rows.map(mapCapability);
}

/**
 * Every capability for a set of models at once.
 *
 * Listing a provider's models would otherwise issue one query per model; this
 * keeps the list endpoints to two queries however many models are registered.
 */
export function capabilitiesByModel(modelIds: number[]): Map<number, ModelCapabilityDto[]> {
  const byModel = new Map<number, ModelCapabilityDto[]>();
  if (modelIds.length === 0) return byModel;

  const db = getDatabase();
  const placeholders = modelIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT * FROM ai_model_capabilities WHERE model_id IN (${placeholders}) ORDER BY purpose ASC`,
    )
    .all(...modelIds) as unknown as AiModelCapabilityRow[];

  for (const row of rows) {
    const existing = byModel.get(row.model_id);
    if (existing) existing.push(mapCapability(row));
    else byModel.set(row.model_id, [mapCapability(row)]);
  }
  return byModel;
}

export interface SetCapabilitiesResult {
  errors: string[];
  capabilities: ModelCapabilityDto[];
}

/**
 * Replaces a model's capability set with exactly the purposes given.
 *
 * Removing a capability that was the system default for its purpose leaves
 * that purpose with NO default rather than promoting some other model into
 * the role. Cynth does not choose a model on a user's behalf — an unset
 * default is reported as unset, and the New Article workflow says so.
 *
 * An empty list is allowed and means "registered, but not assigned to any
 * job": a legitimate state for a model someone is evaluating.
 */
export function setCapabilities(modelId: number, purposes: readonly string[]): SetCapabilitiesResult {
  const db = getDatabase();

  const unique = [...new Set(purposes.map((purpose) => purpose.trim()).filter(Boolean))];
  const unknown = unique.filter((purpose) => !isValidPurpose(purpose));
  if (unknown.length) {
    return {
      errors: [`Unknown capability: ${unknown.join(', ')}.`],
      capabilities: listCapabilitiesForModel(modelId),
    };
  }

  // The existing defaults are read first so that re-saving an unchanged set
  // does not silently clear the model's own default flags.
  const existing = new Map(
    listCapabilitiesForModel(modelId).map((capability) => [capability.purpose, capability.isDefaultForPurpose]),
  );

  db.prepare('DELETE FROM ai_model_capabilities WHERE model_id = ?').run(modelId);

  const insert = db.prepare(
    'INSERT INTO ai_model_capabilities (model_id, purpose, is_default_for_purpose) VALUES (?, ?, ?)',
  );
  for (const purpose of unique) {
    insert.run(modelId, purpose, existing.get(purpose) ? 1 : 0);
  }

  return { errors: [], capabilities: listCapabilitiesForModel(modelId) };
}

/** Adds one capability without disturbing the rest of the set. Re-adding an existing one is a no-op. */
export function addCapability(modelId: number, purpose: string): SetCapabilitiesResult {
  if (!isValidPurpose(purpose)) {
    return { errors: [`Unknown capability: ${purpose}.`], capabilities: listCapabilitiesForModel(modelId) };
  }
  const db = getDatabase();
  db.prepare(
    'INSERT OR IGNORE INTO ai_model_capabilities (model_id, purpose, is_default_for_purpose) VALUES (?, ?, 0)',
  ).run(modelId, purpose);
  return { errors: [], capabilities: listCapabilitiesForModel(modelId) };
}

export function removeCapability(modelId: number, purpose: string): ModelCapabilityDto[] {
  const db = getDatabase();
  db.prepare('DELETE FROM ai_model_capabilities WHERE model_id = ? AND purpose = ?').run(modelId, purpose);
  return listCapabilitiesForModel(modelId);
}

/**
 * Makes this model the system default for one of its capabilities.
 *
 * Refuses if the model does not hold the capability: making a model the
 * default for a job it is not registered to do would create a default that
 * the purpose filter itself would then hide.
 */
export function setDefaultForPurpose(modelId: number, purpose: string): SetCapabilitiesResult {
  const db = getDatabase();

  if (!isValidPurpose(purpose)) {
    return { errors: [`Unknown capability: ${purpose}.`], capabilities: listCapabilitiesForModel(modelId) };
  }

  const holds = db
    .prepare('SELECT id FROM ai_model_capabilities WHERE model_id = ? AND purpose = ?')
    .get(modelId, purpose);
  if (!holds) {
    return {
      errors: [`This model is not assigned to ${purpose}, so it cannot be the default for it.`],
      capabilities: listCapabilitiesForModel(modelId),
    };
  }

  // Unset-others-then-set, the same pattern product_images.is_primary uses.
  db.prepare('UPDATE ai_model_capabilities SET is_default_for_purpose = 0 WHERE purpose = ?').run(purpose);
  db.prepare(
    'UPDATE ai_model_capabilities SET is_default_for_purpose = 1 WHERE model_id = ? AND purpose = ?',
  ).run(modelId, purpose);

  return { errors: [], capabilities: listCapabilitiesForModel(modelId) };
}

/**
 * The registry row id that is the system default for a purpose, if any.
 *
 * Returns the id only — the caller resolves the provider, so this file never
 * grows a second copy of the routing rules.
 */
export function defaultModelIdForPurpose(purpose: string): number | null {
  const row = getDatabase()
    .prepare('SELECT model_id FROM ai_model_capabilities WHERE purpose = ? AND is_default_for_purpose = 1')
    .get(purpose) as unknown as { model_id: number } | undefined;
  return row?.model_id ?? null;
}
