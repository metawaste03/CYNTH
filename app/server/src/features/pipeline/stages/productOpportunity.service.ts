import { runStage } from '../stageRunner.service.js';
import type { StageResult } from '../stageRunner.service.js';
import { getPipelineById, setState } from '../pipeline.repository.js';
import { STAGE_DEFINITIONS } from '../pipeline.constants.js';
import { isSpendRefusal } from '../../generation/generation.errors.js';
import type { ArticleBrief, TemplateSelection } from './briefStages.service.js';
import type { ArticleClassification, KeywordResearch, TopicResearch } from './researchStages.service.js';

/**
 * WHAT TO GO SHOPPING FOR (Milestone 28).
 *
 * The reverse of the product workflow Cynth already had. Everything until now
 * started from products the editor had already found and asked where they
 * belong. This starts from the ARTICLE and asks what kind of product a reader
 * of it would want — so the editor knows what to search for before owning
 * anything.
 *
 * Three rules make the output usable rather than decorative:
 *
 *   1. CATEGORIES, NEVER PRODUCTS. It proposes "clumping cat litter", not
 *      "Dr Elsey's Ultra". A model asked for specific products invents
 *      plausible ones — wrong model numbers, discontinued lines, prices that
 *      were never real — and this is the failure Milestone 19 exists to
 *      prevent. A category cannot be hallucinated in the same way: it is a
 *      description of a need, and the editor supplies the real product.
 *
 *   2. TIED TO A SECTION. Each suggestion names the section of THIS article's
 *      template it would serve. A suggestion with nowhere to go is a shopping
 *      idea, not an editorial one.
 *
 *   3. AN EMPTY LIST IS A VALID ANSWER. Plenty of articles should carry no
 *      products, and a model that always finds four is not answering the
 *      question.
 *
 * What this output is NOT: it never reaches the article writer. The writer is
 * only ever told about products that actually exist in Cynth, because a
 * category in the writer's prompt is an invitation to describe a product
 * nobody owns. This is a brief for the editor.
 */

const OPPORTUNITY_TIMEOUT_MS = 90_000;

export interface ProductOpportunity {
  /** A category, e.g. "Clumping cat litter". Never a brand or a model. */
  productType: string;
  /** Why a reader of this particular article would want one. */
  whySuited: string;
  /** The section key it would serve, when it maps to one. Null when the model named a section that does not exist. */
  sectionKey: string | null;
  /** Phrases to type into a retailer's search box. */
  searchTerms: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface ProductOpportunitySet {
  /** The honest read on whether this article should carry products at all. */
  assessment: string;
  opportunities: ProductOpportunity[];
}

function buildPrompt(
  research: TopicResearch,
  keywords: KeywordResearch,
  classification: ArticleClassification,
  template: TemplateSelection,
  brief: Pick<ArticleBrief, 'title' | 'audience' | 'recommendedAngle'>,
): string {
  return [
    'You are an editor deciding what kinds of product an article should be able to recommend, BEFORE any products have been chosen.',
    '',
    '=== RULES ===',
    'Propose CATEGORIES of product, never specific products. "Clumping cat litter" is a category. "Dr Elsey\'s Ultra Unscented" is a product, and naming one is wrong here — you do not know what is currently sold, and inventing a plausible product is worse than proposing none.',
    'Do not state prices, brands, model numbers or availability.',
    'Propose only what a reader of THIS article would genuinely want while reading it. A category the article never gives you a reason to mention does not belong.',
    'Tie each one to a section of the template below, using the section key exactly as given.',
    'If this article should not carry products at all, return an empty list and say why in the assessment. That is a correct answer, and a common one.',
    'Between three and six suggestions where products fit. Fewer is fine. Do not pad the list.',
    '',
    '=== THE ARTICLE ===',
    `Title: ${brief.title}`,
    `Topic: ${research.topic}`,
    `Angle: ${brief.recommendedAngle}`,
    `Reader: ${brief.audience}`,
    `Article type: ${classification.articleType}`,
    `Search intent: ${keywords.searchIntent || research.likelySearchIntent}`,
    `Commercial intent: ${keywords.commercialIntent}`,
    research.commercialOpportunity ? `What the research said about commercial fit: ${research.commercialOpportunity}` : '',
    keywords.entities.length ? `Entities the article will cover: ${keywords.entities.slice(0, 15).join(', ')}` : '',
    '',
    `=== THE SKELETON: ${template.name} ===`,
    'The sections this article will have, in order:',
    template.sectionKeys.map((key) => `- ${key}`).join('\n'),
    '',
    '=== OUTPUT ===',
    'Reply with JSON only. No commentary, no code fence.',
    '{',
    '  "assessment": "whether this article warrants products at all, and why",',
    '  "opportunities": [',
    '    {',
    '      "product_type": "the category, as a shopper would think of it",',
    '      "why_suited": "why a reader of this article would want one",',
    '      "section_key": "one of the section keys above",',
    '      "search_terms": ["what to type into a retailer search box"],',
    '      "priority": "high | medium | low"',
    '    }',
    '  ]',
    '}',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function readJsonObject(text: string): Record<string, unknown> {
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object was found in the reply');

  const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('the reply was not a JSON object');
  return parsed as Record<string, unknown>;
}

function parse(text: string, sectionKeys: string[]): ProductOpportunitySet {
  const json = readJsonObject(text);
  const known = new Set(sectionKeys);

  const raw = Array.isArray(json.opportunities) ? (json.opportunities as unknown[]) : [];
  const opportunities = raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry): ProductOpportunity | null => {
      const productType = typeof entry.product_type === 'string' ? entry.product_type.trim() : '';
      if (!productType) return null;

      const sectionKey = typeof entry.section_key === 'string' ? entry.section_key.trim() : '';
      const priority = entry.priority === 'high' || entry.priority === 'low' ? entry.priority : 'medium';

      return {
        productType: productType.slice(0, 120),
        whySuited: typeof entry.why_suited === 'string' ? entry.why_suited.trim().slice(0, 600) : '',
        // A section the template does not have is recorded as null rather than
        // coerced to the nearest one. A suggestion pointing at a section that
        // does not exist is still a useful shopping idea; pretending it maps
        // somewhere would put it in the wrong place in the panel.
        sectionKey: known.has(sectionKey) ? sectionKey : null,
        searchTerms: Array.isArray(entry.search_terms)
          ? (entry.search_terms as unknown[])
              .filter((term): term is string => typeof term === 'string' && term.trim().length > 0)
              .map((term) => term.trim().slice(0, 120))
              .slice(0, 6)
          : [],
        priority,
      };
    })
    .filter((entry): entry is ProductOpportunity => entry !== null)
    .slice(0, 8);

  return {
    assessment: typeof json.assessment === 'string' ? json.assessment.trim().slice(0, 1200) : '',
    opportunities,
  };
}

export async function runProductOpportunity(
  pipelineId: number,
  input: {
    research: TopicResearch;
    keywords: KeywordResearch;
    classification: ArticleClassification;
    template: TemplateSelection;
    brief: Pick<ArticleBrief, 'title' | 'audience' | 'recommendedAngle'>;
  },
  options: { confirmedCost?: boolean; rerun?: boolean } = {},
): Promise<StageResult> {
  const definition = STAGE_DEFINITIONS.product_opportunity;
  // Captured before the stage announces itself, so a refused spend gate
  // can put the run back rather than leaving it reading as running.
  const stateBeforeStage = getPipelineById(pipelineId)?.state ?? null;
  setState(pipelineId, definition.runningState, { stage: 'product_opportunity' });

  try {
    const result = await runStage({
      pipelineId,
      stage: 'product_opportunity',
      prompt: buildPrompt(input.research, input.keywords, input.classification, input.template, input.brief),
      parse: (text) => parse(text, input.template.sectionKeys),
      timeoutMs: OPPORTUNITY_TIMEOUT_MS,
      assumedCompletionTokens: 900,
      confirmedCost: options.confirmedCost,
      rerun: options.rerun,
    });

    setState(pipelineId, definition.completeState, { stage: 'product_opportunity' });
    return result;
  } catch (error) {
    // Declining to spend is not a failed stage. Nothing was called and nothing
    // was charged — so the run is put back exactly where it was, rather than
    // left reading as in-progress while it waits for an answer, and never
    // moved to the terminal FAILED state.
    if (isSpendRefusal(error)) {
      if (stateBeforeStage) setState(pipelineId, stateBeforeStage, { stage: null });
      throw error;
    }

    setState(pipelineId, 'FAILED', {
      stage: 'product_opportunity',
      note: error instanceof Error ? error.message : 'Product opportunity analysis failed.',
    });
    throw error;
  }
}
