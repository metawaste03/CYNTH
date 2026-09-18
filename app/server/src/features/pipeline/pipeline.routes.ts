import { Router } from 'express';
import { isGenerationError } from '../generation/generation.errors.js';
import {
  advancePipeline,
  changeRunMode,
  decide,
  getPipelineOutputs,
  getPipelineStatus,
  listResumableRuns,
  rerunForCheckpoint,
  resumeAfterFailure,
  startArticlePipeline,
  statusForArticle,
} from './pipeline.orchestrator.js';
import { getPipelineById, startNewVersion } from './pipeline.repository.js';
import { listAssignableModels, listRoleAssignments, setRoleAssignment, validateRoleConfiguration } from './roleRegistry.repository.js';
import { CHECKPOINT_KINDS, isValidRole, PIPELINE_MODES, PIPELINE_RUN_MODES, ROLE_META, TOPIC_MODES } from './pipeline.constants.js';
import type { CheckpointKind, PipelineMode, PipelineRunMode, TopicMode } from './pipeline.constants.js';
import { seedDevelopmentRoles, seedRoleDefaults } from './roleDefaults.service.js';

/**
 * The pipeline HTTP surface.
 *
 * `POST /` creates a draft and starts a run; `POST /:id/advance` drives it
 * forward and is safe to call repeatedly — completed stages return their
 * stored result rather than re-running. The client polls `GET /:id` for
 * progress.
 */
export const pipelineRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readMode(raw: unknown): PipelineMode {
  return (PIPELINE_MODES as readonly string[]).includes(raw as string) ? (raw as PipelineMode) : 'production';
}

/**
 * How the run is driven.
 *
 * Defaults to 'automatic' because that is what every run did before guided
 * mode existed, and a default that silently starts pausing for input would
 * strand any caller that has not been taught to answer.
 */
function readRunMode(raw: unknown): PipelineRunMode {
  return (PIPELINE_RUN_MODES as readonly string[]).includes(raw as string) ? (raw as PipelineRunMode) : 'automatic';
}

function readCheckpointKind(raw: string): CheckpointKind | null {
  return (CHECKPOINT_KINDS as readonly string[]).includes(raw) ? (raw as CheckpointKind) : null;
}

function sendError(res: any, error: unknown): void {
  if (isGenerationError(error)) {
    return res.status(400).json({ errors: [error.message], code: error.code, retryable: error.retryable });
  }
  res.status(500).json({ errors: [error instanceof Error ? error.message : 'Unexpected error.'] });
}

/* -------------------------------------------------------------- the run --- */

/** What is configured, and whether a run could start right now. Free. */
pipelineRouter.get('/readiness', (req, res) => {
  const mode = readMode(req.query.mode);
  res.json({ mode, ...validateRoleConfiguration(mode), roles: listRoleAssignments(mode) });
});

/**
 * The runs with work left in them.
 *
 * Registered above `/:id` because `/resumable` is a single path segment and
 * would otherwise be read as a pipeline id.
 */
pipelineRouter.get('/resumable', (_req, res) => {
  res.json({ runs: listResumableRuns() });
});

pipelineRouter.post('/', (req, res) => {
  const themeId = parseId(String(req.body?.themeId));
  if (themeId === null) return res.status(400).json({ errors: ['themeId is required.'] });

  const result = startArticlePipeline({
    themeId,
    mode: readMode(req.body?.mode),
    runMode: readRunMode(req.body?.runMode),
    seedTopic: typeof req.body?.seedTopic === 'string' && req.body.seedTopic.trim() ? req.body.seedTopic.trim() : null,
    topicMode: (TOPIC_MODES as readonly string[]).includes(req.body?.topicMode) ? (req.body.topicMode as TopicMode) : 'explore',
    authorId: parseId(String(req.body?.authorId ?? '')) ?? null,
  });

  if ('error' in result) return res.status(400).json({ errors: [result.error] });
  res.status(201).json({ ...result, status: getPipelineStatus(result.pipelineId) });
});

/**
 * Drives the run forward.
 *
 * `confirmedCost` is read from the body and never defaulted to true, matching
 * every other paid path in Cynth.
 */
pipelineRouter.post('/:id/advance', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid pipeline id.'] });

  try {
    const status = await advancePipeline(id, {
      confirmedCost: req.body?.confirmedCost === true,
      stopAfter: typeof req.body?.stopAfter === 'string' ? req.body.stopAfter : undefined,
    });
    res.json({ status });
  } catch (error) {
    // A failed stage still leaves a readable pipeline, so the status is
    // returned alongside the error rather than the client being left blind.
    const status = getPipelineStatus(id);
    if (isGenerationError(error)) {
      return res.status(400).json({
        errors: [error.message],
        code: error.code,
        retryable: error.retryable,
        spend: error.spend,
        status,
      });
    }
    sendError(res, error);
  }
});

pipelineRouter.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid pipeline id.'] });

  const status = getPipelineStatus(id);
  if (!status) return res.status(404).json({ errors: ['Pipeline not found.'] });
  res.json({ status });
});

/** Everything each stage produced — the observability view. */
pipelineRouter.get('/:id/outputs', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid pipeline id.'] });

  const outputs = getPipelineOutputs(id);
  if (!outputs) return res.status(404).json({ errors: ['Pipeline not found.'] });
  res.json({ outputs });
});

pipelineRouter.get('/articles/:articleId', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const status = statusForArticle(articleId);
  if (!status) return res.status(404).json({ errors: ['This draft has no pipeline.'] });
  res.json({ status });
});

/**
 * Reopens a failed run so the failed stage can be tried again.
 *
 * Distinct from a new version, and much cheaper: completed stages are kept and
 * are not paid for twice. Nothing is run by this call — the client advances
 * afterwards, as it would normally.
 */
pipelineRouter.post('/:id/retry', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid pipeline id.'] });

  const result = resumeAfterFailure(id);
  if ('error' in result) return res.status(400).json({ errors: [result.error] });
  res.json({ status: result });
});

/** Starts a fresh version, which re-runs every stage. The user's explicit decision. */
pipelineRouter.post('/:id/new-version', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid pipeline id.'] });

  const pipeline = getPipelineById(id);
  if (!pipeline) return res.status(404).json({ errors: ['Pipeline not found.'] });

  const result = startNewVersion(pipeline.articleId, readMode(req.body?.mode));
  if ('error' in result) return res.status(400).json({ errors: [result.error] });
  res.status(201).json({ status: getPipelineStatus(result.id) });
});

/* ------------------------------------------------------- the decisions --- */

/**
 * Records an answer to an open checkpoint.
 *
 * Answering does NOT advance the run. The next stage costs money, and someone
 * who has just chosen a title has not thereby agreed to pay for the article —
 * advancing stays a separate, deliberate call.
 */
pipelineRouter.post('/:id/checkpoints/:kind/decide', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid pipeline id.'] });

  const kind = readCheckpointKind(req.params.kind);
  if (!kind) return res.status(400).json({ errors: ['Cynth does not ask for that decision.'] });

  const result = decide(id, kind, req.body?.decision, { accepted: req.body?.accepted === true });
  if ('error' in result) return res.status(400).json({ errors: [result.error] });
  res.json({ status: result });
});

/**
 * Asks the stage behind a checkpoint for a different set of options.
 *
 * This is a real second execution of a paid stage, so it passes the same
 * spend gate as the first and returns cost_confirmation_required until the
 * caller confirms. It is never triggered by anything except this request.
 */
pipelineRouter.post('/:id/checkpoints/:kind/rerun', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid pipeline id.'] });

  const kind = readCheckpointKind(req.params.kind);
  if (!kind) return res.status(400).json({ errors: ['Cynth does not ask for that decision.'] });

  try {
    const result = await rerunForCheckpoint(id, kind, { confirmedCost: req.body?.confirmedCost === true });
    if ('error' in result) return res.status(400).json({ errors: [result.error] });
    res.json({ status: result });
  } catch (error) {
    const status = getPipelineStatus(id);
    if (isGenerationError(error)) {
      return res.status(400).json({
        errors: [error.message],
        code: error.code,
        retryable: error.retryable,
        spend: error.spend,
        status,
      });
    }
    sendError(res, error);
  }
});

/** Switches between guided and automatic. Switching to automatic settles anything outstanding. */
pipelineRouter.post('/:id/run-mode', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid pipeline id.'] });

  const result = changeRunMode(id, readRunMode(req.body?.runMode));
  if ('error' in result) return res.status(400).json({ errors: [result.error] });
  res.json({ status: result });
});

/* ------------------------------------------------------------- the roles --- */

pipelineRouter.get('/roles/:mode', (req, res) => {
  const mode = readMode(req.params.mode);
  res.json({
    mode,
    roles: listRoleAssignments(mode),
    models: listAssignableModels(),
    meta: ROLE_META,
  });
});

pipelineRouter.put('/roles/:mode/:role', (req, res) => {
  const mode = readMode(req.params.mode);
  const role = req.params.role;
  if (!isValidRole(role)) return res.status(400).json({ errors: ['Unknown role.'] });

  const result = setRoleAssignment(role, mode, {
    primaryModelId: parseId(String(req.body?.primaryModelId ?? '')) ?? null,
    fallbackModelId: parseId(String(req.body?.fallbackModelId ?? '')) ?? null,
  });

  if ('error' in result) return res.status(400).json({ errors: [result.error] });
  res.json({ role: result });
});

/** Registers the default models and assigns the roles. Idempotent. */
pipelineRouter.post('/roles/seed', (req, res) => {
  const production = seedRoleDefaults({ overwriteRoles: req.body?.overwrite === true });
  const development = seedDevelopmentRoles();
  res.json({ production, development, roles: listRoleAssignments('production') });
});
