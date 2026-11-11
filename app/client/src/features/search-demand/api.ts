import { api } from '../../shared/services/apiClient';

/**
 * Search demand: what people typed into Google, as Search Console reported it.
 * Nothing here costs money. An import reads a file the editor chose.
 */

export interface SearchQueryRow {
  id: number;
  query: string;
  pageUrl: string;
  clicks: number;
  impressions: number;
  position: number | null;
  period: string | null;
  themeId: number | null;
  themeSource: 'page' | 'match' | 'manual' | null;
  articleId: number | null;
  articleTitle: string | null;
  importedAt: string;
}

export interface SearchDemand {
  total: number;
  lastImportedAt: string | null;
  themes: { id: number; name: string; queries: SearchQueryRow[] }[];
  unfiled: SearchQueryRow[];
}

export interface ImportSummary {
  rows: number;
  added: number;
  updated: number;
  filed: number;
  unfiled: number;
  skipped: number;
}

export function fetchSearchDemand(): Promise<SearchDemand> {
  return api.get('/search-demand');
}

export function importSearchQueries(csv: string, period: string): Promise<{ summary: ImportSummary }> {
  return api.post('/search-demand/import', { csv, period });
}

export function fileSearchQuery(id: number, themeId: number | null): Promise<{ query: SearchQueryRow }> {
  return api.patch(`/search-demand/${id}`, { themeId });
}

export function deleteSearchQuery(id: number): Promise<void> {
  return api.delete(`/search-demand/${id}`);
}

/** The direct connection to Google Search Console. The key itself never comes back. */
export interface SearchConsoleStatus {
  connected: boolean;
  clientEmail: string | null;
  siteUrl: string | null;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncMessage: string | null;
}

export function fetchSearchConsoleStatus(): Promise<{ status: SearchConsoleStatus }> {
  return api.get('/search-demand/console');
}

export function saveSearchConsoleKey(
  key: string,
): Promise<{ status: SearchConsoleStatus; sites: string[]; warning: string | null }> {
  return api.put('/search-demand/console/key', { key });
}

export function fetchSearchConsoleSites(): Promise<{ sites: string[] }> {
  return api.get('/search-demand/console/sites');
}

export function chooseSearchConsoleSite(siteUrl: string): Promise<{ status: SearchConsoleStatus }> {
  return api.put('/search-demand/console/site', { siteUrl });
}

export function disconnectSearchConsole(): Promise<{ status: SearchConsoleStatus }> {
  return api.delete('/search-demand/console');
}

export function syncSearchConsole(): Promise<{ summary: ImportSummary; startDate: string; endDate: string; status: SearchConsoleStatus }> {
  return api.post('/search-demand/console/sync', {});
}
