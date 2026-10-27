import type { GeneratedArticle } from './generation';
import type { ArticleCmsLink } from './cms';

export interface ArticleKeywords {
  primaryKeyword: string | null;
  secondaryKeywords: string | null;
}

export interface ArticleDraft {
  id: number;
  title: string | null;
  /** Stable URL-safe handle derived from the title. Null while the article has no title. */
  slug: string | null;
  topic: string | null;
  articleTypeId: number | null;
  authorId: number | null;
  productId: number | null;
  /** Content configuration (Milestone 10/11). Null until chosen. */
  projectId: number | null;
  themeId: number | null;
  topicId: number | null;
  targetAudience: string | null;
  searchIntent: string | null;
  readerPainPoints: string | null;
  questionsToAnswer: string | null;
  importantTopics: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  keywords: ArticleKeywords | null;
  /** Null until an AI generation has succeeded for this draft (Milestone 9). */
  generated: GeneratedArticle | null;
  /**
   * Where this article currently lives outside Cynth (Milestone 13). Empty
   * until it has been pushed. Its presence is what makes a second push an
   * update rather than a duplicate.
   */
  cmsLinks: ArticleCmsLink[];
}

export interface ArticleDraftInput {
  articleTypeId: number;
  authorId: number | null;
  productId: number | null;
  projectId: number | null;
  themeId: number | null;
  topicId: number | null;
  topic: string;
  title: string;
  targetAudience: string;
  searchIntent: string;
  readerPainPoints: string;
  questionsToAnswer: string;
  importantTopics: string;
  notes: string;
  primaryKeyword: string;
  secondaryKeywords: string;
}

/**
 * One Article as the Dashboard and Drafts list need it.
 *
 * The Article is the content entity. It is not a generation_history row —
 * history records generation *attempts* (an article may have several, or
 * none) and is never used to build these lists.
 */
export interface ArticleSummary {
  id: number;
  /** Never empty: the working title, else the generated title, else "Untitled draft". */
  displayTitle: string;
  workingTitle: string | null;
  generatedTitle: string | null;
  slug: string | null;
  status: string;
  topic: string | null;
  /** The article type's name — the closest thing Cynth has to a category. */
  articleTypeName: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  isGenerated: boolean;
  generatedAt: string | null;
  generatedModel: string | null;
  generatedProvider: string | null;
  excerpt: string | null;
  wordCount: number | null;
  /** True once this article has been pushed to at least one CMS. */
  isPushedToCms: boolean;
  /** The remote status of the most recently pushed copy, as the CMS last reported it. */
  cmsStatus: string | null;
  cmsSiteUrl: string | null;
}

export interface ArticleListResponse {
  articles: ArticleSummary[];
  total: number;
}
