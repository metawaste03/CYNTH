import { getDatabase } from '../../shared/database/index.js';
import {
  isResumable,
  isTerminal,
  MAX_AUTOMATIC_REVIEWS,
  MAX_AUTOMATIC_REVISIONS,
  STAGE_DEFINITIONS,
} from './pipeline.constants.js';
import type {
  CheckpointKind,
  CheckpointResolution,
  PipelineMode,
  PipelineRole,
  PipelineRunMode,
  PipelineStage,
  PipelineState,
  TopicMode,
} from './pipeline.constants.js';

/**
 * Pipeline persistence: state, stage results, and the two guarantees that make
 * this a controlled engine rather than an autonomous loop.
 *
 *   IDEMPOTENCE — `findCompletedStage()` is the gate every paid stage passes
 *   through. A stage with a successful run for the current pipeline version is
 *   never executed again by a restart, a refresh, a reopened article or a
 *   resumed worker. Only an explicit rerun, or a new version, repeats one.
 *
 *   THE REVISION CAP — `canRevise()` reads a counter held on the pipeline row
 *   and compares it to MAX_AUTOMATIC_REVISIONS. It is checked in code before
 *   the stage starts, so no prompt, model or caller can talk its way past it.
 *
 * Nothing in this file calls a model.
 */

export interface PipelineDto {
  id: number;
  articleId: number;
  version: number;
  state: PipelineState;
  mode: PipelineMode;
  /** Whether this run stops at checkpoints or drives itself to the end. */
  runMode: PipelineRunMode;
  /** Whether the editor's idea is a direction to explore or a decided subject. */
  topicMode: TopicMode;
  themeId: number | null;
  revisionCount: number;
  reviewCount: number;
  outcomeNote: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface StageRunDto {
  id: number;
  pipelineId: number;
  pipelineVersion: number;
  stage: PipelineStage;
  attempt: number;
  status: 'running' | 'success' | 'failure';
  role: PipelineRole | null;
  requestedModel: string | null;
  actualModel: string | null;
  provider: string | null;
  wasFallback: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  output: unknown;
  createdAt: string;
  completedAt: string | null;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mapPipeline(row: any): PipelineDto {
  return {
    id: row.id,
    articleId: row.article_id,
    version: row.version,
    state: row.state as PipelineState,
    mode: row.mode as PipelineMode,
    runMode: (row.run_mode as PipelineRunMode) ?? 'automatic',
    topicMode: (row.topic_mode as TopicMode) ?? 'explore',
    themeId: row.theme_id ?? null,
    revisionCount: row.revision_count,
    reviewCount: row.review_count,
    outcomeNote: row.outcome_note ?? null,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
  };
}

function mapStageRun(row: any): StageRunDto {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    pipelineVersion: row.pipeline_version,
    stage: row.stage as PipelineStage,
    attempt: row.attempt,
    status: row.status,
    role: row.role ?? null,
    requestedModel: row.requested_model ?? null,
    actualModel: row.actual_model ?? null,
    provider: row.provider ?? null,
    wasFallback: row.was_fallback === 1,
    promptTokens: row.prompt_tokens ?? null,
    completionTokens: row.completion_tokens ?? null,
    cachedTokens: row.cached_tokens ?? null,
    totalTokens: row.total_tokens ?? null,
    estimatedCost: row.estimated_cost ?? null,
    durationMs: row.duration_ms ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    output: parseJson(row.output ?? null),
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
  };
}

/* ---------------------------------------------------------- the pipeline */

export function getPipelineById(id: number): PipelineDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM article_pipelines WHERE id = ?').get(id);
  return row ? mapPipeline(row) : null;
}

/** The current (highest-version) pipeline for an article. */
export function getCurrentPipeline(articleId: number): PipelineDto | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM article_pipelines WHERE article_id = ? ORDER BY version DESC LIMIT 1')
    .get(articleId);
  return row ? mapPipeline(row) : null;
}

/**
 * Every run that still has work someone can pick up, newest first.
 *
 * Only the current version of each article is considered: an older version
 * that was superseded by a new one is history, not an invitation to resume.
 * The resumable test lives in the constants so this list and the screens that
 * act on it can never disagree about what "unfinished" means.
 */
export function listUnfinishedPipelines(): PipelineDto[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT p.* FROM article_pipelines p
        WHERE p.version = (SELECT MAX(v.version) FROM article_pipelines v WHERE v.article_id = p.article_id)
        ORDER BY p.id DESC`,
    )
    .all() as any[];
  return rows.map(mapPipeline).filter((pipeline) => isResumable(pipeline.state));
}

export function listPipelinesForArticle(articleId: number): PipelineDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM article_pipelines WHERE article_id = ? ORDER BY version DESC')
    .all(articleId) as any[];
  return rows.map(mapPipeline);
}

/**
 * Starts a pipeline, or returns the one already running.
 *
 * Reusing an existing unfinished pipeline is deliberate: pressing Start twice
 * must not create a second run that would then re-execute paid stages.
 */
export function startPipeline(input: {
  articleId: number;
  mode: PipelineMode;
  runMode?: PipelineRunMode;
  topicMode?: TopicMode;
  themeId?: number | null;
}): PipelineDto {
  const existing = getCurrentPipeline(input.articleId);
  if (existing && !isTerminal(existing.state)) return existing;

  const db = getDatabase();
  // A new version only when a previous run finished; otherwise this is the
  // first run of version 1.
  const version = existing ? existing.version + 1 : 1;

  const result = db
    .prepare(
      `INSERT INTO article_pipelines (article_id, version, state, mode, run_mode, topic_mode, theme_id)
       VALUES (?, ?, 'DRAFT', ?, ?, ?, ?)`,
    )
    .run(
      input.articleId,
      version,
      input.mode,
      input.runMode ?? 'automatic',
      input.topicMode ?? 'explore',
      input.themeId ?? null,
    );

  const pipeline = getPipelineById(Number(result.lastInsertRowid))!;
  recordTransition(pipeline.id, null, 'DRAFT', null, `Pipeline version ${version} started in ${input.mode} mode.`);
  return pipeline;
}

/** Explicitly begins a fresh version, so every stage runs again. The user's own decision. */
export function startNewVersion(
  articleId: number,
  mode: PipelineMode,
  runMode?: PipelineRunMode,
): PipelineDto | { error: string } {
  const existing = getCurrentPipeline(articleId);
  if (!existing) return { error: 'No pipeline exists for this article yet.' };

  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO article_pipelines (article_id, version, state, mode, run_mode, topic_mode, theme_id)
       VALUES (?, ?, 'DRAFT', ?, ?, ?, ?)`,
    )
    // Starting over keeps how the run is driven unless the caller says
    // otherwise: someone who was steering the last attempt still wants to
    // steer this one. The topic mode carries over for the same reason — an
    // editor who supplied a decided subject has not changed their mind about
    // it by asking for another attempt at writing it.
    .run(
      articleId,
      existing.version + 1,
      mode,
      runMode ?? existing.runMode,
      existing.topicMode,
      existing.themeId,
    );

  const pipeline = getPipelineById(Number(result.lastInsertRowid))!;
  recordTransition(pipeline.id, null, 'DRAFT', null, `Version ${pipeline.version} started deliberately.`);
  return pipeline;
}

export function setState(
  pipelineId: number,
  state: PipelineState,
  options: { stage?: PipelineStage | null; note?: string | null } = {},
): PipelineDto | null {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return null;
  if (pipeline.state === state) return pipeline;

  const db = getDatabase();
  db.prepare(
    `UPDATE article_pipelines SET state = ?, updated_at = datetime('now'),
       completed_at = CASE WHEN ? IN ('READY','NEEDS_EDITORIAL_ATTENTION','FAILED') THEN datetime('now') ELSE completed_at END,
       outcome_note = COALESCE(?, outcome_note)
     WHERE id = ?`,
  ).run(state, state, options.note ?? null, pipelineId);

  recordTransition(pipelineId, pipeline.state, state, options.stage ?? null, options.note ?? null);
  return getPipelineById(pipelineId);
}

export function recordTransition(
  pipelineId: number,
  fromState: PipelineState | null,
  toState: PipelineState,
  stage: PipelineStage | null,
  note: string | null,
): void {
  const db = getDatabase();
  db.prepare(
    'INSERT INTO pipeline_transitions (pipeline_id, from_state, to_state, stage, note) VALUES (?, ?, ?, ?, ?)',
  ).run(pipelineId, fromState, toState, stage, note);
}

export function listTransitions(pipelineId: number): {
  fromState: string | null;
  toState: string;
  stage: string | null;
  note: string | null;
  createdAt: string;
}[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM pipeline_transitions WHERE pipeline_id = ? ORDER BY id ASC')
    .all(pipelineId) as any[];
  return rows.map((row) => ({
    fromState: row.from_state ?? null,
    toState: row.to_state,
    stage: row.stage ?? null,
    note: row.note ?? null,
    createdAt: row.created_at,
  }));
}

/* ------------------------------------------------------------ the caps --- */

/**
 * Whether one more automatic revision is permitted. The hard cap, in code.
 *
 * Returns a reason rather than a bare false, because "you have already used
 * the one automatic revision" is something the user needs to read.
 */
export function canRevise(pipelineId: number): { allowed: boolean; reason: string } {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return { allowed: false, reason: 'Pipeline not found.' };

  if (pipeline.revisionCount >= MAX_AUTOMATIC_REVISIONS) {
    return {
      allowed: false,
      reason: `The one automatic revision has already been used (${pipeline.revisionCount}/${MAX_AUTOMATIC_REVISIONS}). Cynth stops here — the article needs a human editor.`,
    };
  }
  return { allowed: true, reason: `Revision ${pipeline.revisionCount + 1} of ${MAX_AUTOMATIC_REVISIONS}.` };
}

/** Whether an automatic review is permitted. There is exactly one, before the revision. */
export function canReview(pipelineId: number): { allowed: boolean; reason: string } {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return { allowed: false, reason: 'Pipeline not found.' };

  if (pipeline.reviewCount >= MAX_AUTOMATIC_REVIEWS) {
    return {
      allowed: false,
      reason: `The article has already been reviewed (${pipeline.reviewCount}/${MAX_AUTOMATIC_REVIEWS}). After the permitted revision Cynth runs deterministic validation instead of reviewing again.`,
    };
  }
  return { allowed: true, reason: 'Review permitted.' };
}

export function incrementRevisionCount(pipelineId: number): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE article_pipelines SET revision_count = revision_count + 1, updated_at = datetime('now') WHERE id = ?`,
  ).run(pipelineId);
}

export function incrementReviewCount(pipelineId: number): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE article_pipelines SET review_count = review_count + 1, updated_at = datetime('now') WHERE id = ?`,
  ).run(pipelineId);
}

/* --------------------------------------------------------- stage runs --- */

/**
 * The successful run of a stage for the current version, if there is one.
 *
 * THE IDEMPOTENCY GATE. A paid stage calls this first and returns the stored
 * output when it answers — which is what stops a server restart, a refreshed
 * browser or a reopened article from spending money a second time.
 */
export function findCompletedStage(
  pipelineId: number,
  version: number,
  stage: PipelineStage,
): StageRunDto | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT * FROM pipeline_stage_runs
       WHERE pipeline_id = ? AND pipeline_version = ? AND stage = ? AND status = 'success'
       ORDER BY attempt DESC LIMIT 1`,
    )
    .get(pipelineId, version, stage);
  return row ? mapStageRun(row) : null;
}

export function listStageRuns(pipelineId: number, version?: number): StageRunDto[] {
  const db = getDatabase();
  const rows = (
    version === undefined
      ? db.prepare('SELECT * FROM pipeline_stage_runs WHERE pipeline_id = ? ORDER BY id ASC').all(pipelineId)
      : db
          .prepare(
            'SELECT * FROM pipeline_stage_runs WHERE pipeline_id = ? AND pipeline_version = ? ORDER BY id ASC',
          )
          .all(pipelineId, version)
  ) as any[];
  return rows.map(mapStageRun);
}

/** The next attempt number for a stage. Only an explicit rerun ever exceeds 1. */
function nextAttempt(pipelineId: number, version: number, stage: PipelineStage): number {
  const db = getDatabase();
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(attempt), 0) AS max FROM pipeline_stage_runs WHERE pipeline_id = ? AND pipeline_version = ? AND stage = ?',
    )
    .get(pipelineId, version, stage) as { max: number };
  return row.max + 1;
}

export function beginStageRun(input: {
  pipelineId: number;
  version: number;
  stage: PipelineStage;
  role?: PipelineRole | null;
  requestedModel?: string | null;
}): StageRunDto {
  const db = getDatabase();
  const attempt = nextAttempt(input.pipelineId, input.version, input.stage);

  const result = db
    .prepare(
      `INSERT INTO pipeline_stage_runs (pipeline_id, pipeline_version, stage, attempt, status, role, requested_model)
       VALUES (?, ?, ?, ?, 'running', ?, ?)`,
    )
    .run(input.pipelineId, input.version, input.stage, attempt, input.role ?? null, input.requestedModel ?? null);

  const row = db.prepare('SELECT * FROM pipeline_stage_runs WHERE id = ?').get(Number(result.lastInsertRowid));
  return mapStageRun(row);
}

export interface CompleteStageInput {
  actualModel?: string | null;
  provider?: string | null;
  wasFallback?: boolean;
  promptTokens?: number | null;
  completionTokens?: number | null;
  cachedTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  durationMs?: number | null;
  output?: unknown;
}

export function completeStageRun(runId: number, input: CompleteStageInput): StageRunDto {
  const db = getDatabase();
  db.prepare(
    `UPDATE pipeline_stage_runs SET status = 'success', actual_model = ?, provider = ?, was_fallback = ?,
       prompt_tokens = ?, completion_tokens = ?, cached_tokens = ?, total_tokens = ?, estimated_cost = ?,
       duration_ms = ?, output = ?, completed_at = datetime('now')
     WHERE id = ?`,
  ).run(
    input.actualModel ?? null,
    input.provider ?? null,
    input.wasFallback ? 1 : 0,
    input.promptTokens ?? null,
    input.completionTokens ?? null,
    input.cachedTokens ?? null,
    input.totalTokens ?? null,
    input.estimatedCost ?? null,
    input.durationMs ?? null,
    input.output === undefined ? null : JSON.stringify(input.output),
    runId,
  );

  const row = db.prepare('SELECT * FROM pipeline_stage_runs WHERE id = ?').get(runId);
  return mapStageRun(row);
}

export function failStageRun(
  runId: number,
  input: { errorCode: string; errorMessage: string; durationMs?: number | null; actualModel?: string | null },
): StageRunDto {
  const db = getDatabase();
  db.prepare(
    `UPDATE pipeline_stage_runs SET status = 'failure', error_code = ?, error_message = ?, duration_ms = ?,
       actual_model = COALESCE(?, actual_model), completed_at = datetime('now')
     WHERE id = ?`,
  ).run(input.errorCode, input.errorMessage, input.durationMs ?? null, input.actualModel ?? null, runId);

  const row = db.prepare('SELECT * FROM pipeline_stage_runs WHERE id = ?').get(runId);
  return mapStageRun(row);
}

/* ------------------------------------------------------------ costing --- */

export interface StageCost {
  stage: PipelineStage;
  label: string;
  model: string | null;
  estimatedCost: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  wasFallback: boolean;
}

export interface PipelineCostBreakdown {
  pipelineId: number;
  version: number;
  stages: StageCost[];
  /** Sum of the stages whose cost is known. */
  totalCost: number;
  /** True when at least one stage ran on a model with unknown pricing, so the total understates the truth. */
  hasUnknownCosts: boolean;
  revisionCount: number;
  maxRevisions: number;
}

/**
 * The per-article cost breakdown.
 *
 * A stage whose model had no published prices contributes null rather than
 * zero, and `hasUnknownCosts` says so — a total that silently treats unknown
 * as free would be a lie in the one direction that matters.
 */
export function getCostBreakdown(pipelineId: number): PipelineCostBreakdown | null {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return null;

  const runs = listStageRuns(pipelineId, pipeline.version).filter((run) => run.status === 'success');

  const stages: StageCost[] = runs.map((run) => ({
    stage: run.stage,
    label: STAGE_DEFINITIONS[run.stage]?.label ?? run.stage,
    model: run.actualModel,
    estimatedCost: run.estimatedCost,
    totalTokens: run.totalTokens,
    durationMs: run.durationMs,
    wasFallback: run.wasFallback,
  }));

  const paidRuns = runs.filter((run) => STAGE_DEFINITIONS[run.stage]?.paid);

  return {
    pipelineId,
    version: pipeline.version,
    stages,
    totalCost: stages.reduce((sum, stage) => sum + (stage.estimatedCost ?? 0), 0),
    hasUnknownCosts: paidRuns.some((run) => run.estimatedCost === null),
    revisionCount: pipeline.revisionCount,
    maxRevisions: MAX_AUTOMATIC_REVISIONS,
  };
}

/* --------------------------------------------------------- checkpoints */

/**
 * A guided run's pauses.
 *
 * A checkpoint row is the ONLY thing standing between a paused run and a
 * finished one, which is why it is persisted rather than held in memory: the
 * editor can close the tab, restart the machine and come back to the same
 * question with the same options, because the options are the stage output
 * that is already stored beside it.
 */
export interface CheckpointDto {
  id: number;
  pipelineId: number;
  pipelineVersion: number;
  kind: CheckpointKind;
  stage: PipelineStage;
  status: 'open' | 'resolved';
  resolution: CheckpointResolution | null;
  decision: unknown;
  openedAt: string;
  decidedAt: string | null;
}

function mapCheckpoint(row: any): CheckpointDto {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    pipelineVersion: row.pipeline_version,
    kind: row.kind as CheckpointKind,
    stage: row.stage as PipelineStage,
    status: row.status,
    resolution: (row.resolution as CheckpointResolution) ?? null,
    decision: parseJson(row.decision ?? null),
    openedAt: row.opened_at,
    decidedAt: row.decided_at ?? null,
  };
}

export function listCheckpoints(pipelineId: number, version?: number): CheckpointDto[] {
  const db = getDatabase();
  const rows = (
    version === undefined
      ? db.prepare('SELECT * FROM pipeline_checkpoints WHERE pipeline_id = ? ORDER BY id').all(pipelineId)
      : db
          .prepare('SELECT * FROM pipeline_checkpoints WHERE pipeline_id = ? AND pipeline_version = ? ORDER BY id')
          .all(pipelineId, version)
  ) as any[];
  return rows.map(mapCheckpoint);
}

export function getCheckpoint(pipelineId: number, version: number, kind: CheckpointKind): CheckpointDto | null {
  const row = getDatabase()
    .prepare('SELECT * FROM pipeline_checkpoints WHERE pipeline_id = ? AND pipeline_version = ? AND kind = ?')
    .get(pipelineId, version, kind);
  return row ? mapCheckpoint(row) : null;
}

/**
 * Opens a checkpoint, or returns the one already there.
 *
 * Deliberately idempotent for the same reason stage runs are: advancing a
 * paused pipeline repeatedly must not produce a second copy of the same
 * question, and must never reopen one that has already been answered.
 */
export function openCheckpoint(input: {
  pipelineId: number;
  version: number;
  kind: CheckpointKind;
  stage: PipelineStage;
}): CheckpointDto {
  const existing = getCheckpoint(input.pipelineId, input.version, input.kind);
  if (existing) return existing;

  getDatabase()
    .prepare(
      `INSERT INTO pipeline_checkpoints (pipeline_id, pipeline_version, kind, stage, status)
       VALUES (?, ?, ?, ?, 'open')`,
    )
    .run(input.pipelineId, input.version, input.kind, input.stage);

  return getCheckpoint(input.pipelineId, input.version, input.kind)!;
}

/**
 * Records a decision.
 *
 * An answered checkpoint is never re-answered: the stages behind it may
 * already have run on the first answer, and quietly changing it would leave
 * the article disagreeing with the run that produced it. Changing your mind
 * after that point is a new version, which is an explicit act.
 */
export function decideCheckpoint(
  pipelineId: number,
  version: number,
  kind: CheckpointKind,
  input: { resolution: CheckpointResolution; decision: unknown },
): CheckpointDto | { error: string } {
  const existing = getCheckpoint(pipelineId, version, kind);
  if (!existing) return { error: 'That decision is not open on this run.' };
  if (existing.status === 'resolved') {
    return { error: 'That decision has already been made. Start a new version to change it.' };
  }

  getDatabase()
    .prepare(
      `UPDATE pipeline_checkpoints
          SET status = 'resolved', resolution = ?, decision = ?, decided_at = datetime('now')
        WHERE id = ?`,
    )
    .run(input.resolution, input.decision === undefined ? null : JSON.stringify(input.decision), existing.id);

  return getCheckpoint(pipelineId, version, kind)!;
}

/**
 * Settles every open checkpoint as Cynth's own choice.
 *
 * Used when the editor switches a guided run to automatic mid-flight. They
 * are recorded as 'automatic' rather than 'accepted' so the history never
 * claims a person approved something they only stopped objecting to.
 */
export function resolveOpenCheckpointsAutomatically(pipelineId: number, version: number): number {
  const open = listCheckpoints(pipelineId, version).filter((checkpoint) => checkpoint.status === 'open');
  for (const checkpoint of open) {
    getDatabase()
      .prepare(
        `UPDATE pipeline_checkpoints
            SET status = 'resolved', resolution = 'automatic', decision = NULL, decided_at = datetime('now')
          WHERE id = ?`,
      )
      .run(checkpoint.id);
  }
  return open.length;
}

/** Switches how a run is driven. Returns the updated pipeline. */
export function setRunMode(pipelineId: number, runMode: PipelineRunMode): PipelineDto | null {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return null;
  if (pipeline.runMode === runMode) return pipeline;

  getDatabase()
    .prepare("UPDATE article_pipelines SET run_mode = ?, updated_at = datetime('now') WHERE id = ?")
    .run(runMode, pipelineId);

  if (runMode === 'automatic') {
    const settled = resolveOpenCheckpointsAutomatically(pipelineId, pipeline.version);
    if (settled > 0) {
      recordTransition(
        pipelineId,
        pipeline.state,
        pipeline.state,
        null,
        `Switched to automatic; Cynth settled ${settled} outstanding decision(s) with its own recommendation.`,
      );
    }
  }

  return getPipelineById(pipelineId);
}
