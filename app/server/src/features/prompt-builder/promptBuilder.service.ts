import { getArticleById } from '../articles/articles.repository.js';
import type { ArticleDraftDto } from '../articles/articles.repository.js';
import { contextFromArticle } from '../generation/generationContext.service.js';
import type {
  ArticleProductContext,
  AuthorPersonaContext,
  AuthorSkillContext,
  GenerationContext,
  TopicContext,
} from '../generation/generationContext.service.js';

/**
 * Cynth's Prompt Builder: renders a resolved GenerationContext into one
 * complete, human-readable prompt. Nothing here calls an AI model or sends
 * anything externally.
 *
 * It no longer resolves anything itself — generationContext.service.ts owns
 * that, so there is exactly one answer to "what configuration reached the
 * model". This file only decides how that context reads as text.
 *
 * Sections are omitted when their configuration is absent. An article with no
 * thematic area simply has no THEME section; Cynth never fabricates editorial
 * guidance to fill a gap the user left.
 */

export interface AssembledPrompt {
  prompt: string;
  characterCount: number;
  wordCount: number;
  /** Stamped onto the article at generation time, so a draft can say which prompt structure produced it. */
  promptVersion: string;
}

/**
 * The prompt's structural version.
 *
 * Bump it whenever the section hierarchy or the standing rules change in a
 * way that would make an article generated before and after incomparable.
 * Articles record the version they were generated under, so changing this
 * never rewrites the history of work already produced.
 */
export const PROMPT_VERSION = '4';

/**
 * The marker an author writes to place a product (Milestone 17).
 *
 * The author decides WHERE a product belongs and writes one line saying so;
 * Cynth turns that line into a card at render time. The division is the point:
 * the prose stays the author's, and the product card — image, title, the
 * user's affiliate link — stays Cynth's, assembled from stored data rather
 * than from anything a model wrote.
 */
export const PRODUCT_MARKER_PATTERN = /^\s*\[\[product:(\d+)\]\]\s*$/;

/**
 * Standing rules that apply to every Cynth generation, whatever the project.
 *
 * Engine-level, not editorial: these say how Cynth works, never what to
 * write. Anything domain-specific belongs to the project, theme, topic or
 * author, all of which the user configures.
 */
const SYSTEM_RULES = [
  'You are producing a draft for a human editor inside an editorial system.',
  'Use only the information provided in the sections below. Do not invent facts, sources, statistics, prices, or product details.',
  'Where a specific detail is required but not supplied, say so explicitly rather than inventing one.',
  'More specific guidance wins: article instructions override topic guidance, which overrides theme and project guidance.',
  "Where an author skill document is present, it is the authority on that author's voice, philosophy, structure and prohibitions, and overrides the summarised author fields.",
].join('\n');

export interface PromptBuildFailure {
  errors: string[];
}

function field(label: string, value: string | null | undefined): string {
  const trimmed = value?.trim();
  return `${label}: ${trimmed ? trimmed : 'Not provided.'}`;
}

/** Only emits the line when the user actually supplied a value — optional guidance should not fill the prompt with "Not provided." */
function optionalField(label: string, value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

function compact(lines: (string | null)[]): string {
  return lines.filter((line): line is string => line !== null).join('\n');
}

function sectionBlock(title: string, body: string): string {
  return `=== ${title} ===\n${body}`;
}

function buildProjectSection(context: GenerationContext): string | null {
  const lines = compact([
    optionalField('Project', context.project?.name),
    optionalField('Project Notes', context.project?.description),
    optionalField('Project Editorial Rules', context.project?.editorialGuidance),
    optionalField('Thematic Area', context.theme?.name),
    optionalField('Thematic Area Guidance', context.theme?.description),
  ]);
  return lines || null;
}

/** The topic's editorial guidance — what it means and what the article should do with it. */
function buildTopicSection(topic: TopicContext): string {
  return compact([
    field('Topic', topic.title),
    optionalField('What this topic covers', topic.description),
    optionalField('Scope', topic.scope),
    optionalField('Key areas to cover', topic.keyAreas),
    optionalField('Important considerations', topic.considerations),
    optionalField('Out of scope — do not cover', topic.exclusions),
    optionalField('Additional notes', topic.notes),
  ]);
}

/** The author persona. This is the guidance that makes the article sound like a person rather than a model. */
function buildAuthorSection(author: AuthorPersonaContext): string {
  const samples = author.writingSamples.length
    ? author.writingSamples.map((s) => `- ${s.title}: ${s.text?.trim() || 'Not provided.'}`).join('\n')
    : 'None provided.';

  return compact([
    field('Writing as', author.name),
    optionalField('Identity', author.identity),
    optionalField('Expertise', author.expertise),
    optionalField('Perspective', author.perspective),
    optionalField('Voice', author.voice),
    optionalField('Tone', author.tone),
    optionalField('Writes for', author.audience),
    optionalField('Editorial principles', author.editorialPrinciples),
    optionalField('Boundaries — must not do', author.boundaries),
    optionalField('Writing guidance', author.writingGuidance),
    optionalField('Preferred recurring expressions', author.preferredExpressions),
    optionalField('Prohibited expressions', author.prohibitedExpressions),
    '',
    'Approved Writing Samples:',
    samples,
  ]);
}

/**
 * Skill documents, rendered verbatim.
 *
 * The only thing added is a labelled boundary between documents, so the model
 * can tell where one ends and the next begins. The markdown itself is not
 * reflowed, trimmed, escaped or summarised: a skill is guidance the Product
 * Owner wrote, and the prompt builder's job here is delivery, not editing.
 */
function buildSkillSection(skills: AuthorSkillContext[]): string {
  return skills.map((skill) => `--- ${skill.name} ---\n${skill.body.trim()}`).join('\n\n');
}

function buildArticleSection(context: GenerationContext): string {
  return compact([
    field('Article Type', context.articleType?.name ?? 'Not provided.'),
    optionalField('What this article type is', context.articleType?.description),
    // Only shown when no Topic entity is attached — otherwise the TOPIC
    // section is authoritative and repeating it would just add noise.
    context.topic ? null : field('Topic', context.article.topicText),
    field('Working Title', context.article.workingTitle),
    field('Primary Keyword', context.article.primaryKeyword),
    field('Secondary Keywords', context.article.secondaryKeywords),
  ]);
}

/**
 * The products the editor selected, and what is known about each.
 *
 * Written as an inventory of options, never as a requirement. Each entry
 * leads with what the product is FOR, because that is what a placement
 * decision actually turns on — a monitor light and a desk organiser both fit
 * "workspace setup" and belong in completely different sections.
 *
 * The affiliate URL is not here. The model never sees it, so it cannot
 * reproduce it, mangle it, or invent a variation of it.
 */
function buildProductsSection(products: ArticleProductContext[]): string {
  return products
    .map((product) => {
      const lines = compact([
        `Product ${product.productId}: ${product.title}`,
        optionalField('  Brand', product.brand),
        optionalField('  What it is for', product.useCase),
        optionalField('  Problem it addresses', product.problemSolved),
        optionalField('  Best suited to', product.bestFor),
        optionalField('  Summary', product.shortDescription),
        // Both, and separately. Collapsing them sent the writer only the
        // short one whenever both existed, which is the normal case.
        product.description && product.description !== product.shortDescription
          ? optionalField('  Full description', product.description)
          : null,
        product.keyFeatures.length ? `  Features: ${product.keyFeatures.join('; ')}` : null,
        optionalField('  Editor\'s note on why this product was chosen', product.editorialNote),
        optionalField('  Editorial notes', product.editorialFit),
        optionalField('  Thematic area', product.themeName),
        // Stated as information, never as an instruction. A product filed
        // under another area can still be exactly right here, and the editor
        // attaching it is the stronger signal.
        product.themeMatchesArticle === false
          ? "  Note: this product is filed under a different thematic area from this article. That is not a reason to exclude it — judge it on whether it fits what you are writing."
          : null,
        product.useCase || product.shortDescription || product.description
          ? null
          : '  NOT RESEARCHED: nothing is known about this product beyond its title. Place it only if the title alone makes its relevance obvious.',
      ]);
      return lines;
    })
    .join('\n\n');
}

/**
 * How a product gets into the article.
 *
 * Two instructions carry the weight: place a product only where it is
 * genuinely relevant, and leave one out entirely when it is not. The second
 * is stated as an acceptable, expected outcome rather than a failure, because
 * a model told to use three products will use three products whether they fit
 * or not.
 */
function buildProductPlacementInstructions(products: ArticleProductContext[]): string {
  return [
    'The products listed above are available to reference. They are options, not requirements.',
    '',
    'To place a product, write its marker on a line of its own, immediately after the paragraph it belongs with:',
    '',
    '[[product:123]]',
    '',
    'Rules for placement:',
    '- Place a product ONLY in a section where it is genuinely relevant to what you are already discussing. Relevance means the surrounding paragraphs are about the problem that product addresses.',
    '- Do NOT force a product into a section it does not fit. Leaving a product out entirely is a correct outcome, and is expected whenever the article does not naturally reach its subject.',
    '- Use each product at most once.',
    '- Write the marker on its own line. Do not put it inside a sentence, a heading, a list item, or a table.',
    '- Do not write the product URL, a link, a price, or an image. Cynth renders the product card from its own records; your job is to say where it goes.',
    '- Lead into a product naturally in your own words, as part of the argument you are already making. Do not announce it ("here is a product we recommend") and do not write advertising copy for it.',
    '- Use only the product ids listed above. A marker with any other id is discarded.',
    `- Available product ids: ${products.map((product) => product.productId).join(', ')}.`,
  ].join('\n');
}

function buildProductSection(product: NonNullable<GenerationContext['product']>): string {
  return compact([
    field('Product Title', product.title),
    field('Brand', product.brand),
    field('Description', product.description),
    field('Editorial Notes', product.editorialFit),
  ]);
}

function buildContentBriefSection(brief: GenerationContext['brief']): string {
  return compact([
    field('Target Audience', brief.targetAudience),
    field('Search Intent', brief.searchIntent),
    field('Reader Pain Points', brief.readerPainPoints),
    field('Questions To Answer', brief.questionsToAnswer),
    field('Important Topics To Cover', brief.importantTopics),
    field('Notes', brief.notes),
  ]);
}

/** Instructions that reference only sections that are actually present. */
function buildInstructions(context: GenerationContext): string {
  const lines = [
    'Write the article using only the information provided in the sections above.',
    "Write as the named author: match their voice, tone, perspective and editorial principles exactly.",
  ];

  if (context.author?.skills.length) {
    lines.push(
      "Follow the author skill document exactly: its voice, structural habits, vocabulary and its list of things the author never does. Where it conflicts with the summarised author fields, the skill document wins.",
    );
  }
  if (context.sharedSkills.length) {
    lines.push('Observe the shared editorial guidance, which applies to every author on this publication.');
  }
  if (context.author?.boundaries?.trim()) {
    lines.push("Respect the author's stated boundaries without exception.");
  }
  lines.push('Use the preferred expressions where natural, and never use the prohibited expressions.');

  if (context.topic?.exclusions?.trim()) {
    lines.push('Do not cover anything listed as out of scope for this topic.');
  }
  if (context.topic) {
    lines.push('Cover the topic\'s key areas and respect its stated scope.');
  }

  if (context.products.length) {
    lines.push(
      'Place the available products only where they are genuinely relevant, following the product placement rules above. Omitting a product that does not fit is correct.',
    );
  }

  lines.push(
    'Cover the important topics and answer the listed questions, for the stated target audience and search intent.',
    'If a product is included, reference it only in the ways the editorial notes describe.',
    'A human editor will review this draft before anything is published — do not present it as final or publish-ready.',
  );

  return lines.join('\n');
}

/**
 * Required: Article Type, Author, Working Title, and a subject — satisfied by
 * either a linked Topic record or the legacy free-text topic field, so drafts
 * created before the Topic entity existed still build.
 */
export function validateArticleForPrompt(article: ArticleDraftDto): string[] {
  const errors: string[] = [];
  if (!article.articleTypeId) errors.push('Article Type is required.');
  if (!article.authorId) errors.push('Author is required.');
  if (!article.topicId && !article.topic?.trim()) errors.push('Topic is required.');
  if (!article.title?.trim()) errors.push('Working Title is required.');
  return errors;
}

export function buildPrompt(articleId: number): AssembledPrompt | PromptBuildFailure {
  const article = getArticleById(articleId);
  if (!article) return { errors: ['Draft not found.'] };

  const errors = validateArticleForPrompt(article);
  if (errors.length) return { errors };

  const context = contextFromArticle(article);

  // Validated above, but a referenced row could have been deleted since —
  // fail clearly rather than assemble a prompt with a hole in it.
  if (!context.articleType) return { errors: ['The selected article type no longer exists.'] };
  if (!context.author) return { errors: ['The selected author no longer exists.'] };

  // Hierarchy, broadest first: system rules -> project & theme -> shared
  // editorial guidance -> topic -> article task -> author -> author skill ->
  // product -> brief -> instructions. Only sections with actual content are
  // emitted.
  const sections: string[] = [sectionBlock('SYSTEM RULES', SYSTEM_RULES)];

  const projectSection = buildProjectSection(context);
  if (projectSection) sections.push(sectionBlock('PROJECT & THEMATIC AREA', projectSection));

  // Shared before the individual voice, matching what it is: the belief every
  // author on the publication holds, which each of them then writes their own
  // way.
  if (context.sharedSkills.length) {
    sections.push(sectionBlock('SHARED EDITORIAL GUIDANCE', buildSkillSection(context.sharedSkills)));
  }

  if (context.topic) sections.push(sectionBlock('TOPIC', buildTopicSection(context.topic)));

  sections.push(sectionBlock('ARTICLE', buildArticleSection(context)));
  sections.push(sectionBlock('AUTHOR', buildAuthorSection(context.author)));

  // Immediately after the summarised author fields, so "the skill wins" is a
  // comparison the model can actually make.
  if (context.author.skills.length) {
    sections.push(sectionBlock('AUTHOR SKILL', buildSkillSection(context.author.skills)));
  }
  // The multi-product section supersedes the single PRODUCT block. Both are
  // never emitted: a draft with attached products gets the inventory and the
  // placement rules, and a draft carrying only the legacy single product gets
  // it through the same section, so nothing is described twice.
  if (context.products.length) {
    sections.push(sectionBlock('PRODUCTS AVAILABLE', buildProductsSection(context.products)));
    sections.push(sectionBlock('PRODUCT PLACEMENT', buildProductPlacementInstructions(context.products)));
  } else if (context.product) {
    sections.push(sectionBlock('PRODUCT', buildProductSection(context.product)));
  }

  sections.push(sectionBlock('CONTENT BRIEF', buildContentBriefSection(context.brief)));
  sections.push(sectionBlock('INSTRUCTIONS', buildInstructions(context)));

  const prompt = sections.join('\n\n');
  const trimmed = prompt.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;

  return { prompt, characterCount: prompt.length, wordCount, promptVersion: PROMPT_VERSION };
}
