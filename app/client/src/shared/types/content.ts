/**
 * The content configuration: projects, thematic areas and topics.
 *
 * Generic engine types. Nothing here names a theme — EveryFiveDays' five
 * areas are rows the user can add to, rename, or deactivate.
 */

export interface Project {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  isDefault: boolean;
  themeCount: number;
}

export interface Theme {
  id: number;
  projectId: number;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  isActive: boolean;
  topicCount: number;
  authorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Topic {
  id: number;
  themeId: number;
  title: string;
  slug: string;
  description: string | null;
  notes: string | null;
  /** Editorial guidance — what the topic means and what an article about it should do. All user-supplied. */
  scope: string | null;
  keyAreas: string | null;
  considerations: string | null;
  exclusions: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ThemeAuthor {
  id: number;
  name: string;
  isActive: boolean;
}

export interface ArticleTypeOption {
  id: number;
  name: string;
  description: string | null;
}

export interface ThemeDetailResponse {
  theme: Theme;
  topics: Topic[];
  authors: ThemeAuthor[];
  articleTypes: ArticleTypeOption[];
}

export interface ThemeInput {
  name: string;
  description?: string;
  position?: number;
  isActive?: boolean;
}

export interface TopicInput {
  themeId?: number;
  title: string;
  description?: string;
  notes?: string;
  scope?: string;
  keyAreas?: string;
  considerations?: string;
  exclusions?: string;
  isActive?: boolean;
}
