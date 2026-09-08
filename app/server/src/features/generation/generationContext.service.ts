import { getArticleById } from '../articles/articles.repository.js';
import type { ArticleDraftDto } from '../articles/articles.repository.js';
import { getArticleTypeById } from '../article-types/article-types.repository.js';
import { getAuthorById } from '../authors/authors.repository.js';
import { listActiveSharedSkills, listActiveSkillsForAuthor } from '../authors/authorSkills.repository.js';
import { getProductById } from '../products/products.repository.js';
import { listArticleProducts, resolveProductIdsForArticle } from '../articles/articleProducts.repository.js';
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

/**
 * A long-form authoring document, carried verbatim (Milestone 16).
 *
 * The persona fields below describe an author in a fixed shape. A skill is the
 * same identity written as prose, and it reaches the model unmodified — Cynth
 * neither summarises it nor extracts fields from it.
 */
export interface AuthorSkillContext {
  id: number;
  name: string;
  /** Markdown, exactly as stored. */
  body: string;
}

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
  /** The author's own skill documents, in assembly order. Empty when they have none. */
  skills: AuthorSkillContext[];
}

/**
 * A product the user attached to this article, with what research learned
 * about it (Milestone 17).
 *
 * `affiliateUrl` is present because the card is rendered from this context —
 * but it is deliberately NOT put in the prompt: the model has no use for a
 * tracking URL, and a link it never sees is a link it cannot alter.
 */
export interface ArticleProductContext {
  productId: number;
  title: string;
  brand: string | null;
  category: string | null;
  /** The user's link, verbatim. Used when rendering the card, never sent to a model. */
  affiliateUrl: string | null;
  /**
   * Which retailer the link points at, derived from the source URL's host.
   *
   * Used only to label the card's button honestly — "Shop on Amazon" when it
   * is Amazon, a neutral label otherwise. Never a filter, and never sent to a
   * model.
   */
  vendor: string | null;
  imageUrl: string | null;
  description: string | null;
  /** What research established this product is for. Null when it has not been researched. */
  useCase: string | null;
  problemSolved: string | null;
  bestFor: string | null;
  keyFeatures: string[];
  /** Why the editor attached it, in their words. The strongest placement signal when present. */
  editorialNote: string | null;
  editorialFit: string | null;
  /** The thematic area this product belongs to (Milestone 18). Context for relevance, never a filter. */
  themeName: string | null;
  /** True when the product's area differs from the article's. Stated, not acted on. */
  themeMatchesArticle: boolean | null;
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
  /**
   * Skill documents that apply to every author, whoever is writing. Resolved
   * once per article rather than per author, since that is what "shared" means.
   */
  sharedSkills: AuthorSkillContext[];
  articleType: { id: number; name: string; description: string | null } | null;
  product: { title: string; brand: string | null; description: string | null; editorialFit: string | null } | null;
  /**
   * Every product attached to this article, researched or not (Milestone 17).
   *
   * Supersedes the single `product` above, which is kept because drafts
   * created before `article_products` existed still carry one. A product
   * recorded both ways appears here once.
   */
  products: ArticleProductContext[];
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
    // Only active documents; deactivating a skill is how the user takes it out
    // of generation without deleting it.
    skills: listActiveSkillsForAuthor(authorId).map((skill) => ({
      id: skill.id,
      name: skill.name,
      body: skill.body,
    })),
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

/**
 * Resolves every product attached to an article into placement context.
 *
 * An uploaded primary image wins over the one the source page published: the
 * editor's own asset is always preferred to a retailer's CDN.
 */
function productsFor(articleId: number, articleThemeId: number | null): ArticleProductContext[] {
  const noteByProductId = new Map(
    listArticleProducts(articleId).map((row) => [row.productId, row.editorialNote]),
  );

  return resolveProductIdsForArticle(articleId)
    .map((productId): ArticleProductContext | null => {
      const product = getProductById(productId);
      if (!product) return null;

      const uploaded = product.images.find((image) => image.isPrimary) ?? product.images[0] ?? null;

      return {
        productId: product.id,
        title: product.title,
        brand: product.brand,
        category: product.category,
        affiliateUrl: product.affiliateLink,
        vendor: product.vendor,
        imageUrl: uploaded?.url ?? product.sourceImageUrl,
        description: product.shortDescription ?? product.description,
        useCase: product.useCase,
        problemSolved: product.problemSolved,
        bestFor: product.bestFor,
        keyFeatures: product.keyFeatures,
        editorialNote: noteByProductId.get(product.id) ?? null,
        editorialFit: product.editorialFit,
        themeName: product.themeName,
        // Null when either side has no area — an unknown is not a mismatch,
        // and the prompt says so rather than implying one.
        themeMatchesArticle:
          product.themeId === null || articleThemeId === null ? null : product.themeId === articleThemeId,
      };
    })
    .filter((entry): entry is ArticleProductContext => entry !== null);
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
    sharedSkills: listActiveSharedSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      body: skill.body,
    })),
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
    products: productsFor(article.id, article.themeId ?? null),
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
