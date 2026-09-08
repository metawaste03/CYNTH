import { api } from '../../shared/services/apiClient';

export type PipelineMode = 'development' | 'production';

/** 'guided' pauses at each checkpoint and waits; 'automatic' runs to the end. */
export type PipelineRunMode = 'automatic' | 'guided';

export type CheckpointKind = 'topic' | 'keywords_title' | 'template' | 'products' | 'review';

export interface TopicOption {
  index: number;
  topic: string;
  recommendedAngle: string;
  whyNow: string;
  audience: string;
  searchOpportunity: string;
  commercialOpportunity: string;
  contentGap: string;
  likelySearchIntent: string;
  researchSummary: string;
  sourceCount: number;
}

export interface TopicOptions {
  candidates: TopicOption[];
  recommendedIndex: number;
}

export interface KeywordOptions {
  titleCandidates: string[];
  recommendedTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  longTailKeywords: string[];
  relatedQuestions: string[];
  entities: string[];
  searchIntent: string;
  seoNotes: string[];
}

export interface TemplateOptions {
  articleType: string;
  confidence: number;
  reasoning: string;
  templateId: string;
  templateName: string;
  borrowed: boolean;
  sectionKeys: string[];
  availableTypes: string[];
}

export interface ProductOption {
  productId: number;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  themeId: number | null;
  themeName: string | null;
  matchesTheme: boolean;
  useCase: string | null;
  problemSolved: string | null;
  /** 'thin' means the writer has little to place it on. Shown before the choice, not after. */
  readiness: 'ready' | 'thin';
  readinessNote: string | null;
  alreadyAttached: boolean;
}

export interface ProductOpportunity {
  /** A category, e.g. "Clumping cat litter". Never a brand or a model. */
  productType: string;
  whySuited: string;
  sectionKey: string | null;
  searchTerms: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface ProductOptions {
  /** What kinds of product this article could carry, proposed from the article itself. */
  opportunities: ProductOpportunity[];
  opportunityAssessment: string | null;
  themeId: number | null;
  themeName: string | null;
  inTheme: ProductOption[];
  others: ProductOption[];
  attachedProductIds: number[];
  /** How many places this article's template can put a product. */
  placementSlots: number;
  suggested: string;
}

export interface ReviewOptions {
  overallScore: number;
  summary: string;
  revisionRequired: boolean;
  strengths: string[];
  issues: { severity: string; section: string; problem: string; requiredChange: string }[];
  revisionsRemaining: number;
}

export interface OpenCheckpoint {
  kind: CheckpointKind;
  stage: string;
  label: string;
  question: string;
  /** Whether asking for different options is possible — it costs money again. */
  rerunnable: boolean;
  openedAt: string;
  options: TopicOptions | KeywordOptions | TemplateOptions | ProductOptions | ReviewOptions;
}

export type StageStatus = 'pending' | 'running' | 'success' | 'failure' | 'skipped';

export interface StageProgress {
  stage: string;
  label: string;
  paid: boolean;
  status: StageStatus;
  model: string | null;
  estimatedCost: number | null;
  durationMs: number | null;
  wasFallback: boolean;
  error: string | null;
}

export interface PipelineStatus {
  pipeline: {
    id: number;
    articleId: number;
    version: number;
    state: string;
    mode: PipelineMode;
    revisionCount: number;
    reviewCount: number;
    outcomeNote: string | null;
    startedAt: string;
    completedAt: string | null;
  };
  articleId: number;
  runMode: PipelineRunMode;
  stages: StageProgress[];
  /** The hard cap, carried with the progress so the UI can never imply more. */
  revisions: { used: number; max: number };
  cost: {
    totalCost: number;
    hasUnknownCosts: boolean;
    stages: { stage: string; label: string; model: string | null; estimatedCost: number | null; totalTokens: number | null }[];
  } | null;
  transitions: { fromState: string | null; toState: string; stage: string | null; note: string | null; createdAt: string }[];
  /** The decision the run is waiting on, or null when it is not waiting. */
  checkpoint: OpenCheckpoint | null;
  decisions: {
    kind: CheckpointKind;
    label: string;
    resolution: string | null;
    decision: unknown;
    decidedAt: string | null;
  }[];
  finished: boolean;
}

/**
 * A run that was left unfinished.
 *
 * The topic and title come from the run's own stage output, because the
 * article row genuinely has neither until the writer stage runs — which is why
 * an in-progress run shows as an untitled draft in the article lists.
 */
export interface ResumableRun {
  pipelineId: number;
  articleId: number;
  version: number;
  state: string;
  mode: PipelineMode;
  runMode: PipelineRunMode;
  themeName: string | null;
  topic: string | null;
  title: string | null;
  waitingFor: string | null;
  nextStage: string | null;
  failed: boolean;
  note: string | null;
  spent: number | null;
  startedAt: string;
}

export function fetchResumableRuns(): Promise<ResumableRun[]> {
  return api.get<{ runs: ResumableRun[] }>('/pipeline/resumable').then((r) => r.runs);
}

export interface RoleModel {
  id: number;
  modelName: string;
  displayName: string | null;
  vendor: string | null;
  providerName: string;
  costTier: string;
  promptPrice: number | null;
  completionPrice: number | null;
  isFree: boolean | null;
  fallbackEligible: boolean;
  isEnabled: boolean;
}

export interface RoleAssignment {
  role: string;
  label: string;
  description: string;
  costGuidance: string;
  mode: PipelineMode;
  primary: RoleModel | null;
  fallback: RoleModel | null;
  configured: boolean;
  issues: string[];
}

/**
 * What the server says a refused paid stage would have cost.
 *
 * Returned with a `cost_confirmation_required` refusal so the confirmation can
 * state a figure. Asking someone to confirm an estimated cost without showing
 * them the estimate is not a question they can answer.
 */
export interface SpendRefusal {
  stage: string;
  stageLabel: string;
  model: string;
  costClass: string;
  /** USD. Null when the model publishes no pricing — which is itself why it is gated. */
  estimatedCost: number | null;
}

export interface Readiness {
  mode: PipelineMode;
  ready: boolean;
  issues: string[];
  roles: RoleAssignment[];
}

export function fetchReadiness(mode: PipelineMode): Promise<Readiness> {
  return api.get<Readiness>(`/pipeline/readiness?mode=${mode}`);
}

/** 'explore' finds angles within the idea; 'exact' researches it as the decided subject. */
export type TopicMode = 'explore' | 'exact';

export function startPipeline(input: {
  themeId: number;
  mode: PipelineMode;
  runMode?: PipelineRunMode;
  seedTopic?: string | null;
  topicMode?: TopicMode;
  authorId?: number | null;
}): Promise<{ pipelineId: number; articleId: number; status: PipelineStatus }> {
  return api.post('/pipeline', input);
}

/**
 * Records an answer. It does NOT advance the run — the next stage costs
 * money, so spending it stays a separate click.
 */
export function decideCheckpoint(
  pipelineId: number,
  kind: CheckpointKind,
  decision: unknown,
  accepted = false,
): Promise<{ status: PipelineStatus }> {
  return api.post(`/pipeline/${pipelineId}/checkpoints/${kind}/decide`, { decision, accepted });
}

/** Asks the stage for different options. A real second execution, and a real second charge. */
export function rerunCheckpoint(
  pipelineId: number,
  kind: CheckpointKind,
  confirmedCost: boolean,
): Promise<{ status: PipelineStatus }> {
  return api.post(`/pipeline/${pipelineId}/checkpoints/${kind}/rerun`, { confirmedCost });
}

/**
 * Reopens a failed run so the failed stage can be tried again.
 *
 * Cheaper than starting over: completed stages are kept and are not paid for
 * twice. It runs nothing by itself — advancing is still a separate call.
 */
export function retryPipeline(pipelineId: number): Promise<{ status: PipelineStatus }> {
  return api.post(`/pipeline/${pipelineId}/retry`, {});
}

export function setRunMode(pipelineId: number, runMode: PipelineRunMode): Promise<{ status: PipelineStatus }> {
  return api.post(`/pipeline/${pipelineId}/run-mode`, { runMode });
}

/** Safe to call repeatedly — a completed stage returns its stored result and costs nothing. */
export function advancePipeline(pipelineId: number, confirmedCost: boolean): Promise<{ status: PipelineStatus }> {
  return api.post(`/pipeline/${pipelineId}/advance`, { confirmedCost });
}

export function fetchPipeline(pipelineId: number): Promise<PipelineStatus> {
  return api.get<{ status: PipelineStatus }>(`/pipeline/${pipelineId}`).then((r) => r.status);
}

export function fetchPipelineOutputs(pipelineId: number): Promise<Record<string, unknown>> {
  return api.get<{ outputs: Record<string, unknown> }>(`/pipeline/${pipelineId}/outputs`).then((r) => r.outputs);
}

export function fetchRoles(mode: PipelineMode): Promise<{ roles: RoleAssignment[]; models: RoleModel[] }> {
  return api.get(`/pipeline/roles/${mode}`);
}

export function setRole(
  mode: PipelineMode,
  role: string,
  input: { primaryModelId: number | null; fallbackModelId: number | null },
): Promise<{ role: RoleAssignment }> {
  return api.put(`/pipeline/roles/${mode}/${role}`, input);
}
