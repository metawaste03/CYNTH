import { getArticleById } from '../articles/articles.repository.js';
import type { ArticleDraftDto } from '../articles/articles.repository.js';
import { contextFromArticle } from '../generation/generationContext.service.js';
import type { AuthorPersonaContext, GenerationContext, TopicContext } from '../generation/generationContext.service.js';

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
export const PROMPT_VERSION = '2';

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

  // Hierarchy, broadest first: system rules -> project & theme -> topic ->
  // article task -> author -> product -> brief -> instructions. Only sections
  // with actual content are emitted.
  const sections: string[] = [sectionBlock('SYSTEM RULES', SYSTEM_RULES)];

  const projectSection = buildProjectSection(context);
  if (projectSection) sections.push(sectionBlock('PROJECT & THEMATIC AREA', projectSection));
  if (context.topic) sections.push(sectionBlock('TOPIC', buildTopicSection(context.topic)));

  sections.push(sectionBlock('ARTICLE', buildArticleSection(context)));
  sections.push(sectionBlock('AUTHOR', buildAuthorSection(context.author)));
  if (context.product) sections.push(sectionBlock('PRODUCT', buildProductSection(context.product)));
  sections.push(sectionBlock('CONTENT BRIEF', buildContentBriefSection(context.brief)));
  sections.push(sectionBlock('INSTRUCTIONS', buildInstructions(context)));

  const prompt = sections.join('\n\n');
  const trimmed = prompt.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;

  return { prompt, characterCount: prompt.length, wordCount, promptVersion: PROMPT_VERSION };
}
