import { api } from '../../shared/services/apiClient';
import type {
  AuthorSkill,
  AuthorSkillInput,
  AuthorSkillScope,
  AuthorSkillSummary,
  LibraryImportReport,
  LibraryListing,
} from '../../shared/types/authorSkill';

export interface AuthorSkillFilters {
  authorId?: number;
  scope?: AuthorSkillScope;
  assignment?: 'assigned' | 'unassigned';
  status?: 'active' | 'inactive';
  search?: string;
}

function buildQuery(filters: AuthorSkillFilters): string {
  const params = new URLSearchParams();
  if (filters.authorId !== undefined) params.set('authorId', String(filters.authorId));
  if (filters.scope) params.set('scope', filters.scope);
  if (filters.assignment) params.set('assignment', filters.assignment);
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchAuthorSkills(filters: AuthorSkillFilters = {}): Promise<AuthorSkillSummary[]> {
  return api.get<{ skills: AuthorSkillSummary[] }>(`/author-skills${buildQuery(filters)}`).then((r) => r.skills);
}

export function fetchAuthorSkill(id: number): Promise<AuthorSkill> {
  return api.get<{ skill: AuthorSkill }>(`/author-skills/${id}`).then((r) => r.skill);
}

export function createAuthorSkill(input: AuthorSkillInput): Promise<AuthorSkill> {
  return api.post<{ skill: AuthorSkill }>('/author-skills', input).then((r) => r.skill);
}

export function updateAuthorSkill(id: number, input: AuthorSkillInput): Promise<AuthorSkill> {
  return api.put<{ skill: AuthorSkill }>(`/author-skills/${id}`, input).then((r) => r.skill);
}

/** Reassignment on its own — "change the author assigned to this skill". Pass null to unassign. */
export function assignAuthorSkill(id: number, authorId: number | null): Promise<AuthorSkill> {
  return api.patch<{ skill: AuthorSkill }>(`/author-skills/${id}/author`, { authorId }).then((r) => r.skill);
}

export function setAuthorSkillStatus(id: number, isActive: boolean): Promise<AuthorSkill> {
  return api.patch<{ skill: AuthorSkill }>(`/author-skills/${id}/status`, { isActive }).then((r) => r.skill);
}

export function deleteAuthorSkill(id: number): Promise<void> {
  return api.delete(`/author-skills/${id}`);
}

/* ------------------------------------------------------- the Author folder */

export function fetchSkillLibrary(): Promise<LibraryListing> {
  return api.get<LibraryListing>('/author-skills/library');
}

export function importSkillFile(
  filename: string,
  options: { authorId?: number | null; scope?: AuthorSkillScope } = {},
): Promise<{ skill: AuthorSkill; updated: boolean }> {
  return api.post<{ skill: AuthorSkill; updated: boolean }>('/author-skills/library/import', {
    filename,
    ...options,
  });
}

/** One-time setup: import every persona document, creating the authors and thematic-area links they name. */
export function importSkillLibrary(): Promise<LibraryImportReport> {
  return api.post<{ report: LibraryImportReport }>('/author-skills/library/import-all', {}).then((r) => r.report);
}

export function exportAuthorSkill(id: number): Promise<{ filename: string; path: string }> {
  return api.post<{ filename: string; path: string }>(`/author-skills/${id}/export`, {});
}
