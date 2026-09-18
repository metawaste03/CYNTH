import { CHECKPOINTS_BY_KIND } from './pipeline.constants.js';
import type { CheckpointKind } from './pipeline.constants.js';
import { ARTICLE_TYPE_SLUGS } from './pipeline.constants.js';
import type { ArticleClassification, KeywordResearch, TopicResearch, TopicResearchSet } from './stages/researchStages.service.js';
import type { TemplateSelection } from './stages/briefStages.service.js';
import type { ArticleReview } from './stages/generationStages.service.js';
import type { ProductOpportunity } from './stages/productOpportunity.service.js';

/**
 * WHAT A CHECKPOINT ASKS, AND WHAT AN ANSWER MEANS (Milestone 24).
 *
 * Two halves, deliberately kept apart from both the orchestrator and the
 * stages:
 *
 *   BUILD — turn a stage's stored output into the options a person sees.
 *   APPLY — turn their answer back into the value the next stage consumes.
 *
 * Nothing here calls a model, and nothing here can invent an option. Every
 * choice offered was produced by a stage that already ran and was already
 * paid for; a decision can only select among them or state an explicit
 * override. That is what stops a "choice" from quietly becoming a second
 * generation.
 *
 * Validation is strict on purpose. A decision naming a topic that does not
 * exist is refused rather than rounded to the nearest one, because silently
 * writing a different article than the one the editor picked is worse than
 * an error message.
 */

export interface DecisionError {
  error: string;
}

function isError<T>(value: T | DecisionError): value is DecisionError {
  return Boolean(value) && typeof value === 'object' && 'error' in (value as object);
}

/* --------------------------------------------------------------- topic --- */

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

export function buildTopicOptions(output: TopicResearchSet): TopicOptions {
  const candidates = output.candidates ?? [output];
  return {
    recommendedIndex: output.recommendedIndex ?? 0,
    candidates: candidates.map((candidate, index) => ({
      index,
      topic: candidate.topic,
      recommendedAngle: candidate.recommendedAngle,
      whyNow: candidate.whyNow,
      audience: candidate.audience,
      searchOpportunity: candidate.searchOpportunity,
      commercialOpportunity: candidate.commercialOpportunity,
      contentGap: candidate.contentGap,
      likelySearchIntent: candidate.likelySearchIntent,
      researchSummary: candidate.researchSummary,
      // The count rather than the sources themselves: enough to judge how
      // grounded a candidate is without turning the chooser into a reading
      // exercise. The full research travels with the article regardless.
      sourceCount: candidate.researchSources.length,
    })),
  };
}

export type TopicDecision = { index: number } | { customTopic: string; customAngle?: string };

/**
 * Turns the answer into the single TopicResearch the rest of the pipeline
 * consumes.
 *
 * A CUSTOM topic is handled carefully. Cynth has not researched it, and it
 * must never look as though it had: the researched fields that cannot honestly
 * carry over are cleared, and the summary says plainly where the topic came
 * from. Keyword research downstream reads that summary, so the model is told
 * the truth too.
 */
export function applyTopicDecision(
  output: TopicResearchSet,
  decision: TopicDecision | null,
): TopicResearch | DecisionError {
  const candidates = output.candidates ?? [output];

  if (!decision) return candidates[output.recommendedIndex ?? 0] ?? output;

  if ('customTopic' in decision) {
    const topic = decision.customTopic.trim();
    if (!topic) return { error: 'A topic of your own cannot be blank.' };

    const base = candidates[output.recommendedIndex ?? 0] ?? output;
    return {
      ...base,
      topic,
      recommendedAngle: decision.customAngle?.trim() || base.recommendedAngle,
      researchSummary: `This topic was set by the editor rather than chosen from Cynth's research, so it has not been researched. Cynth's research for this thematic area was: ${base.researchSummary}`,
      // Not carried over: these described a different topic, and repeating
      // them here would attach evidence to an article it was never about.
      researchSources: [],
      competingContentObservations: [],
      whyNow: '',
      contentGap: '',
    };
  }

  const index = decision.index;
  if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
    return { error: `There is no topic ${index} in this shortlist.` };
  }
  return candidates[index];
}

/* ------------------------------------------------------ keywords/title --- */

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

export function buildKeywordOptions(output: KeywordResearch): KeywordOptions {
  // The recommendation always appears among the choices, even when the model
  // left it out of its own candidate list — otherwise the default answer is
  // not on the ballot.
  const titles = [output.recommendedTitle, ...output.titleCandidates].filter(
    (title, index, all) => title.trim().length > 0 && all.indexOf(title) === index,
  );

  return {
    titleCandidates: titles,
    recommendedTitle: output.recommendedTitle,
    primaryKeyword: output.primaryKeyword,
    secondaryKeywords: output.secondaryKeywords,
    longTailKeywords: output.longTailKeywords,
    relatedQuestions: output.relatedQuestions,
    entities: output.entities,
    searchIntent: output.searchIntent,
    seoNotes: output.seoNotes,
  };
}

export interface KeywordDecision {
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  longTailKeywords: string[];
}

function cleanList(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 300))
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .slice(0, max);
}

export function readKeywordDecision(raw: unknown): KeywordDecision | DecisionError {
  const body = (raw ?? {}) as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const primaryKeyword = typeof body.primaryKeyword === 'string' ? body.primaryKeyword.trim() : '';

  if (!title) return { error: 'Choose a title, or type one of your own.' };
  if (!primaryKeyword) return { error: 'The article needs a primary keyword.' };

  return {
    title: title.slice(0, 300),
    primaryKeyword: primaryKeyword.slice(0, 200),
    secondaryKeywords: cleanList(body.secondaryKeywords, 25),
    longTailKeywords: cleanList(body.longTailKeywords, 25),
  };
}

/**
 * Applies the edited keyword plan.
 *
 * Only the four fields a person actually decided are replaced. Everything
 * else the SEO stage produced — entities, semantic terms, the questions, the
 * notes to the writer — is preserved, because dropping researched context
 * because someone renamed a title would quietly make the article worse.
 */
export function applyKeywordDecision(output: KeywordResearch, decision: KeywordDecision | null): KeywordResearch {
  if (!decision) return output;
  return {
    ...output,
    recommendedTitle: decision.title,
    primaryKeyword: decision.primaryKeyword,
    secondaryKeywords: decision.secondaryKeywords,
    longTailKeywords: decision.longTailKeywords,
  };
}

/* ------------------------------------------------------------ template --- */

export interface TemplateOptions {
  articleType: string;
  confidence: number;
  reasoning: string;
  templateId: string;
  templateName: string;
  /** True when no template exists for this type and a near neighbour is being used. */
  borrowed: boolean;
  sectionKeys: string[];
  availableTypes: readonly string[];
}

export function buildTemplateOptions(
  classification: ArticleClassification,
  selection: TemplateSelection,
): TemplateOptions {
  return {
    articleType: classification.articleType,
    confidence: classification.confidence,
    reasoning: classification.reasoningSummary,
    templateId: selection.templateId,
    templateName: selection.name,
    borrowed: selection.borrowed,
    sectionKeys: selection.sectionKeys,
    availableTypes: ARTICLE_TYPE_SLUGS,
  };
}

export interface TemplateDecision {
  /** Null means the classifier's answer stands. */
  articleType: string | null;
}

export function readTemplateDecision(raw: unknown): TemplateDecision | DecisionError {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (body.articleType === undefined || body.articleType === null || body.articleType === '') {
    return { articleType: null };
  }
  const slug = String(body.articleType).trim();
  if (!(ARTICLE_TYPE_SLUGS as readonly string[]).includes(slug)) {
    return { error: `${slug} is not an article type Cynth has a template for.` };
  }
  return { articleType: slug };
}

/* ------------------------------------------------------------ products --- */

/**
 * A product the editor can put in front of the writer.
 *
 * `readiness` is the field that matters. A product with nothing recorded about
 * what it is FOR can only be placed decoratively, and the editor should know
 * that before choosing it rather than discovering it in the finished draft.
 */
export interface ProductOption {
  productId: number;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  themeId: number | null;
  themeName: string | null;
  /** True when the product belongs to this article's thematic area. */
  matchesTheme: boolean;
  useCase: string | null;
  problemSolved: string | null;
  /** 'ready' when the writer has something to place it on; 'thin' when it does not. */
  readiness: 'ready' | 'thin';
  /** What is missing, when something is. */
  readinessNote: string | null;
  alreadyAttached: boolean;
}

export interface ProductOptions {
  /**
   * What kinds of product this article could carry, proposed from the article
   * itself before anything was chosen (Milestone 28).
   *
   * Categories, never specific products — this is a brief for the editor to
   * shop against, not a recommendation. Empty when the stage was skipped, or
   * when the honest answer was that this article needs none.
   */
  opportunities: ProductOpportunity[];
  /** Why the pipeline thinks this article does or does not warrant products. */
  opportunityAssessment: string | null;
  themeId: number | null;
  themeName: string | null;
  /** Products filed under this article's area. The list the editor is expected to choose from. */
  inTheme: ProductOption[];
  /** Everything else, so a product filed elsewhere or nowhere is still reachable. */
  others: ProductOption[];
  attachedProductIds: number[];
  /** How many slots this article's template actually has for a product. */
  placementSlots: number;
  /** The house guidance, stated where the choice is made. Not enforced. */
  suggested: string;
}

function readinessOf(product: {
  useCase: string | null;
  problemSolved: string | null;
  shortDescription: string | null;
  description: string | null;
  editorialFit: string | null;
}): { readiness: 'ready' | 'thin'; readinessNote: string | null } {
  if (product.useCase || product.problemSolved) return { readiness: 'ready', readinessNote: null };

  if (product.shortDescription || product.description || product.editorialFit) {
    return {
      readiness: 'thin',
      readinessNote:
        'This has a description but no "what it is for" or "problem it solves". The writer can mention it, but placing it well is harder.',
    };
  }

  return {
    readiness: 'thin',
    readinessNote:
      'Nothing is recorded about what this product is for, so the writer has no basis for placing it. Fill in "What it is for" on the product first.',
  };
}

export function toProductOption(
  product: {
    id: number;
    title: string;
    brand: string | null;
    themeId: number | null;
    themeName: string | null;
    useCase: string | null;
    problemSolved: string | null;
    shortDescription: string | null;
    description: string | null;
    editorialFit: string | null;
    sourceImageUrl: string | null;
  },
  options: { articleThemeId: number | null; imageUrl: string | null; attached: boolean },
): ProductOption {
  return {
    productId: product.id,
    title: product.title,
    brand: product.brand,
    imageUrl: options.imageUrl ?? product.sourceImageUrl,
    themeId: product.themeId,
    themeName: product.themeName,
    matchesTheme: options.articleThemeId !== null && product.themeId === options.articleThemeId,
    useCase: product.useCase,
    problemSolved: product.problemSolved,
    ...readinessOf(product),
    alreadyAttached: options.attached,
  };
}

export interface ProductDecision {
  productIds: number[];
}

export function readProductDecision(raw: unknown): ProductDecision | DecisionError {
  const body = (raw ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(body.productIds) ? body.productIds : [];

  const productIds = ids
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 50);

  // An empty list is a legitimate answer, and a common one: most articles
  // carry no products. It is recorded as a decision rather than refused.
  return { productIds };
}

/* -------------------------------------------------------------- review --- */

export interface ReviewOptions {
  overallScore: number;
  summary: string;
  revisionRequired: boolean;
  strengths: string[];
  issues: { severity: string; section: string; problem: string; requiredChange: string }[];
  /** Stated on the option itself, so the cost of choosing it is never a surprise. */
  revisionsRemaining: number;
}

export function buildReviewOptions(review: ArticleReview, revisionsRemaining: number): ReviewOptions {
  return {
    overallScore: review.overallScore,
    summary: review.summary,
    revisionRequired: review.revisionRequired,
    strengths: review.strengths,
    issues: review.issues.map((issue) => ({
      severity: issue.severity,
      section: issue.section,
      problem: issue.problem,
      requiredChange: issue.requiredChange,
    })),
    revisionsRemaining,
  };
}

export interface ReviewDecision {
  action: 'accept' | 'revise';
}

export function readReviewDecision(raw: unknown): ReviewDecision | DecisionError {
  const action = (raw as Record<string, unknown> | null)?.action;
  if (action !== 'accept' && action !== 'revise') {
    return { error: 'Choose whether to accept the draft or spend the revision.' };
  }
  return { action };
}

/* ------------------------------------------------------------ dispatch --- */

/**
 * Validates a raw decision body for a kind.
 *
 * One entry point so a route never has to know the shape of any particular
 * decision, and so an unknown kind is refused rather than stored unvalidated.
 */
export function readDecision(kind: CheckpointKind, raw: unknown): unknown | DecisionError {
  switch (kind) {
    case 'topic': {
      const body = (raw ?? {}) as Record<string, unknown>;
      if (typeof body.customTopic === 'string' && body.customTopic.trim()) {
        return {
          customTopic: body.customTopic.trim().slice(0, 300),
          customAngle: typeof body.customAngle === 'string' ? body.customAngle.trim().slice(0, 500) : undefined,
        };
      }
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0) return { error: 'Choose one of the topics, or type your own.' };
      return { index };
    }
    case 'keywords_title':
      return readKeywordDecision(raw);
    case 'template':
      return readTemplateDecision(raw);
    case 'products':
      return readProductDecision(raw);
    case 'review':
      return readReviewDecision(raw);
    default:
      return { error: `${kind} is not a decision Cynth asks for.` };
  }
}

export { isError as isDecisionError };
export function labelFor(kind: CheckpointKind): string {
  return CHECKPOINTS_BY_KIND[kind]?.label ?? kind;
}
