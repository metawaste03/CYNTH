import { getDatabase } from '../../shared/database/index.js';
import {
  decideCheckpoint,
  findCompletedStage,
  getCheckpoint,
  getCostBreakdown,
  getCurrentPipeline,
  getPipelineById,
  listCheckpoints,
  listStageRuns,
  listTransitions,
  listUnfinishedPipelines,
  openCheckpoint,
  setRunMode,
  setState,
  startPipeline,
} from './pipeline.repository.js';
import type { CheckpointDto, PipelineDto } from './pipeline.repository.js';
import {
  CHECKPOINTS_BY_KIND,
  isTerminal,
  MAX_AUTOMATIC_REVISIONS,
  PIPELINE_STAGES,
  STAGE_DEFINITIONS,
} from './pipeline.constants.js';
import type {
  CheckpointKind,
  PipelineMode,
  PipelineRunMode,
  PipelineStage,
  PipelineState,
  TopicMode,
} from './pipeline.constants.js';
import { validateRoleConfiguration } from './roleRegistry.repository.js';
import { runClassification, runKeywordResearch, runTopicResearch } from './stages/researchStages.service.js';
import type {
  ArticleClassification,
  KeywordResearch,
  TopicResearch,
  TopicResearchSet,
} from './stages/researchStages.service.js';
import { buildBrief, overrideArticleType, selectTemplate } from './stages/briefStages.service.js';
import type { ArticleBrief, TemplateSelection } from './stages/briefStages.service.js';
import { runArticleGeneration, runArticleReview, runArticleRevision } from './stages/generationStages.service.js';
import type { ArticleReview, GeneratedArticle } from './stages/generationStages.service.js';
import { runFinalValidation } from './stages/validation.service.js';
import { runProductOpportunity } from './stages/productOpportunity.service.js';
import type { ProductOpportunitySet } from './stages/productOpportunity.service.js';
import {
  applyKeywordDecision,
  applyTopicDecision,
  buildKeywordOptions,
  buildReviewOptions,
  buildTemplateOptions,
  buildTopicOptions,
  isDecisionError,
  readDecision,
} from './checkpoints.service.js';
import type {
  KeywordDecision,
  ProductDecision,
  ProductOption,
  ProductOptions,
  ReviewDecision,
  TemplateDecision,
  TopicDecision,
} from './checkpoints.service.js';
import { toProductOption } from './checkpoints.service.js';
import { createArticleDraft, getArticleById } from '../articles/articles.repository.js';
import { attachProduct, detachProduct, listArticleProducts } from '../articles/articleProducts.repository.js';
import { listProducts } from '../products/products.repository.js';
import { getTemplate } from '../templates/templates.repository.js';
import { getDefaultProject, getThemeById, listAuthorsForTheme } from '../content/content.repository.js';
import { GenerationError } from '../generation/generation.errors.js';

/**
 * THE CONDUCTOR.
 *
 * Runs the stages in order, resuming from wherever a pipeline actually is.
 * It owns sequencing and nothing else: every stage still enforces its own
 * idempotency, spend gate and caps, so driving the pipeline from here cannot
 * bypass any of them.
 *
 * The whole run is resumable because each stage reads its predecessor's
 * PERSISTED output rather than a value held in memory. A server restart
 * mid-run loses nothing and repeats no paid stage.
 *
 * It stops at the first stage that fails, and at any terminal state. There is
 * no retry loop and no "try harder" path.
 *
 * GUIDED RUNS (Milestone 24) add one more reason to stop: an open checkpoint.
 * The editor chooses the topic, the title and the keywords from options the
 * pipeline produced. This changes WHO decides and nothing else — the stages,
 * the gates, the caps and the costs are identical in both run modes, and a
 * guided run that is switched to automatic simply stops being asked.
 */

/** A decision the run is waiting on, with the options it is waiting between. */
export interface OpenCheckpoint {
  kind: CheckpointKind;
  stage: PipelineStage;
  label: string;
  question: string;
  rerunnable: boolean;
  openedAt: string;
  options: unknown;
}

export interface PipelineStatus {
  pipeline: PipelineDto;
  articleId: number;
  runMode: PipelineRunMode;
  /** Every stage, whether it has run, and what it cost. */
  stages: {
    stage: PipelineStage;
    label: string;
    paid: boolean;
    status: 'pending' | 'running' | 'success' | 'failure' | 'skipped';
    model: string | null;
    estimatedCost: number | null;
    durationMs: number | null;
    wasFallback: boolean;
    error: string | null;
  }[];
  revisions: { used: number; max: number };
  cost: ReturnType<typeof getCostBreakdown>;
  transitions: ReturnType<typeof listTransitions>;
  /** The decision this run is waiting on, or null when it is not waiting. */
  checkpoint: OpenCheckpoint | null;
  /** Every decision made on this version, and who made it. */
  decisions: { kind: CheckpointKind; label: string; resolution: string | null; decision: unknown; decidedAt: string | null }[];
  /** True when the run has finished, whatever the outcome. */
  finished: boolean;
}

/**
 * The stored output of a completed stage, or null when it has not run.
 *
 * Reads the LATEST successful attempt, which matters once a checkpoint can
 * ask a stage for different options: after a rerun the first attempt is still
 * on record, and showing its options while the pipeline consumes the second
 * attempt would put the editor and the engine on different pages.
 */
function outputOf<T>(pipeline: PipelineDto, stage: PipelineStage): T | null {
  const run = findCompletedStage(pipeline.id, pipeline.version, stage);
  return run ? (run.output as T) : null;
}

/**
 * What the editor can put in front of the writer.
 *
 * The article's own thematic area does the filtering, exactly as the media
 * library does it: a workspace article should not have to scroll past pet-care
 * products. Everything else is still returned, in a second list, because a
 * product filed under the wrong area — or under none — must remain reachable
 * rather than invisible.
 *
 * Nothing here attaches anything. It reports what exists.
 */
/**
 * How many places this article's template can actually put a product.
 *
 * Read from the template rather than assumed, because it is the honest answer
 * to "how many should I choose" and the reason a trend analysis is not asked
 * the question at all.
 */
function productSlotsFor(templateId: string | null, version: number | null): number {
  if (!templateId) return 0;
  const template = getTemplate(templateId, version ?? undefined);
  if (!template) return 0;

  return template.contentSchema.sections.filter(
    (section) => section.productPlacement && section.productPlacement !== 'none',
  ).length;
}

function buildProductOptions(pipeline: PipelineDto): ProductOptions {
  const article = getArticleById(pipeline.articleId);
  const articleThemeId = article?.themeId ?? null;

  const attachedIds = new Set(listArticleProducts(pipeline.articleId).map((row) => row.productId));
  const all = listProducts({ status: 'active' });

  const options: ProductOption[] = all.map((product) =>
    toProductOption(product, {
      articleThemeId,
      imageUrl: product.primaryImage?.url ?? null,
      attached: attachedIds.has(product.id),
    }),
  );

  const placementSlots = productSlotsFor(article?.templateId ?? null, article?.templateVersion ?? null);

  // What the pipeline suggested going shopping for, when it was asked. Read
  // from the stage output rather than recomputed, so the panel shows exactly
  // what was paid for.
  const suggested = outputOf<ProductOpportunitySet>(pipeline, 'product_opportunity');

  return {
    opportunities: suggested?.opportunities ?? [],
    opportunityAssessment: suggested?.assessment ?? null,
    themeId: articleThemeId,
    // Read from the thematic area itself. Deriving it from a product that
    // happens to match meant an area with no products yet reported no area at
    // all — which the panel then rendered as "this article has no thematic
    // area", the one thing it was not.
    themeName: articleThemeId === null ? null : (getThemeById(articleThemeId)?.name ?? null),
    inTheme: options.filter((option) => option.matchesTheme),
    others: options.filter((option) => !option.matchesTheme),
    attachedProductIds: [...attachedIds],
    placementSlots,
    suggested:
      placementSlots === 0
        ? 'This article type has no place for a product. Choosing none is the right answer here.'
        : 'Two or three is usually right. More than that and each one gets too few words to be a real recommendation.',
  };
}

/**
 * Rebuilds the options for an open checkpoint from stored stage output.
 *
 * Built on demand rather than copied into the checkpoint row, so what the
 * editor is shown is always the output the pipeline will actually use. Two
 * stored copies of the same options could disagree; one cannot.
 */
function describeCheckpoint(pipeline: PipelineDto, checkpoint: CheckpointDto): OpenCheckpoint | null {
  const definition = CHECKPOINTS_BY_KIND[checkpoint.kind];
  if (!definition) return null;

  let options: unknown = null;
  switch (checkpoint.kind) {
    case 'topic': {
      const output = outputOf<TopicResearchSet>(pipeline, 'topic_research');
      if (!output) return null;
      options = buildTopicOptions(output);
      break;
    }
    case 'keywords_title': {
      const output = outputOf<KeywordResearch>(pipeline, 'keyword_research');
      if (!output) return null;
      options = buildKeywordOptions(output);
      break;
    }
    case 'template': {
      const classification = outputOf<ArticleClassification>(pipeline, 'article_classification');
      const selection = outputOf<TemplateSelection>(pipeline, 'template_selection');
      if (!classification || !selection) return null;
      options = buildTemplateOptions(classification, selection);
      break;
    }
    case 'products': {
      // The only checkpoint whose options are not a stage's output: they are
      // the product registry as it stands right now. Rebuilt on every read, so
      // a product added in another tab appears without restarting anything.
      options = buildProductOptions(pipeline);
      break;
    }
    case 'review': {
      const review = outputOf<ArticleReview>(pipeline, 'article_review');
      if (!review) return null;
      options = buildReviewOptions(review, Math.max(0, MAX_AUTOMATIC_REVISIONS - pipeline.revisionCount));
      break;
    }
    default:
      return null;
  }

  return {
    kind: checkpoint.kind,
    stage: checkpoint.stage,
    label: definition.label,
    question: definition.question,
    rerunnable: definition.rerunnable,
    openedAt: checkpoint.openedAt,
    options,
  };
}

export function getPipelineStatus(pipelineId: number): PipelineStatus | null {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return null;

  const runs = listStageRuns(pipeline.id, pipeline.version);
  const latestByStage = new Map<PipelineStage, (typeof runs)[number]>();
  for (const run of runs) latestByStage.set(run.stage, run);

  const checkpoints = listCheckpoints(pipeline.id, pipeline.version);
  const open = checkpoints.find((entry) => entry.status === 'open') ?? null;

  return {
    pipeline,
    articleId: pipeline.articleId,
    runMode: pipeline.runMode,
    stages: PIPELINE_STAGES.map((stage) => {
      const definition = STAGE_DEFINITIONS[stage];
      const run = latestByStage.get(stage);

      // The revision stage is 'skipped', not 'pending', once the run has moved
      // past review without needing one — a progress list that shows a pending
      // revision forever would imply more work is coming.
      // A stage that will never run on this pipeline reads as 'skipped', not
      // as 'pending' — a progress list showing work that is not coming is a
      // list that lies about what is left.
      const skipped =
        (stage === 'article_revision' &&
          !run &&
          (pipeline.state === 'READY' || pipeline.state === 'REVIEW_COMPLETE')) ||
        (stage === 'product_opportunity' && !run && pipeline.runMode === 'automatic');

      return {
        stage,
        label: definition.label,
        paid: definition.paid,
        status: run ? run.status : skipped ? 'skipped' : 'pending',
        model: run?.actualModel ?? null,
        estimatedCost: run?.estimatedCost ?? null,
        durationMs: run?.durationMs ?? null,
        wasFallback: run?.wasFallback ?? false,
        error: run?.errorMessage ?? null,
      };
    }),
    revisions: { used: pipeline.revisionCount, max: MAX_AUTOMATIC_REVISIONS },
    cost: getCostBreakdown(pipeline.id),
    transitions: listTransitions(pipeline.id),
    checkpoint: open ? describeCheckpoint(pipeline, open) : null,
    decisions: checkpoints
      .filter((entry) => entry.status === 'resolved')
      .map((entry) => ({
        kind: entry.kind,
        label: CHECKPOINTS_BY_KIND[entry.kind]?.label ?? entry.kind,
        resolution: entry.resolution,
        decision: entry.decision,
        decidedAt: entry.decidedAt,
      })),
    finished: isTerminal(pipeline.state),
  };
}

export interface StartOptions {
  themeId: number;
  mode?: PipelineMode;
  /** 'guided' stops at each checkpoint; 'automatic' runs to the end. */
  runMode?: PipelineRunMode;
  /** Optional steer. Omit it and topic research chooses the topics itself. */
  seedTopic?: string | null;
  /**
   * How the steer is treated. 'explore' finds angles within it; 'exact'
   * researches it as the decided subject. Meaningless without a seed topic.
   */
  topicMode?: TopicMode;
  authorId?: number | null;
}

/**
 * Creates a draft and starts a pipeline for it.
 *
 * The draft is deliberately near-empty: title, topic, keywords, article type
 * and brief are all things the pipeline produces. Requiring a person to type
 * them first is exactly what this replaces.
 */
export function startArticlePipeline(options: StartOptions): { pipelineId: number; articleId: number } | { error: string } {
  const theme = getThemeById(options.themeId);
  if (!theme) return { error: 'Thematic area not found.' };

  const mode = options.mode ?? 'production';
  const configuration = validateRoleConfiguration(mode);
  if (!configuration.ready) {
    // Answered before anything is spent, rather than discovered after two
    // paid stages have already run.
    return { error: `The ${mode} models are not fully configured. ${configuration.issues.join(' ')}` };
  }

  // An author is required for the writer to have a voice. Where the area has
  // exactly one, it is chosen — the same rule the manual wizard follows.
  const assigned = listAuthorsForTheme(options.themeId).filter((author) => author.isActive);
  const authorId = options.authorId ?? (assigned.length === 1 ? assigned[0].id : null);
  if (!authorId) {
    return {
      error: assigned.length
        ? 'This thematic area has several authors. Choose which one writes this article.'
        : 'This thematic area has no active author. Assign one before generating.',
    };
  }

  const project = getDefaultProject();
  const draft = createArticleDraft({
    articleTypeId: null,
    authorId,
    productId: null,
    projectId: project?.id ?? null,
    themeId: options.themeId,
    topicId: null,
    title: null,
    topic: options.seedTopic ?? null,
    targetAudience: null,
    searchIntent: null,
    readerPainPoints: null,
    questionsToAnswer: null,
    importantTopics: null,
    notes: null,
    primaryKeyword: null,
    secondaryKeywords: null,
  } as never);

  const pipeline = startPipeline({
    articleId: draft.id,
    mode,
    runMode: options.runMode ?? 'automatic',
    // Only meaningful alongside a steer. Without one there is no idea to be
    // faithful to, so the mode is forced back to exploring.
    topicMode: options.seedTopic?.trim() ? (options.topicMode ?? 'explore') : 'explore',
    themeId: options.themeId,
  });
  return { pipelineId: pipeline.id, articleId: draft.id };
}

export interface AdvanceOptions {
  confirmedCost?: boolean;
  /** Stop after this stage rather than running to completion. */
  stopAfter?: PipelineStage;
}

/** Thrown internally to unwind out of the stage sequence when a decision is needed. */
class AwaitingDecision extends Error {}

/**
 * Runs the pipeline forward from wherever it is.
 *
 * Every stage is called unconditionally; each returns its stored result
 * instantly when it has already succeeded, so this is safe to call repeatedly
 * and safe to call after a restart. Nothing is paid for twice.
 */
export async function advancePipeline(pipelineId: number, options: AdvanceOptions = {}): Promise<PipelineStatus> {
  let pipeline = getPipelineById(pipelineId);
  if (!pipeline) throw new GenerationError('invalid_configuration', 'Pipeline not found.');

  if (isTerminal(pipeline.state)) {
    // A finished run is not restarted by asking again. Starting over is an
    // explicit new version.
    return getPipelineStatus(pipelineId)!;
  }

  const confirmedCost = options.confirmedCost === true;
  const stopAfter = options.stopAfter;
  const shouldStop = (stage: PipelineStage) => stopAfter === stage;

  /**
   * The guided pause.
   *
   * Returns the recorded decision, or opens the checkpoint and unwinds. In an
   * automatic run it opens nothing and returns null, so the caller falls
   * straight through to the recommendation.
   */
  const decisionFor = <T>(kind: CheckpointKind): T | null => {
    const current = getPipelineById(pipelineId)!;
    if (current.runMode !== 'guided') return null;

    const definition = CHECKPOINTS_BY_KIND[kind];
    const existing = getCheckpoint(current.id, current.version, kind);

    if (existing?.status === 'resolved') {
      // 'automatic' means the editor handed the decision back to Cynth. There
      // is no stored answer, and the recommendation stands.
      return existing.resolution === 'automatic' ? null : (existing.decision as T);
    }

    openCheckpoint({ pipelineId: current.id, version: current.version, kind, stage: definition.stage });
    throw new AwaitingDecision(kind);
  };

  try {
    /* ---- research ------------------------------------------------------- */
    const article = getDatabase()
      .prepare('SELECT topic FROM articles WHERE id = ?')
      .get(pipeline.articleId) as { topic: string | null } | undefined;

    const topicSet = (await runTopicResearch(pipelineId, { seedTopic: article?.topic ?? null, confirmedCost }))
      .output as TopicResearchSet;
    if (shouldStop('topic_research')) return getPipelineStatus(pipelineId)!;

    const chosenTopic = applyTopicDecision(topicSet, decisionFor<TopicDecision>('topic'));
    if (isDecisionError(chosenTopic)) {
      throw new GenerationError('invalid_configuration', chosenTopic.error);
    }
    const research: TopicResearch = chosenTopic;

    const keywordOutput = (await runKeywordResearch(pipelineId, research, { confirmedCost }))
      .output as KeywordResearch;
    if (shouldStop('keyword_research')) return getPipelineStatus(pipelineId)!;

    const keywords = applyKeywordDecision(keywordOutput, decisionFor<KeywordDecision>('keywords_title'));

    const classification = (await runClassification(pipelineId, research, keywords, { confirmedCost }))
      .output as ArticleClassification;
    if (shouldStop('article_classification')) return getPipelineStatus(pipelineId)!;

    /* ---- what the pipeline learned, written onto the draft ---------------- */
    // So the article itself reads as a filled-in brief rather than staying blank
    // while the answers sit only in stage output.
    getDatabase()
      .prepare(
        `UPDATE articles SET title = COALESCE(NULLIF(title, ''), ?), topic = ?, target_audience = ?,
           search_intent = ?, important_topics = ?, notes = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        keywords.recommendedTitle,
        research.topic,
        research.audience,
        keywords.searchIntent || research.likelySearchIntent,
        keywords.entities.join(', '),
        research.researchSummary,
        pipeline.articleId,
      );

    const db = getDatabase();
    const existingKeywords = db.prepare('SELECT id FROM keywords WHERE article_id = ?').get(pipeline.articleId);
    if (existingKeywords) {
      db.prepare(
        'UPDATE keywords SET primary_keyword = ?, secondary_keywords = ?, long_tail_keywords = ? WHERE article_id = ?',
      ).run(
        keywords.primaryKeyword,
        keywords.secondaryKeywords.join(', '),
        keywords.longTailKeywords.join(', '),
        pipeline.articleId,
      );
    } else {
      db.prepare(
        'INSERT INTO keywords (article_id, primary_keyword, secondary_keywords, long_tail_keywords) VALUES (?, ?, ?, ?)',
      ).run(
        pipeline.articleId,
        keywords.primaryKeyword,
        keywords.secondaryKeywords.join(', '),
        keywords.longTailKeywords.join(', '),
      );
    }

    /* ---- template and brief (free) --------------------------------------- */
    let template = selectTemplate(pipelineId, classification).output;
    if (shouldStop('template_selection')) return getPipelineStatus(pipelineId)!;

    const templateDecision = decisionFor<TemplateDecision>('template');
    if (templateDecision?.articleType && templateDecision.articleType !== classification.articleType) {
      // Recorded as a human override on the article, which is exactly what
      // the manual path does. The classifier's answer is not rewritten, it is
      // overruled, and both remain readable afterwards.
      const overridden = overrideArticleType(pipeline.articleId, templateDecision.articleType);
      if ('error' in overridden) throw new GenerationError('invalid_configuration', overridden.error);
      template = overridden.selection;
    }

    /* ---- what to go shopping for -------------------------------------- */
    /**
     * Asked only when someone is there to read the answer, and only when this
     * article type has somewhere to put a product.
     *
     * An automatic run has nobody shopping, so paying a model to produce a
     * shopping list nobody will see is spend with no purpose. A trend analysis
     * has no product slots at all, so the question does not arise. Both cases
     * skip the stage rather than running it and discarding the result.
     */
    const runNow = getPipelineById(pipelineId)!;
    const slots = productSlotsFor(template.templateId, template.templateVersion);

    if (runNow.runMode === 'guided' && slots > 0) {
      await runProductOpportunity(
        pipelineId,
        {
          research,
          keywords,
          classification,
          template,
          brief: {
            title: keywords.recommendedTitle,
            audience: research.audience,
            recommendedAngle: research.recommendedAngle,
          },
        },
        { confirmedCost },
      );
    }
    if (shouldStop('product_opportunity')) return getPipelineStatus(pipelineId)!;

    /* ---- products (free) --------------------------------------------- */
    // After the article type is settled, because whether products belong at
    // all is a different question for a buying guide than for a trend
    // analysis. Before the brief, because the writer reads what is attached at
    // the moment it writes.
    const productDecision = decisionFor<ProductDecision>('products');
    if (productDecision) applyProductDecision(pipeline.articleId, productDecision);

    const brief = buildBrief(pipelineId, research, keywords, classification, template).output as ArticleBrief;
    if (shouldStop('article_brief')) return getPipelineStatus(pipelineId)!;

    /* ---- write ------------------------------------------------------------ */
    const written = (await runArticleGeneration(pipelineId, brief, { confirmedCost })).output as GeneratedArticle;
    if (shouldStop('article_generation')) return getPipelineStatus(pipelineId)!;

    /* ---- review ----------------------------------------------------------- */
    const review = (await runArticleReview(pipelineId, brief, written, { confirmedCost })).output as ArticleReview;
    if (shouldStop('article_review')) return getPipelineStatus(pipelineId)!;

    /* ---- at most one revision --------------------------------------------- */
    // Guided or not, the ceiling is the same. A person may decline the
    // revision the reviewer asked for, and may ask for the one revision the
    // reviewer did not — but nobody can reach a second.
    const reviewDecision = decisionFor<ReviewDecision>('review');
    const wantsRevision = reviewDecision ? reviewDecision.action === 'revise' : review.revisionRequired;

    if (wantsRevision) {
      pipeline = getPipelineById(pipelineId)!;
      if (pipeline.revisionCount < MAX_AUTOMATIC_REVISIONS) {
        try {
          await runArticleRevision(pipelineId, written, review, { confirmedCost });
        } catch (error) {
          // A failed revision is a handover, not a retry. The article keeps the
          // draft it had, and a person decides what happens next.
          setState(pipelineId, 'NEEDS_EDITORIAL_ATTENTION', {
            stage: 'article_revision',
            note: error instanceof Error ? error.message : 'The revision failed.',
          });
          return getPipelineStatus(pipelineId)!;
        }
      }
    }

    /* ---- deterministic validation ----------------------------------------- */
    runFinalValidation(pipelineId);
    return getPipelineStatus(pipelineId)!;
  } catch (error) {
    // A checkpoint is not a failure. The run is intact, paid for, and waiting.
    if (error instanceof AwaitingDecision) return getPipelineStatus(pipelineId)!;
    throw error;
  }
}

/**
 * Makes the article's products match the decision exactly.
 *
 * Attaches what was chosen and detaches what was not, so re-deciding is not
 * additive — an editor who removes a product expects it gone, not merely
 * unticked. Only the LINK is touched: the product itself, its research and its
 * images are shared records and survive being detached.
 */
function applyProductDecision(articleId: number, decision: ProductDecision): void {
  const wanted = new Set(decision.productIds);
  const current = new Set(listArticleProducts(articleId).map((row) => row.productId));

  for (const productId of current) {
    if (!wanted.has(productId)) detachProduct(articleId, productId);
  }
  for (const productId of wanted) {
    if (!current.has(productId)) attachProduct(articleId, { productId });
  }
}

/* ------------------------------------------------------- decisions --- */

/**
 * Records an answer and returns the updated status.
 *
 * Advancing afterwards is the caller's choice rather than automatic, because
 * the next stage costs money and the person who just answered a question has
 * not necessarily agreed to spend it.
 */
export function decide(
  pipelineId: number,
  kind: CheckpointKind,
  rawDecision: unknown,
  options: { accepted?: boolean } = {},
): PipelineStatus | { error: string } {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return { error: 'Pipeline not found.' };

  const parsed = readDecision(kind, rawDecision);
  if (isDecisionError(parsed)) return { error: parsed.error };

  // Validated against the options that actually exist, HERE, rather than at
  // advance time. A decision that cannot be honoured must be refused while
  // the person who made it is still looking at the screen.
  if (kind === 'topic') {
    const output = outputOf<TopicResearchSet>(pipeline, 'topic_research');
    if (!output) return { error: 'The topic research has not run yet.' };
    const applied = applyTopicDecision(output, parsed as TopicDecision);
    if (isDecisionError(applied)) return { error: applied.error };
  }

  const recorded = decideCheckpoint(pipeline.id, pipeline.version, kind, {
    resolution: options.accepted === true ? 'accepted' : 'chosen',
    decision: parsed,
  });
  if ('error' in recorded) return recorded;

  return getPipelineStatus(pipelineId)!;
}

/** Switches a run between guided and automatic. Settles anything outstanding. */
export function changeRunMode(pipelineId: number, runMode: PipelineRunMode): PipelineStatus | { error: string } {
  const updated = setRunMode(pipelineId, runMode);
  if (!updated) return { error: 'Pipeline not found.' };
  return getPipelineStatus(pipelineId)!;
}

/**
 * A run that was left unfinished, described well enough to decide whether to
 * pick it up.
 *
 * The identity comes from the run's own stage output rather than from the
 * article row. That is not a shortcut — the article row genuinely has no
 * title or topic yet at this point, because those are written when the writer
 * runs. A run that has researched a topic and chosen a title therefore knows
 * perfectly well what it is about, and this is the only place that says so.
 */
export interface ResumableRun {
  pipelineId: number;
  articleId: number;
  version: number;
  state: PipelineState;
  mode: PipelineMode;
  runMode: PipelineRunMode;
  themeName: string | null;
  /** What the run settled on writing about, once topic research has run. */
  topic: string | null;
  /** The chosen title, or the recommended one when no choice has been made. */
  title: string | null;
  /** The question it is waiting on, when a checkpoint is open. */
  waitingFor: string | null;
  /** The next stage that would run. Null when nothing is left to run. */
  nextStage: string | null;
  failed: boolean;
  note: string | null;
  /** What has already been paid for this run — the reason not to start over. */
  spent: number | null;
  startedAt: string;
}

/**
 * Every run with work left in it, newest first.
 *
 * This exists because a run was previously reachable only by the redirect that
 * followed starting it. Walk away — to change a model in Settings, say — and a
 * live run with paid research in it became unreachable, which read as a dead
 * draft and invited starting over and paying again.
 */
export function listResumableRuns(): ResumableRun[] {
  return listUnfinishedPipelines().map((pipeline) => {
    const checkpoints = listCheckpoints(pipeline.id, pipeline.version);
    const open = checkpoints.find((entry) => entry.status === 'open') ?? null;

    const research = outputOf<TopicResearchSet>(pipeline, 'topic_research');
    const keywords = outputOf<KeywordResearch>(pipeline, 'keyword_research');

    // The title the editor actually chose wins over the model's recommendation.
    const chosenTitle = checkpoints.find(
      (entry) => entry.kind === 'keywords_title' && entry.status === 'resolved',
    )?.decision as { title?: string } | undefined;

    // The first stage with no successful run is what a Continue would do next.
    let nextStage: string | null = null;
    for (const stage of PIPELINE_STAGES) {
      if (!findCompletedStage(pipeline.id, pipeline.version, stage)) {
        nextStage = STAGE_DEFINITIONS[stage].label;
        break;
      }
    }

    const cost = getCostBreakdown(pipeline.id);

    return {
      pipelineId: pipeline.id,
      articleId: pipeline.articleId,
      version: pipeline.version,
      state: pipeline.state,
      mode: pipeline.mode,
      runMode: pipeline.runMode,
      themeName: pipeline.themeId ? (getThemeById(pipeline.themeId)?.name ?? null) : null,
      topic: research?.topic ?? null,
      title: chosenTitle?.title ?? keywords?.recommendedTitle ?? null,
      waitingFor: open ? (CHECKPOINTS_BY_KIND[open.kind]?.label ?? open.kind) : null,
      nextStage,
      failed: pipeline.state === 'FAILED',
      note: pipeline.outcomeNote,
      spent: cost && cost.totalCost > 0 ? cost.totalCost : null,
      startedAt: pipeline.startedAt,
    };
  });
}

/** The current pipeline for an article, if one exists. */
export function statusForArticle(articleId: number): PipelineStatus | null {
  const pipeline = getCurrentPipeline(articleId);
  return pipeline ? getPipelineStatus(pipeline.id) : null;
}

/** The stage outputs, for the observability view. */
export function getPipelineOutputs(pipelineId: number): Record<string, unknown> | null {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return null;

  const outputs: Record<string, unknown> = {};
  for (const stage of PIPELINE_STAGES) {
    const value = outputOf<unknown>(pipeline, stage);
    if (value !== null) outputs[stage] = value;
  }
  return outputs;
}

/**
 * Asks a stage for a different set of options.
 *
 * This is the one place a completed paid stage is deliberately run again, and
 * it is deliberately narrow:
 *
 *   - only for a checkpoint that is currently OPEN, so nothing downstream has
 *     been built on the answer that is about to be replaced;
 *   - only for stages declared rerunnable, because rerunning a deterministic
 *     step would return the same answer at no benefit;
 *   - and through the ordinary stage runner, so the second execution passes
 *     the same spend gate as the first. There is no cheaper path here.
 *
 * The previous attempt is not deleted. It stays in the run history with what
 * it cost, because money spent on options nobody chose was still spent.
 */
export async function rerunForCheckpoint(
  pipelineId: number,
  kind: CheckpointKind,
  options: { confirmedCost?: boolean } = {},
): Promise<PipelineStatus | { error: string }> {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return { error: 'Pipeline not found.' };

  const definition = CHECKPOINTS_BY_KIND[kind];
  if (!definition) return { error: 'Cynth does not ask for that decision.' };
  if (!definition.rerunnable) {
    return { error: `${definition.label} is decided by Cynth rather than generated, so there is nothing new to ask for.` };
  }

  const checkpoint = getCheckpoint(pipeline.id, pipeline.version, kind);
  if (!checkpoint || checkpoint.status !== 'open') {
    return { error: 'That decision is not open, so its options cannot be replaced.' };
  }

  const confirmedCost = options.confirmedCost === true;

  if (kind === 'topic') {
    const article = getDatabase()
      .prepare('SELECT topic FROM articles WHERE id = ?')
      .get(pipeline.articleId) as { topic: string | null } | undefined;
    await runTopicResearch(pipelineId, { seedTopic: article?.topic ?? null, confirmedCost, rerun: true });
    return getPipelineStatus(pipelineId)!;
  }

  if (kind === 'keywords_title') {
    const topicSet = outputOf<TopicResearchSet>(pipeline, 'topic_research');
    if (!topicSet) return { error: 'The topic research is missing, so the keywords cannot be redone.' };

    // The keyword stage reads the CHOSEN topic, so the earlier decision is
    // replayed rather than the recommendation being silently reused.
    const topicCheckpoint = getCheckpoint(pipeline.id, pipeline.version, 'topic');
    const topicDecision =
      topicCheckpoint?.status === 'resolved' && topicCheckpoint.resolution !== 'automatic'
        ? (topicCheckpoint.decision as TopicDecision)
        : null;

    const research = applyTopicDecision(topicSet, topicDecision);
    if (isDecisionError(research)) return { error: research.error };

    await runKeywordResearch(pipelineId, research, { confirmedCost, rerun: true });
    return getPipelineStatus(pipelineId)!;
  }

  return { error: `Cynth cannot produce new ${definition.label.toLowerCase()} options.` };
}

/**
 * Reopens a run that a stage failure ended, WITHOUT starting a new version.
 *
 * There is still no retry loop: nothing here runs a stage, and nothing retries
 * on its own. It moves the state back to where the last successful stage left
 * it, so an explicit Continue can try the failed stage again.
 *
 * It exists because the alternative was worse. A transient provider failure —
 * an empty response, a timeout — made the run terminal, and the only way
 * forward was a new version, which re-runs every stage from the beginning.
 * That means paying a second time for research that succeeded, and discarding
 * decisions already made about it. Completed stages are idempotent, so
 * resuming re-runs only what actually failed.
 */
export function resumeAfterFailure(pipelineId: number): PipelineStatus | { error: string } {
  const pipeline = getPipelineById(pipelineId);
  if (!pipeline) return { error: 'Pipeline not found.' };

  if (pipeline.state !== 'FAILED') {
    return { error: 'This run has not failed, so there is nothing to resume.' };
  }

  // Where the run actually got to, read from the stages that succeeded rather
  // than from the state, which now says FAILED.
  let resumeState: PipelineState = 'DRAFT';
  let lastStage: PipelineStage | null = null;
  for (const stage of PIPELINE_STAGES) {
    if (!findCompletedStage(pipeline.id, pipeline.version, stage)) break;
    resumeState = STAGE_DEFINITIONS[stage].completeState;
    lastStage = stage;
  }

  setState(pipelineId, resumeState, {
    stage: lastStage,
    note: lastStage
      ? `Resumed after a failure. ${STAGE_DEFINITIONS[lastStage].label} and everything before it are kept; only the failed stage will run again.`
      : 'Resumed after a failure. Nothing had completed yet, so the run starts from the first stage.',
  });

  return getPipelineStatus(pipelineId)!;
}
