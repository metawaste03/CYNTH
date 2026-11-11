import { getDatabase } from '../../shared/database/index.js';
import { setRoleAssignment } from './roleRegistry.repository.js';
import type { PipelineRole } from './pipeline.constants.js';

/**
 * THE INITIAL PRODUCTION CONFIGURATION.
 *
 * Defaults, not permanent dependencies. Every assignment below is editable,
 * and nothing downstream reads a model name — the pipeline resolves roles
 * through the registry, so changing an assignment changes what runs without
 * touching code.
 *
 * The allocation principle is deliberate: premium intelligence is concentrated
 * on the two stages that most affect the finished article (topic research and
 * writing), a strong independent model reviews, and the narrow structured task
 * — keywords and titles, performed on a stronger model's output — runs on a
 * model roughly 170x cheaper. Spending flagship money on keyword extraction
 * buys almost nothing.
 */

/** Prices are per token, as OpenRouter publishes them; the /M figures in the comments are per million. */
interface ModelSeed {
  modelName: string;
  displayName: string;
  description: string;
  vendor: string;
  promptPrice: number;
  completionPrice: number;
  contextLength: number;
  costTier: 'free' | 'low' | 'standard' | 'premium';
  supportsStructuredOutput: boolean;
  supportsTools: boolean;
}

/**
 * Verified present in the OpenRouter catalogue before being written here.
 *
 * Two substitutions were made against the originally specified models, both
 * because the newer model is better on every axis that matters:
 *
 *   claude-opus-4.8 -> claude-opus-5      same price ($5/$25 per M), newer.
 *   gpt-5.5         -> gpt-5.6-sol-pro    cheaper ($2/$10 vs $5/$30), newer.
 */
const MODEL_SEEDS: ModelSeed[] = [
  {
    modelName: 'anthropic/claude-opus-5',
    displayName: 'Claude Opus 5',
    description: 'Frontier reasoning and long-form writing. Used where article quality depends most on the model.',
    vendor: 'anthropic',
    promptPrice: 0.000005, // $5.00/M
    completionPrice: 0.000025, // $25.00/M
    contextLength: 1_000_000,
    costTier: 'premium',
    supportsStructuredOutput: true,
    supportsTools: true,
  },
  {
    modelName: 'openai/gpt-5.6-sol-pro',
    displayName: 'GPT-5.6 Sol Pro',
    description: 'Strong independent reasoning from a different model family, for review and revision.',
    vendor: 'openai',
    promptPrice: 0.000002, // $2.00/M
    completionPrice: 0.00001, // $10.00/M
    contextLength: 1_050_000,
    costTier: 'standard',
    supportsStructuredOutput: true,
    supportsTools: true,
  },
  {
    modelName: 'google/gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro Preview',
    description: 'A third model family, held as the reviewer fallback.',
    vendor: 'google',
    promptPrice: 0.000002, // $2.00/M
    completionPrice: 0.000012, // $12.00/M
    contextLength: 1_048_576,
    costTier: 'standard',
    supportsStructuredOutput: true,
    supportsTools: true,
  },
  {
    modelName: 'qwen/qwen3.7-flash',
    displayName: 'Qwen 3.7 Flash',
    description:
      'Fast, very low cost, reliable at structured JSON. Runs the narrow keyword and title task on the topic research model\'s output.',
    vendor: 'qwen',
    promptPrice: 0.00000003, // $0.03/M
    completionPrice: 0.00000013, // $0.13/M
    contextLength: 1_000_000,
    costTier: 'low',
    supportsStructuredOutput: true,
    supportsTools: true,
  },
  {
    modelName: 'openai/gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    description: 'Low-cost with more headroom than a flash model. Fallback for the keyword and title stage.',
    vendor: 'openai',
    promptPrice: 0.0000002, // $0.20/M
    completionPrice: 0.0000012, // $1.20/M
    contextLength: 1_050_000,
    costTier: 'low',
    supportsStructuredOutput: true,
    supportsTools: true,
  },
];

/**
 * Role assignments for Production.
 *
 * The reviewer is deliberately a different model family from the writer: a
 * model reviewing its own house style tends to agree with it.
 */
const PRODUCTION_ROLES: Record<PipelineRole, { primary: string; fallback: string | null }> = {
  topic_research: { primary: 'anthropic/claude-opus-5', fallback: 'openai/gpt-5.6-sol-pro' },
  keyword_research: { primary: 'qwen/qwen3.7-flash', fallback: 'openai/gpt-5.6-luna' },
  title_selection: { primary: 'qwen/qwen3.7-flash', fallback: 'openai/gpt-5.6-luna' },
  article_writer: { primary: 'anthropic/claude-opus-5', fallback: 'openai/gpt-5.6-sol-pro' },
  article_reviewer: { primary: 'openai/gpt-5.6-sol-pro', fallback: 'google/gemini-3.1-pro-preview' },
  // Revision applies the reviewer's own specification, so it reads best from
  // the same family that wrote the specification.
  article_revision: { primary: 'openai/gpt-5.6-sol-pro', fallback: 'anthropic/claude-opus-5' },
};

export interface SeedResult {
  modelsAdded: number;
  modelsExisting: number;
  rolesAssigned: number;
  /** Roles that could not be assigned, and why. Reported rather than silently skipped. */
  issues: string[];
}

/**
 * Registers the default models on an OpenRouter provider and assigns the
 * production roles.
 *
 * Idempotent: a model already registered keeps whatever the user has since
 * changed about it, and an existing role assignment is only overwritten when
 * `overwriteRoles` is set — so this can be re-run to add a missing model
 * without silently undoing a deliberate reassignment.
 */
export function seedRoleDefaults(options: { overwriteRoles?: boolean } = {}): SeedResult {
  const db = getDatabase();
  const issues: string[] = [];

  const provider = db
    .prepare("SELECT id FROM ai_providers WHERE provider_type = 'openrouter' AND is_active = 1 ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;

  if (!provider) {
    return {
      modelsAdded: 0,
      modelsExisting: 0,
      rolesAssigned: 0,
      issues: ['No active OpenRouter provider is configured. Add one under Settings → AI Providers first.'],
    };
  }

  let modelsAdded = 0;
  let modelsExisting = 0;
  const modelIdByName = new Map<string, number>();

  for (const seed of MODEL_SEEDS) {
    const existing = db
      .prepare('SELECT id FROM ai_provider_models WHERE provider_id = ? AND model_name = ?')
      .get(provider.id, seed.modelName) as { id: number } | undefined;

    if (existing) {
      modelIdByName.set(seed.modelName, existing.id);
      modelsExisting += 1;
      continue;
    }

    const result = db
      .prepare(
        `INSERT INTO ai_provider_models
           (provider_id, model_name, display_name, description, vendor, is_enabled,
            prompt_price, completion_price, is_free, context_length, cost_tier,
            fallback_eligible, supports_structured_output, supports_tools, pricing_synced_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?, 1, ?, ?, datetime('now'))`,
      )
      .run(
        provider.id,
        seed.modelName,
        seed.displayName,
        seed.description,
        seed.vendor,
        seed.promptPrice,
        seed.completionPrice,
        seed.contextLength,
        seed.costTier,
        seed.supportsStructuredOutput ? 1 : 0,
        seed.supportsTools ? 1 : 0,
      );

    modelIdByName.set(seed.modelName, Number(result.lastInsertRowid));
    modelsAdded += 1;
  }

  let rolesAssigned = 0;
  for (const [role, assignment] of Object.entries(PRODUCTION_ROLES) as [
    PipelineRole,
    { primary: string; fallback: string | null },
  ][]) {
    const existing = db
      .prepare("SELECT primary_model_id FROM pipeline_role_models WHERE role = ? AND mode = 'production'")
      .get(role) as { primary_model_id: number | null } | undefined;

    if (existing?.primary_model_id && !options.overwriteRoles) continue;

    const primaryId = modelIdByName.get(assignment.primary);
    if (!primaryId) {
      issues.push(`${role}: ${assignment.primary} is not registered.`);
      continue;
    }

    const result = setRoleAssignment(role, 'production', {
      primaryModelId: primaryId,
      fallbackModelId: assignment.fallback ? modelIdByName.get(assignment.fallback) ?? null : null,
    });

    if ('error' in result) issues.push(`${role}: ${result.error}`);
    else rolesAssigned += 1;
  }

  return { modelsAdded, modelsExisting, rolesAssigned, issues };
}

/**
 * Development assignments: every role on whichever free model is registered.
 *
 * The point of Development mode is that the pipeline is identical and only the
 * models differ, so this deliberately does not simplify the workflow — it just
 * makes exercising it cost nothing. Does nothing when no free model exists,
 * rather than quietly assigning a paid one.
 */
export function seedDevelopmentRoles(): SeedResult {
  const db = getDatabase();
  const free = db
    .prepare('SELECT id, model_name FROM ai_provider_models WHERE is_free = 1 AND is_enabled = 1 ORDER BY id LIMIT 1')
    .get() as { id: number; model_name: string } | undefined;

  if (!free) {
    return {
      modelsAdded: 0,
      modelsExisting: 0,
      rolesAssigned: 0,
      issues: ['No free model is registered, so Development mode cannot be configured without spending money.'],
    };
  }

  let rolesAssigned = 0;
  for (const role of Object.keys(PRODUCTION_ROLES) as PipelineRole[]) {
    const result = setRoleAssignment(role, 'development', { primaryModelId: free.id, fallbackModelId: null });
    if (!('error' in result)) rolesAssigned += 1;
  }

  return { modelsAdded: 0, modelsExisting: 0, rolesAssigned, issues: [] };
}
