import { api } from '../../shared/services/apiClient';

export type MediaKind = 'featured' | 'inline' | 'diagram' | 'screenshot' | 'other';
export type MediaRole = 'featured' | 'inline';

export interface MediaAsset {
  id: number;
  url: string;
  originalFilename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  title: string;
  description: string | null;
  altText: string | null;
  themeId: number | null;
  themeName: string | null;
  kind: MediaKind;
  tags: string[];
  credit: string | null;
  isActive: boolean;
  /** How many articles use it, so nothing is deleted blindly. */
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MediaSuggestion {
  asset: MediaAsset;
  score: number;
  /** Why it scored what it scored. Shown so a ranking is never unexplained. */
  reasons: string[];
}

export interface MediaSuggestionResult {
  articleId: number;
  themeId: number | null;
  themeName: string | null;
  consideredCount: number;
  suggestions: MediaSuggestion[];
  notes: string[];
}

export interface ArticleMedia {
  id: number;
  articleId: number;
  mediaId: number;
  role: MediaRole;
  sectionKey: string | null;
  position: number;
  origin: 'manual' | 'suggested';
  asset: MediaAsset | null;
  createdAt: string;
}

export interface MediaFilters {
  themeId?: number | 'none';
  kind?: MediaKind;
  search?: string;
  activeOnly?: boolean;
}

function query(filters: MediaFilters): string {
  const params = new URLSearchParams();
  if (filters.themeId !== undefined) params.set('themeId', String(filters.themeId));
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.search) params.set('search', filters.search);
  if (filters.activeOnly) params.set('status', 'active');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchMedia(filters: MediaFilters = {}): Promise<MediaAsset[]> {
  return api.get<{ media: MediaAsset[] }>(`/media${query(filters)}`).then((r) => r.media);
}

/** Multipart: the file plus the descriptive fields that make it findable later. */
export function uploadMedia(file: File, fields: Partial<MediaAsset> & { tags?: string }): Promise<MediaAsset> {
  const form = new FormData();
  form.append('file', file);
  if (fields.title) form.append('title', fields.title);
  if (fields.description) form.append('description', fields.description);
  if (fields.altText) form.append('altText', fields.altText);
  if (fields.kind) form.append('kind', fields.kind);
  if (fields.tags) form.append('tags', fields.tags);
  if (fields.credit) form.append('credit', fields.credit);
  form.append('themeId', fields.themeId ? String(fields.themeId) : '');
  return api.upload<{ media: MediaAsset }>('/media', form).then((r) => r.media);
}

export function updateMedia(id: number, input: Record<string, unknown>): Promise<MediaAsset> {
  return api.put<{ media: MediaAsset }>(`/media/${id}`, input).then((r) => r.media);
}

export function deleteMedia(id: number): Promise<void> {
  return api.delete(`/media/${id}`);
}

export function fetchMediaSuggestions(articleId: number, role: MediaRole = 'featured'): Promise<MediaSuggestionResult> {
  return api
    .get<{ suggestion: MediaSuggestionResult }>(`/media/articles/${articleId}/suggest?role=${role}`)
    .then((r) => r.suggestion);
}

export function fetchArticleMedia(articleId: number): Promise<ArticleMedia[]> {
  return api.get<{ media: ArticleMedia[] }>(`/media/articles/${articleId}/media`).then((r) => r.media);
}

export function attachMedia(
  articleId: number,
  mediaId: number,
  options: { role?: MediaRole; origin?: 'manual' | 'suggested'; sectionKey?: string } = {},
): Promise<ArticleMedia> {
  return api
    .post<{ attached: ArticleMedia }>(`/media/articles/${articleId}/media`, { mediaId, ...options })
    .then((r) => r.attached);
}

export function detachMedia(articleId: number, mediaId: number): Promise<void> {
  return api.delete(`/media/articles/${articleId}/media/${mediaId}`);
}
