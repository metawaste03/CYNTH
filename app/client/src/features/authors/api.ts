import { api } from '../../shared/services/apiClient';
import type { Author, AuthorDetail, AuthorInput, WritingSample, WritingSampleInput } from '../../shared/types/author';

export interface AuthorListFilters {
  search?: string;
  category?: string;
  status?: 'active' | 'inactive';
}

function buildQuery(filters: AuthorListFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.category) params.set('category', filters.category);
  if (filters.status) params.set('status', filters.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchAuthors(filters: AuthorListFilters = {}): Promise<Author[]> {
  return api.get<{ authors: Author[] }>(`/authors${buildQuery(filters)}`).then((r) => r.authors);
}

export function fetchAuthorCategories(): Promise<string[]> {
  return api.get<{ categories: string[] }>('/authors/meta/categories').then((r) => r.categories);
}

export function fetchAuthor(id: number): Promise<AuthorDetail> {
  return api.get<{ author: AuthorDetail }>(`/authors/${id}`).then((r) => r.author);
}

export function createAuthor(input: AuthorInput): Promise<AuthorDetail> {
  return api.post<{ author: AuthorDetail }>('/authors', input).then((r) => r.author);
}

export function updateAuthor(id: number, input: AuthorInput): Promise<AuthorDetail> {
  return api.put<{ author: AuthorDetail }>(`/authors/${id}`, input).then((r) => r.author);
}

export function setAuthorStatus(id: number, isActive: boolean): Promise<AuthorDetail> {
  return api.patch<{ author: AuthorDetail }>(`/authors/${id}/status`, { isActive }).then((r) => r.author);
}

export function deleteAuthor(id: number): Promise<void> {
  return api.delete(`/authors/${id}`);
}

export function addWritingSample(authorId: number, input: WritingSampleInput): Promise<WritingSample> {
  return api.post<{ sample: WritingSample }>(`/authors/${authorId}/samples`, input).then((r) => r.sample);
}

export function updateWritingSample(
  authorId: number,
  sampleId: number,
  input: WritingSampleInput,
): Promise<WritingSample> {
  return api.put<{ sample: WritingSample }>(`/authors/${authorId}/samples/${sampleId}`, input).then((r) => r.sample);
}

export function deleteWritingSample(authorId: number, sampleId: number): Promise<void> {
  return api.delete(`/authors/${authorId}/samples/${sampleId}`);
}
