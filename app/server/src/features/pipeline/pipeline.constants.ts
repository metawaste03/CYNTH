/**
 * THE EDITORIAL PIPELINE — states, stages and roles (Milestone 20).
 *
 * Cynth owns orchestration; models own thinking. This file is the vocabulary
 * of the orchestration half, and everything in it is deliberately explicit:
 * a state a run can be in, a stage that can be executed, and a role a model
 * can be assigned to. Nothing here decides what to write.
 *
 * The two numbers that make this a controlled engine rather than a loop —
 * MAX_AUTOMATIC_REVISIONS and MAX_AUTOMATIC_REVIEWS — live here, and the
 * pipeline service enforces them in backend code rather than in a prompt.
 */

/* ------------------------------------------------------------- the cap --- */

/**
 * The hard ceiling on automatic revisions. ONE.
 *
 * Write -> review -> pass, or write -> review -> one surgical revision ->
 * deterministic validation -> stop. There is no path that reaches a second
 * revision, and none that reaches a second review: after the revision the
 * article is validated by code, not by a model.
 *
 * This is a product decision, not a tunable. It is exported as a constant so
 * that the limit is checkable in one place, and the pipeline refuses to
 * exceed it even if a caller asks.
 */
export const MAX_AUTOMATIC_REVISIONS = 1;

/** One review, before the one permitted revision. Nothing reviews the revision. */
export const MAX_AUTOMATIC_REVIEWS = 1;

/* ------------------------------------------------------------- states --- */

/**
 * Every state an article pipeline can occupy.
 *
 * Persisted on every transition, so a run is resumable and its history is
 * answerable. The terminal states are READY, NEEDS_EDITORIAL_ATTENTION and
 * FAILED — and the middle one is not a failure: it means the automatic budget
 * was spent and a human now decides.
 */
export const PIPELINE_STATES = [
  'DRAFT',
  'RESEARCHING',
  'RESEARCH_COMPLETE',
  'SEO_RESEARCHING',
  'SEO_COMPLETE',
  'CLASSIFYING',
  'CLASSIFIED',
  'BRIEF_READY',
  'TEMPLATE_SELECTED',
  'IDENTIFYING_PRODUCTS',
  'GENERATING',
  'GENERATED',
  'AMAZON_MATCHING',
  'PRODUCTS_READY',
  'REVIEWING',
  'REVIEW_COMPLETE',
  'REVISION_REQUIRED',
  'REVISING',
  'FINAL_VALIDATION',
  'READY',
  'NEEDS_EDITORIAL_ATTENTION',
  'FAILED',
] as const;

export type PipelineState = (typeof PIPELINE_STATES)[number];

/**
 * How topic research treats the idea the editor supplied.
 *
 * 'explore' — the idea is a direction. Research proposes distinct angles
 * within it and the editor picks one. This is the default, and what a steer
 * has always meant.
 *
 * 'exact' — the editor has already decided the subject. Research is still
 * real research: audience, gap, angle, intent and honest doubts are all
 * produced. What it must not do is substitute a different, adjacent subject it
 * finds more promising. An idea worth typing in full is not a prompt for
 * brainstorming.
 */
export const TOPIC_MODES = ['explore', 'exact'] as const;
export type TopicMode = (typeof TOPIC_MODES)[number];

/** States from which no automatic work continues. */
export const TERMINAL_STATES: readonly PipelineState[] = [
  'READY',
  'NEEDS_EDITORIAL_ATTENTION',
  'FAILED',
];

export function isTerminal(state: PipelineState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * Whether a run still has work an editor can pick up.
 *
 * Deliberately NOT the inverse of `isTerminal`, and the difference is the
 * whole point. Terminal means nothing continues on its own; resumable means a
 * person can still act on it. FAILED is both: no stage will run by itself, but
 * fixing what broke and resuming is exactly what a person does with it.
 *
 * READY has finished. NEEDS_EDITORIAL_ATTENTION is waiting on a human editor
 * rather than on another stage, so no amount of resuming moves it.
 */
export function isResumable(state: PipelineState): boolean {
  return state === 'FAILED' || !isTerminal(state);
}

/* ------------------------------------------------------------- stages --- */

/**
 * The executable stages, in pipeline order.
 *
 * A stage is a unit of work that either costs money or produces persisted
 * output — which is also the unit idempotency is keyed on. `paid` marks the
 * ones that call a model, because those are the ones that must never re-run
 * by accident.
 */
export interface StageDefinition {
  stage: PipelineStage;
  label: string;
  /** Whether this stage calls a model and can therefore cost money. */
  paid: boolean;
  /** The role whose model runs it. Null for stages Cynth performs itself. */
  role: PipelineRole | null;
  /** The state while running, and the state on success. */
  runningState: PipelineState;
  completeState: PipelineState;
}

export const PIPELINE_STAGES = [
  'topic_research',
  'keyword_research',
  'article_classification',
  'article_brief',
  'template_selection',
  'product_opportunity',
  'article_generation',
  'amazon_matching',
  'article_review',
  'article_revision',
  'final_validation',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/* -------------------------------------------------------------- roles --- */

/**
 * The roles a model can be assigned to.
 *
 * Separate from the older MODEL_PURPOSES capability set: a capability says
 * what a model is ABLE to do, a role says what it IS DOING in this pipeline,
 * for this mode. Keeping them apart is what lets one model hold several
 * capabilities while a role has exactly one primary and one fallback.
 */
export const PIPELINE_ROLES = [
  'topic_research',
  'keyword_research',
  'title_selection',
  'article_writer',
  'article_reviewer',
  'article_revision',
] as const;

export type PipelineRole = (typeof PIPELINE_ROLES)[number];

export const ROLE_META: Record<PipelineRole, { label: string; description: string; costGuidance: string }> = {
  topic_research: {
    label: 'Topic Research',
    description:
      'Researches a theme, finds topics worth producing, and judges search and commercial opportunity. One of the two stages where model quality most affects the finished article.',
    costGuidance: 'Highest quality',
  },
  keyword_research: {
    label: 'Keyword Research',
    description:
      'Turns the topic research into keywords, entities and search questions. A narrower, more structured task performed on a strong model\'s output, so it does not need a flagship model.',
    costGuidance: 'Lowest-cost capable paid model',
  },
  title_selection: {
    label: 'Title Selection',
    description: 'Proposes and recommends titles and headings from the keyword research.',
    costGuidance: 'Lowest-cost capable paid model',
  },
  article_writer: {
    label: 'Article Writer',
    description:
      'Writes the article from the complete brief, in the author\'s voice and to the selected template. The other stage where model quality most affects the result.',
    costGuidance: 'Highest quality',
  },
  article_reviewer: {
    label: 'Article Reviewer',
    description:
      'Independently critiques the finished draft and produces a structured revision specification. Preferably a different model family from the writer.',
    costGuidance: 'High quality',
  },
  article_revision: {
    label: 'Article Revision',
    description:
      'Applies the reviewer\'s specification surgically. Runs at most once per pipeline, and edits rather than regenerates.',
    costGuidance: 'High quality',
  },
};

/**
 * Which role runs which stage.
 *
 * `title_selection` shares the keyword stage: the spec pairs them, and running
 * one model over one combined structured task is both cheaper and less
 * error-prone than two round trips over the same inputs. It remains a separate
 * ROLE so it can be reassigned independently later.
 */
export const STAGE_DEFINITIONS: Record<PipelineStage, StageDefinition> = {
  topic_research: {
    stage: 'topic_research',
    label: 'Topic Research',
    paid: true,
    role: 'topic_research',
    runningState: 'RESEARCHING',
    completeState: 'RESEARCH_COMPLETE',
  },
  keyword_research: {
    stage: 'keyword_research',
    label: 'Keyword & Title Research',
    paid: true,
    role: 'keyword_research',
    runningState: 'SEO_RESEARCHING',
    completeState: 'SEO_COMPLETE',
  },
  article_classification: {
    stage: 'article_classification',
    label: 'Article Type',
    paid: true,
    role: 'keyword_research',
    runningState: 'CLASSIFYING',
    completeState: 'CLASSIFIED',
  },
  article_brief: {
    stage: 'article_brief',
    label: 'Article Brief',
    // Assembled by Cynth from what the paid stages already produced. No model.
    paid: false,
    role: null,
    runningState: 'CLASSIFIED',
    completeState: 'BRIEF_READY',
  },
  template_selection: {
    stage: 'template_selection',
    label: 'Template',
    paid: false,
    role: null,
    runningState: 'BRIEF_READY',
    completeState: 'TEMPLATE_SELECTED',
  },
  product_opportunity: {
    stage: 'product_opportunity',
    label: 'Product Opportunities',
    paid: true,
    /**
     * Shares the keyword model rather than adding a seventh role.
     *
     * This is the same shape of task the keyword role already does: one
     * narrow, structured question asked of a stronger model's output, needing
     * judgement rather than flagship reasoning. Adding a role would also make
     * every existing installation report itself unconfigured until the new
     * role was assigned, which is a poor trade for a naming distinction.
     */
    role: 'keyword_research',
    runningState: 'IDENTIFYING_PRODUCTS',
    completeState: 'PRODUCTS_READY',
  },
  article_generation: {
    stage: 'article_generation',
    label: 'Article Generation',
    paid: true,
    role: 'article_writer',
    runningState: 'GENERATING',
    completeState: 'GENERATED',
  },
  amazon_matching: {
    stage: 'amazon_matching',
    label: 'Amazon Product Matching',
    // Amazon's API, not a model. It can fail, but it cannot cost model spend.
    paid: false,
    role: null,
    runningState: 'AMAZON_MATCHING',
    completeState: 'PRODUCTS_READY',
  },
  article_review: {
    stage: 'article_review',
    label: 'Review',
    paid: true,
    role: 'article_reviewer',
    runningState: 'REVIEWING',
    completeState: 'REVIEW_COMPLETE',
  },
  article_revision: {
    stage: 'article_revision',
    label: 'Revision',
    paid: true,
    role: 'article_revision',
    runningState: 'REVISING',
    completeState: 'FINAL_VALIDATION',
  },
  final_validation: {
    stage: 'final_validation',
    label: 'Final Validation',
    // Deterministic. This is what replaces a second review.
    paid: false,
    role: null,
    runningState: 'FINAL_VALIDATION',
    completeState: 'READY',
  },
};

/* --------------------------------------------------------------- modes --- */

/**
 * Development and Production differ ONLY in which models the roles resolve to.
 *
 * The stages, the states, the caps and the validation are identical, so a
 * pipeline exercised in Development is the same pipeline that runs in
 * Production — which is the point of having the distinction at all.
 */
export const PIPELINE_MODES = ['development', 'production'] as const;
export type PipelineMode = (typeof PIPELINE_MODES)[number];

/* ---------------------------------------------------------- article types */

/**
 * The article types the classifier may choose from.
 *
 * Data, not behaviour: each maps to a default template in the template
 * registry, and adding a type is a row there plus an entry here.
 */
export const ARTICLE_TYPE_SLUGS = [
  'how-to',
  'ultimate-guide',
  'explainer',
  'comparison',
  'product-review',
  'buying-guide',
  'listicle',
  'evidence-based-analysis',
  'problem-solution',
  'case-study',
  'trend-analysis',
  'myth-vs-fact',
] as const;

export type ArticleTypeSlug = (typeof ARTICLE_TYPE_SLUGS)[number];

export function isValidState(value: unknown): value is PipelineState {
  return typeof value === 'string' && (PIPELINE_STATES as readonly string[]).includes(value);
}

export function isValidStage(value: unknown): value is PipelineStage {
  return typeof value === 'string' && (PIPELINE_STAGES as readonly string[]).includes(value);
}

export function isValidRole(value: unknown): value is PipelineRole {
  return typeof value === 'string' && (PIPELINE_ROLES as readonly string[]).includes(value);
}

/* --------------------------------------------------------- run modes --- */

/**
 * How a run is driven (Milestone 24).
 *
 * AUTOMATIC is the original behaviour: start it and it runs to READY.
 * GUIDED stops at every checkpoint below and waits for a person, so the
 * editor chooses the topic, the title and the keywords rather than reading
 * about them afterwards.
 *
 * The mode changes WHO decides. It changes nothing about what the stages do,
 * what they cost, or what they are allowed to do — every gate in the stage
 * runner applies identically in both.
 */
export const PIPELINE_RUN_MODES = ['automatic', 'guided'] as const;
export type PipelineRunMode = (typeof PIPELINE_RUN_MODES)[number];

/* ------------------------------------------------------- checkpoints --- */

/**
 * The points where a guided run pauses and asks.
 *
 * A checkpoint always sits AFTER the stage that produced what is being
 * decided, so the editor is choosing between real options the pipeline has
 * actually generated rather than answering a blank form. That ordering is the
 * whole design: research first, decide second.
 *
 * Adding a checkpoint means adding an entry here and a resolver in
 * checkpoints.service.ts. Nothing in the orchestrator hardcodes the list.
 */
export const CHECKPOINT_KINDS = ['topic', 'keywords_title', 'template', 'products', 'review'] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export interface CheckpointDefinition {
  kind: CheckpointKind;
  /** The stage whose stored output supplies the options. */
  stage: PipelineStage;
  label: string;
  question: string;
  /**
   * Whether asking again for different options is possible.
   *
   * True only where a model produced the options, because getting new ones
   * means paying for that stage a second time. False for decisions Cynth
   * makes deterministically, where a rerun would return the same answer.
   */
  rerunnable: boolean;
}

export const CHECKPOINT_DEFINITIONS: readonly CheckpointDefinition[] = [
  {
    kind: 'topic',
    stage: 'topic_research',
    label: 'Topic',
    question: 'Which of these topics should Cynth write about?',
    rerunnable: true,
  },
  {
    kind: 'keywords_title',
    stage: 'keyword_research',
    label: 'Title and keywords',
    question: 'Choose the title, and adjust the keywords the article will target.',
    rerunnable: true,
  },
  {
    kind: 'template',
    stage: 'template_selection',
    label: 'Article type',
    question: 'Cynth classified this article. Change the type if it read the topic wrongly.',
    rerunnable: false,
  },
  {
    kind: 'products',
    // Sits behind template selection because that is the last stage to
    // complete before it, not because the options come from there — they come
    // from the product registry. It is placed AFTER the article type is
    // settled on purpose: whether products belong at all, and how many, is a
    // different question for a buying guide than for a trend analysis.
    stage: 'template_selection',
    label: 'Products',
    question: 'Which products should this article be able to recommend?',
    // Nothing is generated, so there are no different options to ask for.
    rerunnable: false,
  },
  {
    kind: 'review',
    stage: 'article_review',
    label: 'Review',
    question: 'The reviewer has read the draft. Accept it, or spend the one revision.',
    rerunnable: false,
  },
];

export const CHECKPOINTS_BY_KIND: Record<CheckpointKind, CheckpointDefinition> = Object.fromEntries(
  CHECKPOINT_DEFINITIONS.map((definition) => [definition.kind, definition]),
) as Record<CheckpointKind, CheckpointDefinition>;

/** How a checkpoint was settled. Recorded so an automatic choice is never mistaken for a human one. */
export const CHECKPOINT_RESOLUTIONS = ['chosen', 'accepted', 'automatic'] as const;
export type CheckpointResolution = (typeof CHECKPOINT_RESOLUTIONS)[number];
