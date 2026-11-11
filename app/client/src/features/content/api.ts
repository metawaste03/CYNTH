import { api } from '../../shared/services/apiClient';
import type {
  ArticleTypeOption,
  Project,
  Theme,
  ThemeDetailResponse,
  ThemeInput,
  Topic,
  TopicInput,
} from '../../shared/types/content';

/** The content configuration API — projects, thematic areas, topics, and author coverage. */

export function fetchProjects(): Promise<{ projects: Project[]; default: Project | null }> {
  return api.get<{ projects: Project[]; default: Project | null }>('/content/projects');
}

export function fetchThemes(options: { projectId?: number; activeOnly?: boolean } = {}): Promise<Theme[]> {
  const params = new URLSearchParams();
  if (options.projectId) params.set('projectId', String(options.projectId));
  if (options.activeOnly) params.set('activeOnly', 'true');

  const query = params.toString();
  return api.get<{ themes: Theme[] }>(`/content/themes${query ? `?${query}` : ''}`).then((r) => r.themes);
}

export function fetchTheme(id: number): Promise<ThemeDetailResponse> {
  return api.get<ThemeDetailResponse>(`/content/themes/${id}`);
}

export function createTheme(input: ThemeInput): Promise<Theme> {
  return api.post<{ theme: Theme }>('/content/themes', input).then((r) => r.theme);
}

export function updateTheme(id: number, input: ThemeInput): Promise<Theme> {
  return api.put<{ theme: Theme }>(`/content/themes/${id}`, input).then((r) => r.theme);
}

export function setThemeActive(id: number, isActive: boolean): Promise<Theme> {
  return api.patch<{ theme: Theme }>(`/content/themes/${id}/status`, { isActive }).then((r) => r.theme);
}

export function deleteTheme(id: number): Promise<void> {
  return api.delete(`/content/themes/${id}`);
}

export function fetchTopics(options: { themeId?: number; projectId?: number; activeOnly?: boolean } = {}): Promise<Topic[]> {
  const params = new URLSearchParams();
  if (options.themeId) params.set('themeId', String(options.themeId));
  if (options.projectId) params.set('projectId', String(options.projectId));
  if (options.activeOnly) params.set('activeOnly', 'true');

  const query = params.toString();
  return api.get<{ topics: Topic[] }>(`/content/topics${query ? `?${query}` : ''}`).then((r) => r.topics);
}

export function createTopic(input: TopicInput): Promise<Topic> {
  return api.post<{ topic: Topic }>('/content/topics', input).then((r) => r.topic);
}

export function updateTopic(id: number, input: TopicInput): Promise<Topic> {
  return api.put<{ topic: Topic }>(`/content/topics/${id}`, input).then((r) => r.topic);
}

export function deleteTopic(id: number): Promise<void> {
  return api.delete(`/content/topics/${id}`);
}

/** An author's thematic areas. Many-to-many — an author can cover several, and several can cover one. */
export function fetchAuthorThemes(authorId: number): Promise<Theme[]> {
  return api.get<{ themes: Theme[] }>(`/content/authors/${authorId}/themes`).then((r) => r.themes);
}

export function setAuthorThemes(authorId: number, themeIds: number[]): Promise<Theme[]> {
  return api.put<{ themes: Theme[] }>(`/content/authors/${authorId}/themes`, { themeIds }).then((r) => r.themes);
}

export function fetchArticleTypesForTheme(themeId: number): Promise<ArticleTypeOption[]> {
  return api.get<ThemeDetailResponse>(`/content/themes/${themeId}`).then((r) => r.articleTypes);
}
