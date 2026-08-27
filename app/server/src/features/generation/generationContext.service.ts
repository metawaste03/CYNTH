import { getArticleById } from '../articles/articles.repository.js';
import type { ArticleDraftDto } from '../articles/articles.repository.js';
import { getArticleTypeById } from '../article-types/article-types.repository.js';
import { getAuthorById } from '../authors/authors.repository.js';
import { getProductById } from '../products/products.repository.js';
import { getProjectById, getThemeById, getTopicById } from '../content/content.repository.js';

/**
 * THE GENERATION CONTEXT CONTRACT.
 *
 * Everything the generation engine is allowed to know about an article, in
 * one resolved structure:
 *
 *   Project -> Theme -> Topic -> Author (+ persona) -> Article Type -> brief
 *
 * This is the single place where configuration IDs on an article become the
 * actual editorial guidance the model receives. The Prompt Builder renders
 * this object to text; nothing else re-resolves it, so there is exactly one
 * answer to "what did the model actually know".
 *
 * Everything except the article itself is optional. An article configured
 * with no theme or topic still generates — it simply carries less guidance,
 * and the omitted sections do not appear in the prompt. Cynth never
 * substitutes invented editorial content for a field the user left empty.
 */

/** Who the model is writing as. Assembled from the author record's persona fields. */
export interface AuthorPersonaContext {
  name: string;
  /** Who the author is. */
  identity: string | null;
  /** What the author knows deeply. */
  expertise: string | null;
  /** How the author approaches subjects. */
  perspective: string | null;
  /** How the author communicates. */
  voice: string | null;
  tone: string | null;
  audience: string | null;
  /** What the author prioritises when writing. */
  editorialPrinciples: string | null;
  /** What the author must avoid claiming, discussing or doing. */
  boundaries: string | null;
  /** How the author should structure and communicate information. */
  writingGuidance: string | null;
  preferredExpressions: string | null;
  prohibitedExpressions: string | null;
  writingSamples: { title: string; text: string | null }[];
}

/** What the topic means and what an article about it should do. */
export interface TopicContext {
  id: number;
  title: string;
  description: string | null;
  scope: string | null;
  keyAreas: string | null;
  considerations: string | null;
  exclusions: string | null;
  notes: string | null;
}

export interface GenerationContext {
  articleId: number;
  project: { id: number; name: string; description: string | null; editorialGuidance: string | null } | null;
  theme: { id: number; name: string; description: string | null } | null;
  topic: TopicContext | null;
  author: AuthorPersonaContext | null;
  articleType: { id: number; name: string; description: string | null } | null;
  product: { title: string; brand: string | null; description: string | null; editorialFit: string | null } | null;
  article: {
    workingTitle: string | null;
    /** The legacy free-text topic field, kept for drafts predating the Topic entity. */
    topicText: string | null;
    primaryKeyword: string | null;
    secondaryKeywords: string | null;
  };
  brief: {
    targetAudience: string | null;
    searchIntent: string | null;
    readerPainPoints: string | null;
    questionsToAnswer: string | null;
    importantTopics: string | null;
    notes: string | null;
  };
}

function personaFrom(authorId: number): AuthorPersonaContext | null {
  const author = getAuthorById(authorId);
  if (!author) return null;

  return {
    name: author.name,
    identity: author.shortBiography,
    expertise: author.expertise,
    perspective: author.perspective,
    voice: author.writingStyle,
    tone: author.tone,
    audience: author.targetAudience,
    // philosophy predates the persona fields and means the same thing; the
    // dedicated field wins when the user has filled it in.
    editorialPrinciples: author.editorialPrinciples ?? author.philosophy,
    boundaries: author.boundaries,
    writingGuidance: author.writingNotes,
    preferredExpressions: author.preferredExpressions,
    prohibitedExpressions: author.prohibitedExpressions,
    writingSamples: author.writingSamples.map((s) => ({ title: s.title, text: s.fullText })),
  };
}

/**
 * Resolves an article's configuration into the context the generation engine
 * consumes. Returns null only when the article itself does not exist.
 */
export function buildGenerationContext(articleId: number): GenerationContext | null {
  const article = getArticleById(articleId);
  if (!article) return null;
  return contextFromArticle(article);
}

export function contextFromArticle(article: ArticleDraftDto): GenerationContext {
  const project = article.projectId ? getProjectById(article.projectId) : null;
  const theme = article.themeId ? getThemeById(article.themeId) : null;
  const topic = article.topicId ? getTopicById(article.topicId) : null;
  const articleType = article.articleTypeId ? getArticleTypeById(article.articleTypeId) : null;
  const product = article.productId ? getProductById(article.productId) : null;

  return {
    articleId: article.id,
    project: project
      ? {
          id: project.id,
          name: project.name,
          description: project.description,
          editorialGuidance: project.editorialGuidance,
        }
      : null,
    theme: theme ? { id: theme.id, name: theme.name, description: theme.description } : null,
    topic: topic
      ? {
          id: topic.id,
          title: topic.title,
          description: topic.description,
          scope: topic.scope,
          keyAreas: topic.keyAreas,
          considerations: topic.considerations,
          exclusions: topic.exclusions,
          notes: topic.notes,
        }
      : null,
    author: article.authorId ? personaFrom(article.authorId) : null,
    articleType: articleType
      ? { id: articleType.id, name: articleType.name, description: articleType.description }
      : null,
    product: product
      ? {
          title: product.title,
          brand: product.brand,
          description: product.description,
          editorialFit: product.editorialFit,
        }
      : null,
    article: {
      workingTitle: article.title,
      topicText: article.topic,
      primaryKeyword: article.keywords?.primaryKeyword ?? null,
      secondaryKeywords: article.keywords?.secondaryKeywords ?? null,
    },
    brief: {
      targetAudience: article.targetAudience,
      searchIntent: article.searchIntent,
      readerPainPoints: article.readerPainPoints,
      questionsToAnswer: article.questionsToAnswer,
      importantTopics: article.importantTopics,
      notes: article.notes,
    },
  };
}
