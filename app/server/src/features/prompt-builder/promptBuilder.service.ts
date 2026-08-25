import { getArticleById } from '../articles/articles.repository.js';
import type { ArticleDraftDto } from '../articles/articles.repository.js';
import { getArticleTypeById } from '../article-types/article-types.repository.js';
import { getAuthorById } from '../authors/authors.repository.js';
import type { AuthorDetailDto } from '../authors/authors.repository.js';
import { getProductById } from '../products/products.repository.js';
import type { ProductDetailDto } from '../products/products.repository.js';

/**
 * Cynth's Prompt Builder: collects an article draft plus its author and
 * (optional) product from the database and assembles one complete,
 * human-readable prompt. Nothing here calls an AI model or sends anything
 * externally — this only produces the text package a future milestone
 * would send.
 */

export interface AssembledPrompt {
  prompt: string;
  characterCount: number;
  wordCount: number;
}

export interface PromptBuildFailure {
  errors: string[];
}

function field(label: string, value: string | null | undefined): string {
  const trimmed = value?.trim();
  return `${label}: ${trimmed ? trimmed : 'Not provided.'}`;
}

function sectionBlock(title: string, body: string): string {
  return `=== ${title} ===\n${body}`;
}

function buildArticleSection(article: ArticleDraftDto, articleTypeName: string): string {
  return [
    field('Article Type', articleTypeName),
    field('Topic', article.topic),
    field('Working Title', article.title),
    field('Primary Keyword', article.keywords?.primaryKeyword ?? null),
    field('Secondary Keywords', article.keywords?.secondaryKeywords ?? null),
  ].join('\n');
}

function buildAuthorSection(author: AuthorDetailDto): string {
  const samples = author.writingSamples.length
    ? author.writingSamples.map((s) => `- ${s.title}: ${s.fullText?.trim() || 'Not provided.'}`).join('\n')
    : 'None provided.';

  return [
    field('Philosophy', author.philosophy),
    field('Writing Style', author.writingStyle),
    field('Tone', author.tone),
    field('Preferred Recurring Expressions', author.preferredExpressions),
    field('Prohibited Expressions', author.prohibitedExpressions),
    field('Writing Notes', author.writingNotes),
    '',
    'Approved Writing Samples:',
    samples,
  ].join('\n');
}

function buildProductSection(product: ProductDetailDto): string {
  return [
    field('Product Title', product.title),
    field('Brand', product.brand),
    field('Description', product.description),
    field('Editorial Notes', product.editorialFit),
  ].join('\n');
}

function buildContentBriefSection(article: ArticleDraftDto): string {
  return [
    field('Target Audience', article.targetAudience),
    field('Search Intent', article.searchIntent),
    field('Reader Pain Points', article.readerPainPoints),
    field('Questions To Answer', article.questionsToAnswer),
    field('Important Topics To Cover', article.importantTopics),
    field('Notes', article.notes),
  ].join('\n');
}

const INSTRUCTIONS = [
  'Write the article using only the information provided in the sections above.',
  "Match the author's philosophy, tone, and writing style exactly.",
  'Use the preferred expressions where natural, and never use the prohibited expressions.',
  'Cover the important topics and answer the listed questions, for the stated target audience and search intent.',
  'If a product is included, reference it only in the ways the editorial notes describe.',
  'A human editor will review this draft before anything is published — do not present it as final or publish-ready.',
].join('\n');

/** Required per Milestone 7: Article Type, Author, Topic, Working Title. */
export function validateArticleForPrompt(article: ArticleDraftDto): string[] {
  const errors: string[] = [];
  if (!article.articleTypeId) errors.push('Article Type is required.');
  if (!article.authorId) errors.push('Author is required.');
  if (!article.topic?.trim()) errors.push('Topic is required.');
  if (!article.title?.trim()) errors.push('Working Title is required.');
  return errors;
}

/**
 * Assembles the full prompt for a draft, or returns validation errors
 * instead of building anything if required fields are missing.
 */
export function buildPrompt(articleId: number): AssembledPrompt | PromptBuildFailure {
  const article = getArticleById(articleId);
  if (!article) return { errors: ['Draft not found.'] };

  const errors = validateArticleForPrompt(article);
  if (errors.length) return { errors };

  const articleType = getArticleTypeById(article.articleTypeId!);
  const author = getAuthorById(article.authorId!);
  // Validated above, but a referenced row could still have been deleted since — fail clearly rather than assemble a broken prompt.
  if (!articleType) return { errors: ['The selected article type no longer exists.'] };
  if (!author) return { errors: ['The selected author no longer exists.'] };

  const product = article.productId ? getProductById(article.productId) : null;

  const sections = [sectionBlock('ARTICLE', buildArticleSection(article, articleType.name)), sectionBlock('AUTHOR', buildAuthorSection(author))];
  if (product) sections.push(sectionBlock('PRODUCT', buildProductSection(product)));
  sections.push(sectionBlock('CONTENT BRIEF', buildContentBriefSection(article)));
  sections.push(sectionBlock('INSTRUCTIONS', INSTRUCTIONS));

  const prompt = sections.join('\n\n');
  const trimmed = prompt.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;

  return { prompt, characterCount: prompt.length, wordCount };
}
