import { getDatabase } from '../../shared/database/index.js';
import { PIPELINE_MODES, PIPELINE_ROLES, ROLE_META } from './pipeline.constants.js';
import type { PipelineMode, PipelineRole } from './pipeline.constants.js';

/**
 * WHICH MODEL PLAYS WHICH ROLE.
 *
 * A role has one primary model and one optional fallback, per mode. The
 * separation between the two is not a ranking — it is a statement about WHEN
 * each is used:
 *
 *   primary   — always tried first.
 *   fallback  — used ONLY when the primary fails technically (transport,
 *               provider error, timeout). Never because a result was judged
 *               poor. An editorial failure produces a revision, not a
 *               different model.
 *
 * Development and Production hold separate assignments so the same pipeline
 * can be exercised on cheap models and run on premium ones without any change
 * to the workflow itself.
 */

export interface RoleModelDto {
  id: number;
  modelName: string;
  displayName: string | null;
  vendor: string | null;
  providerName: string;
  costTier: string;
  promptPrice: number | null;
  /** Carried so a model priced only for image output cannot read as free here. */
  imageOutputPrice: number | null;
  completionPrice: number | null;
  isFree: boolean | null;
  fallbackEligible: boolean;
  isEnabled: boolean;
}

export interface RoleAssignmentDto {
  role: PipelineRole;
  label: string;
  description: string;
  /** What the spec recommends for this role, shown so a choice can be judged. */
  costGuidance: string;
  mode: PipelineMode;
  primary: RoleModelDto | null;
  fallback: RoleModelDto | null;
  /** True when a primary is set and usable. */
  configured: boolean;
  issues: string[];
}

const MODEL_SELECT = `
  SELECT m.id, m.model_name, m.display_name, m.vendor, m.cost_tier, m.prompt_price, m.completion_price,
         m.is_free, m.fallback_eligible, m.is_enabled, p.name AS provider_name
  FROM ai_provider_models m
  JOIN ai_providers p ON p.id = m.provider_id
`;

function mapModel(row: any): RoleModelDto {
  return {
    id: row.id,
    modelName: row.model_name,
    displayName: row.display_name ?? null,
    vendor: row.vendor ?? null,
    providerName: row.provider_name,
    costTier: row.cost_tier ?? 'unknown',
    promptPrice: row.prompt_price ?? null,
    imageOutputPrice: row.image_output_price ?? null,
    completionPrice: row.completion_price ?? null,
    isFree: row.is_free === null || row.is_free === undefined ? null : row.is_free === 1,
    fallbackEligible: row.fallback_eligible === 1,
    isEnabled: row.is_enabled === 1,
  };
}

function getModel(id: number | null): RoleModelDto | null {
  if (id === null) return null;
  const db = getDatabase();
  const row = db.prepare(`${MODEL_SELECT} WHERE m.id = ?`).get(id);
  return row ? mapModel(row) : null;
}

/** Every model available to be assigned, for the role-assignment UI. */
export function listAssignableModels(): RoleModelDto[] {
  const db = getDatabase();
  const rows = db
    .prepare(`${MODEL_SELECT} WHERE m.is_enabled = 1 ORDER BY m.cost_tier, m.priority DESC, m.model_name`)
    .all() as any[];
  return rows.map(mapModel);
}

export function getRoleAssignment(role: PipelineRole, mode: PipelineMode): RoleAssignmentDto {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM pipeline_role_models WHERE role = ? AND mode = ?')
    .get(role, mode) as any | undefined;

  const primary = getModel(row?.primary_model_id ?? null);
  const fallback = getModel(row?.fallback_model_id ?? null);

  const issues: string[] = [];
  if (!primary) {
    issues.push(`No primary model is assigned to ${ROLE_META[role].label} in ${mode} mode.`);
  } else if (!primary.isEnabled) {
    issues.push(`The primary model for ${ROLE_META[role].label} is disabled.`);
  }
  // A fallback that is not eligible would be selected and then refused, so it
  // is reported here rather than at the moment of failure.
  if (fallback && !fallback.fallbackEligible) {
    issues.push(`${fallback.modelName} is assigned as a fallback but is not marked fallback-eligible.`);
  }
  if (fallback && primary && fallback.id === primary.id) {
    issues.push('The fallback is the same model as the primary, so it cannot help when that model fails.');
  }

  return {
    role,
    label: ROLE_META[role].label,
    description: ROLE_META[role].description,
    costGuidance: ROLE_META[role].costGuidance,
    mode,
    primary,
    fallback,
    configured: Boolean(primary?.isEnabled),
    issues,
  };
}

export function listRoleAssignments(mode: PipelineMode): RoleAssignmentDto[] {
  return PIPELINE_ROLES.map((role) => getRoleAssignment(role, mode));
}

export function setRoleAssignment(
  role: PipelineRole,
  mode: PipelineMode,
  input: { primaryModelId?: number | null; fallbackModelId?: number | null },
): RoleAssignmentDto | { error: string } {
  const db = getDatabase();

  const exists = (id: number) => Boolean(db.prepare('SELECT id FROM ai_provider_models WHERE id = ?').get(id));
  if (input.primaryModelId != null && !exists(input.primaryModelId)) return { error: 'Primary model not found.' };
  if (input.fallbackModelId != null && !exists(input.fallbackModelId)) return { error: 'Fallback model not found.' };

  if (
    input.primaryModelId != null &&
    input.fallbackModelId != null &&
    input.primaryModelId === input.fallbackModelId
  ) {
    return { error: 'The fallback must be a different model from the primary — otherwise it cannot help.' };
  }

  db.prepare(
    `INSERT INTO pipeline_role_models (role, mode, primary_model_id, fallback_model_id, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(role, mode) DO UPDATE SET
       primary_model_id = excluded.primary_model_id,
       fallback_model_id = excluded.fallback_model_id,
       updated_at = datetime('now')`,
  ).run(role, mode, input.primaryModelId ?? null, input.fallbackModelId ?? null);

  return getRoleAssignment(role, mode);
}

/**
 * Whether every role needed to run a pipeline has a usable primary.
 *
 * Answered before a run starts rather than discovered halfway through, so a
 * pipeline never stops after paying for two stages because the third was
 * unconfigured.
 */
export function validateRoleConfiguration(mode: PipelineMode): { ready: boolean; issues: string[] } {
  const issues = listRoleAssignments(mode).flatMap((assignment) => assignment.issues);
  return { ready: issues.length === 0, issues };
}

export function isValidMode(value: unknown): value is PipelineMode {
  return typeof value === 'string' && (PIPELINE_MODES as readonly string[]).includes(value);
}
