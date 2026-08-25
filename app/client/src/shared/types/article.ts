import type { GeneratedArticle } from './generation';

export interface ArticleKeywords {
  primaryKeyword: string | null;
  secondaryKeywords: string | null;
}

export interface ArticleDraft {
  id: number;
  title: string | null;
  topic: string | null;
  articleTypeId: number | null;
  authorId: number | null;
  productId: number | null;
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
}

export interface ArticleDraftInput {
  articleTypeId: number;
  authorId: number | null;
  productId: number | null;
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
