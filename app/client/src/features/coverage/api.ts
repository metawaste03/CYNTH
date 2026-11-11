import { api } from '../../shared/services/apiClient';

/**
 * The coverage graph. Reads are free. `sync` embeds whatever changed since the
 * last sync (a fraction of a cent); a subtopic decision writes one row.
 */

export interface CoverageThresholds {
  topicStop: number;
  topicNeighbour: number;
  sectionCut: number;
  maxCutShare: number;
  draftBlock: number;
  pointLink: number;
  subtopicMatch: number;
}

export interface SubtopicRow {
  id: number;
  name: string;
  description: string;
  ring: 'core' | 'adjacent' | 'approved' | 'proposed' | 'rejected';
  coreIdea: string | null;
  primaryArticles: { id: number; title: string }[];
  touchedBy: { id: number; title: string; points: number }[];
  proposedByPipelineId: number | null;
  createdAt: string;
  covered: boolean;
}

export interface CoverageArea {
  themeId: number;
  name: string;
  coreIdea: string;
  articleCount: number;
  subtopics: SubtopicRow[];
}

export interface CoverageMap {
  thresholds: CoverageThresholds;
  graph: { articles: number; points: number; links: number; lastIndexedAt: string | null; model: string | null };
  areas: CoverageArea[];
}

export interface RepeatRow {
  score: number;
  a: { articleId: number; title: string; heading: string };
  b: { articleId: number; title: string; heading: string };
}

export function fetchCoverage(): Promise<CoverageMap> {
  return api.get('/coverage');
}

export function fetchRepeats(limit = 30): Promise<{ draftBlock: number; repeats: RepeatRow[] }> {
  return api.get(`/coverage/repeats?limit=${limit}`);
}

export function syncCoverage(): Promise<{ summary: { indexed: number[]; removed: number[]; promptTokens: number; reportedCost: number | null } }> {
  return api.post('/coverage/sync', {});
}

export function decideSubtopic(id: number, decision: 'approve' | 'reject'): Promise<{ ok: true }> {
  return api.post(`/coverage/subtopics/${id}/decision`, { decision });
}

export function saveThresholds(values: Partial<CoverageThresholds>): Promise<{ thresholds: CoverageThresholds }> {
  return api.put('/coverage/thresholds', values);
}
