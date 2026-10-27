import type { ArticleTypeSlug } from '../pipeline/pipeline.constants.js';

/**
 * THE INITIAL ARTICLE TEMPLATES (Milestone 21).
 *
 * A template has two layers, and keeping them apart is the whole point:
 *
 *   CONTENT SCHEMA      what the article must contain — sections, order,
 *                       which are required, and the editorial elements each
 *                       one carries. This is what the writer is given and what
 *                       final validation checks.
 *   PRESENTATION SCHEMA how EveryFiveDays is expected to render it. Advisory
 *                       to the site, never markup. No model writes site HTML;
 *                       EFD owns layout, and it decides using the article type
 *                       plus the template id and version.
 *
 * These are seeded as version 1 and never overwritten. Editing a template
 * creates a new version, so an article written to v1 still means what it meant.
 */

export type SectionKind =
  | 'hero'
  | 'prose'
  | 'steps'
  | 'list'
  | 'table'
  | 'faq'
  | 'verdict'
  | 'pros_cons'
  | 'product_module'
  | 'comparison_module'
  | 'cta';

export interface SectionSchema {
  /** Stable key the writer emits and validation checks. */
  key: string;
  /** The heading a reader sees. The writer may reword it; the key is what identifies it. */
  heading: string;
  kind: SectionKind;
  required: boolean;
  /** What this section is for, given to the writer verbatim. */
  guidance: string;
  minWords?: number;
  /** Where a product may appear in this section, when it may at all. */
  productPlacement?: 'featured' | 'contextual' | 'comparison' | 'recommendation' | 'none';
}

export interface ContentSchema {
  sections: SectionSchema[];
  /** Minimum for the whole article. Validation reports a shortfall; it does not pad. */
  minWords: number;
  /**
   * Maximum for the whole article (v2).
   *
   * A ceiling, not a target. EveryFiveDays is short-form: most readers do not
   * want 2,000 words, and a template whose only length instruction was a
   * MINIMUM gave the writer one direction to push in. Validation reports an
   * overrun; it never truncates, because cutting an article off mid-argument
   * is worse than a long one.
   */
  maxWords: number;
  requiresFaq: boolean;
  requiresSources: boolean;
}

export interface PresentationSchema {
  /** The layout family EFD should use. A hint for the site, not a stylesheet. */
  layout: string;
  /** Sections EFD is expected to render distinctly rather than as plain prose. */
  emphasise: string[];
  /** Whether the affiliate disclosure must be rendered for this template. */
  requiresAffiliateDisclosure: boolean;
}

export interface TemplateDefinition {
  templateId: string;
  version: number;
  name: string;
  articleTypeSlug: ArticleTypeSlug;
  description: string;
  contentSchema: ContentSchema;
  presentationSchema: PresentationSchema;
  isDefault: boolean;
}

/** Shorthand, so the definitions below read as structure rather than boilerplate. */
function s(
  key: string,
  heading: string,
  kind: SectionKind,
  guidance: string,
  options: Partial<SectionSchema> = {},
): SectionSchema {
  return { key, heading, kind, required: true, guidance, ...options };
}

const FAQ = s('faq', 'FAQ', 'faq', 'Answer the questions readers actually ask about this subject. Three to six of them, each answered in a short paragraph.', { productPlacement: 'none' });

const HERO = s('hero', 'Hero', 'hero', 'One or two sentences that state what this article is and who it is for. No preamble.', { minWords: 20, productPlacement: 'none' });

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    templateId: 'how-to-v1',
    version: 2,
    name: 'How-To',
    articleTypeSlug: 'how-to',
    description: 'A procedural article: the reader wants to accomplish something specific.',
    isDefault: true,
    contentSchema: {
      minWords: 800,
      maxWords: 1400,
      requiresFaq: true,
      requiresSources: false,
      sections: [
        HERO,
        s('introduction', 'Introduction', 'prose', 'Why this task matters and what the reader will be able to do by the end.', { minWords: 70 }),
        s('what_you_need', "What you'll need", 'list', 'Tools, materials or prerequisites. A product may be recommended here only where genuinely required for the task.', { productPlacement: 'contextual' }),
        s('steps', 'Steps', 'steps', 'The procedure, in order, one action per step. Each step says what to do and how to know it worked.', { minWords: 300 }),
        s('common_mistakes', 'Common mistakes', 'list', 'What goes wrong in practice, and how to avoid it.', { required: false }),
        s('practical_tips', 'Practical tips', 'list', 'Advice that improves the result but is not part of the core procedure.', { required: false }),
        FAQ,
        s('conclusion', 'Conclusion', 'prose', 'What the reader should now be able to do. No hard sell.'),
      ],
    },
    presentationSchema: { layout: 'how-to', emphasise: ['steps', 'what_you_need', 'faq'], requiresAffiliateDisclosure: true },
  },
  {
    templateId: 'ultimate-guide-v1',
    version: 2,
    name: 'Ultimate Guide',
    articleTypeSlug: 'ultimate-guide',
    description: 'Comprehensive coverage of a subject for a reader who wants the whole picture.',
    isDefault: true,
    contentSchema: {
      minWords: 900,
      maxWords: 1500,
      requiresFaq: true,
      requiresSources: true,
      sections: [
        HERO,
        s('introduction', 'Introduction', 'prose', 'What this guide covers and who it is for.', { minWords: 80 }),
        s('overview', 'Overview', 'prose', 'The shape of the subject before the detail — what the reader needs to hold in mind.'),
        s('core_sections', 'Core sections', 'prose', 'The substance of the guide, broken into clearly headed parts. This is where most of the article lives.', { minWords: 500 }),
        s('practical_implementation', 'Practical implementation', 'prose', 'How to actually apply the above. A product may be recommended where it genuinely helps.', { productPlacement: 'contextual' }),
        s('common_mistakes', 'Common mistakes', 'list', 'What people get wrong.', { required: false }),
        FAQ,
        s('conclusion', 'Conclusion', 'prose', 'The through-line, restated once.'),
      ],
    },
    presentationSchema: { layout: 'guide', emphasise: ['core_sections', 'faq'], requiresAffiliateDisclosure: true },
  },
  {
    templateId: 'comparison-v1',
    version: 2,
    name: 'Comparison',
    articleTypeSlug: 'comparison',
    description: 'Two or more options weighed against each other for a reader deciding between them.',
    isDefault: true,
    contentSchema: {
      minWords: 850,
      maxWords: 1400,
      requiresFaq: true,
      requiresSources: false,
      sections: [
        HERO,
        s('introduction', 'Introduction', 'prose', 'What is being compared and what the decision turns on.', { minWords: 70 }),
        s('quick_comparison', 'Quick comparison', 'table', 'A table comparing the options on the criteria that actually matter. Facts only.', { productPlacement: 'comparison' }),
        s('evaluations', 'Individual evaluations', 'prose', 'Each option assessed on its own terms, in its own subsection.', { minWords: 350, productPlacement: 'contextual' }),
        s('key_differences', 'Key differences', 'list', 'Where the options genuinely diverge — not a restatement of the table.'),
        s('best_for', 'Best for', 'list', 'Which reader each option suits, and why.', { productPlacement: 'recommendation' }),
        s('buying_considerations', 'Buying considerations', 'prose', 'What to check before committing.', { required: false }),
        s('verdict', 'Verdict', 'verdict', 'A clear answer. Say which, and for whom.', { productPlacement: 'recommendation' }),
        FAQ,
      ],
    },
    presentationSchema: { layout: 'comparison', emphasise: ['quick_comparison', 'verdict', 'best_for'], requiresAffiliateDisclosure: true },
  },
  {
    templateId: 'product-review-v1',
    version: 2,
    name: 'Product Review',
    articleTypeSlug: 'product-review',
    description: 'One product assessed in depth.',
    isDefault: true,
    contentSchema: {
      minWords: 800,
      maxWords: 1300,
      requiresFaq: true,
      requiresSources: false,
      sections: [
        HERO,
        s('verdict', 'Verdict', 'verdict', 'The conclusion, up front. A reader who stops here should still have the answer.', { minWords: 60, productPlacement: 'featured' }),
        s('at_a_glance', 'At a glance', 'list', 'The handful of facts that define this product.'),
        s('what_it_is', 'What it is', 'prose', 'The product described plainly, without marketing language.'),
        s('key_features', 'Key features', 'list', 'What it does, and why each matters in use.', { productPlacement: 'contextual' }),
        s('performance', 'Performance', 'prose', 'How it behaves in practice. Support claims or attribute them.', { minWords: 140 }),
        s('pros', 'Pros', 'pros_cons', 'What it genuinely does well.'),
        s('cons', 'Cons', 'pros_cons', 'Real drawbacks. A review with no cons is not a review.'),
        s('who_its_for', "Who it's for", 'prose', 'The reader this suits.'),
        s('who_should_avoid', 'Who should avoid it', 'prose', 'The reader it does not suit. Be specific.'),
        s('alternatives', 'Alternatives', 'list', 'What else to consider, and when.', { required: false, productPlacement: 'contextual' }),
        s('final_verdict', 'Final verdict', 'verdict', 'The recommendation, stated once more with its conditions.', { productPlacement: 'recommendation' }),
        FAQ,
      ],
    },
    presentationSchema: { layout: 'review', emphasise: ['verdict', 'at_a_glance', 'pros', 'cons', 'final_verdict'], requiresAffiliateDisclosure: true },
  },
  {
    templateId: 'buying-guide-v1',
    version: 2,
    name: 'Buying Guide',
    articleTypeSlug: 'buying-guide',
    description: 'How to choose, plus what to choose, for a reader ready to buy.',
    isDefault: true,
    contentSchema: {
      minWords: 900,
      maxWords: 1500,
      requiresFaq: true,
      requiresSources: false,
      sections: [
        HERO,
        s('introduction', 'Introduction', 'prose', 'What this guide helps the reader buy, and what makes the decision hard.', { minWords: 70 }),
        s('what_to_consider', 'What to consider', 'prose', 'The dimensions the decision turns on, explained so the reader can judge for themselves.', { minWords: 170 }),
        s('buying_criteria', 'Buying criteria', 'list', 'The criteria, stated as things to check.'),
        s('recommended_products', 'Recommended products', 'product_module', 'The recommendations, each with the reason it earns its place. Only products that genuinely fit.', { minWords: 220, productPlacement: 'featured' }),
        s('comparison', 'Comparison', 'table', 'The recommendations side by side on the stated criteria.', { required: false, productPlacement: 'comparison' }),
        s('best_for_users', 'Best for different users', 'list', 'Which recommendation suits which reader.', { productPlacement: 'recommendation' }),
        s('what_to_avoid', 'What to avoid', 'list', 'Traps, false economies and marketing claims that do not survive contact.', { required: false }),
        FAQ,
        s('final_recommendation', 'Final recommendation', 'verdict', 'The single answer for the typical reader.', { productPlacement: 'recommendation' }),
      ],
    },
    presentationSchema: {
      layout: 'buying-guide',
      emphasise: ['recommended_products', 'comparison', 'best_for_users', 'final_recommendation'],
      requiresAffiliateDisclosure: true,
    },
  },
  {
    templateId: 'evidence-analysis-v1',
    version: 2,
    name: 'Evidence-Based Analysis',
    articleTypeSlug: 'evidence-based-analysis',
    description: 'What the evidence actually supports, and what it does not.',
    isDefault: true,
    contentSchema: {
      minWords: 850,
      maxWords: 1400,
      requiresFaq: true,
      // The one template where sources are not optional: an evidence article
      // without citations is an opinion article.
      requiresSources: true,
      sections: [
        HERO,
        s('executive_summary', 'Executive summary', 'prose', 'The findings in short. State confidence honestly.', { minWords: 80 }),
        s('what_we_know', 'What we know', 'prose', 'The established position, attributed.', { minWords: 140 }),
        s('what_evidence_says', 'What the evidence says', 'prose', 'The evidence itself, with its strength characterised. Do not overstate.', { minWords: 200 }),
        s('what_remains_uncertain', 'What remains uncertain', 'prose', 'The genuine open questions. This section is required precisely because it is the one most often omitted.', { minWords: 90 }),
        s('mechanism', 'Mechanism', 'prose', 'Why it works, or why it might not.', { required: false }),
        s('practical_implications', 'Practical implications', 'prose', 'What a reader should actually do with this. A product only where the evidence justifies one.', { productPlacement: 'contextual' }),
        s('limitations', 'Limitations', 'prose', 'What this analysis cannot settle.'),
        s('conclusion', 'Conclusion', 'prose', 'The honest bottom line.'),
        FAQ,
      ],
    },
    presentationSchema: {
      layout: 'analysis',
      emphasise: ['executive_summary', 'what_evidence_says', 'what_remains_uncertain', 'limitations'],
      requiresAffiliateDisclosure: true,
    },
  },
  {
    templateId: 'listicle-v1',
    version: 2,
    name: 'Listicle',
    articleTypeSlug: 'listicle',
    description: 'A curated set of items, each earning its place.',
    isDefault: true,
    contentSchema: {
      minWords: 800,
      maxWords: 1300,
      requiresFaq: true,
      requiresSources: false,
      sections: [
        HERO,
        s('introduction', 'Introduction', 'prose', 'What the list covers and why these items.', { minWords: 80 }),
        s('methodology', 'Selection methodology', 'prose', 'How the items were chosen. A list without stated criteria is a list of opinions.', { minWords: 80 }),
        s('items', 'Items', 'list', 'The items themselves, each with its own heading, what it is, and who it suits.', { minWords: 450, productPlacement: 'contextual' }),
        s('summary', 'Comparison', 'table', 'The items summarised side by side.', { required: false, productPlacement: 'comparison' }),
        s('best_for', 'Who each is best for', 'list', 'Matching item to reader.', { productPlacement: 'recommendation' }),
        FAQ,
        s('conclusion', 'Conclusion', 'prose', 'A short close.'),
      ],
    },
    presentationSchema: { layout: 'listicle', emphasise: ['items', 'methodology', 'best_for'], requiresAffiliateDisclosure: true },
  },
  {
    templateId: 'trend-analysis-v1',
    version: 2,
    name: 'Trend Analysis',
    articleTypeSlug: 'trend-analysis',
    description: 'Something is changing; what it is, and what it means.',
    isDefault: true,
    contentSchema: {
      minWords: 700,
      maxWords: 1200,
      requiresFaq: false,
      requiresSources: true,
      sections: [
        HERO,
        s('what_is_happening', 'What is happening', 'prose', 'The change itself, stated concretely.', { minWords: 110 }),
        s('why_it_matters', 'Why it matters', 'prose', 'The consequence for the reader.', { minWords: 120 }),
        s('evidence', 'Evidence', 'prose', 'The data or reporting the claim rests on, attributed.', { minWords: 150 }),
        s('what_is_changing', 'What is changing', 'prose', 'The direction of travel.'),
        s('who_is_affected', 'Who is affected', 'list', 'Specific groups, not "everyone".'),
        s('what_to_watch', 'What to watch', 'list', 'The signals that would confirm or refute this.'),
        s('conclusion', 'Conclusion', 'prose', 'Where this leaves the reader.'),
      ],
    },
    presentationSchema: { layout: 'analysis', emphasise: ['what_is_happening', 'evidence', 'what_to_watch'], requiresAffiliateDisclosure: false },
  },
];

/**
 * Article types that have no template of their own yet.
 *
 * They fall back to the closest structural match rather than to nothing, and
 * the mapping is stated here rather than hidden in a lookup so it is visible
 * that these are borrowed, not bespoke.
 */
export const TEMPLATE_FALLBACKS: Record<string, string> = {
  explainer: 'ultimate-guide-v1',
  'problem-solution': 'how-to-v1',
  'case-study': 'evidence-analysis-v1',
  'myth-vs-fact': 'evidence-analysis-v1',
};
