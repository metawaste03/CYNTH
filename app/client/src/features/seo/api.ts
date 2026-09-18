import { api } from '../../shared/services/apiClient';
import type {
  ArticleSeoRecord,
  ArticleSeoSummary,
  BacklinkOpportunity,
  ExternalSourceOpportunity,
  ImageSeoRequirement,
  InternalLinkOpportunity,
  SeoAnalysisOutcome,
  SeoAnalysisRun,
  SeoConfiguration,
  SeoFinding,
  SeoGateCriteria,
  SeoMetadata,
  SeoOverview,
  SeoRecommendation,
  WebCapabilities,
  WebSource,
  WebSourceInput,
} from '../../shared/types/seo';

/**
 * The SEO Engine's API surface.
 *
 * Note what `analyzeArticle` requires: `includeAi` and `confirmedCost` are
 * explicit parameters with no defaults that spend money. Calling it with no
 * options runs the free deterministic analysis and contacts nothing.
 */

export function fetchSeoOverview(articleId: number): Promise<SeoOverview> {
  return api.get<{ seo: SeoOverview }>(`/seo/articles/${articleId}`).then((r) => r.seo);
}

export function fetchSeoSummaries(): Promise<ArticleSeoSummary[]> {
  return api.get<{ articles: ArticleSeoSummary[] }>('/seo/articles').then((r) => r.articles);
}

export function saveSeoConfiguration(
  articleId: number,
  configuration: SeoConfiguration,
): Promise<ArticleSeoRecord> {
  return api
    .put<{ record: ArticleSeoRecord }>(`/seo/articles/${articleId}/configuration`, configuration)
    .then((r) => r.record);
}

export function saveSeoMetadata(articleId: number, metadata: SeoMetadata): Promise<ArticleSeoRecord> {
  return api.put<{ record: ArticleSeoRecord }>(`/seo/articles/${articleId}/metadata`, metadata).then((r) => r.record);
}

export interface AnalyzeOptions {
  /** Off by default. The deterministic pass always runs and is always free. */
  includeAi?: boolean;
  /** A deliberate acceptance of cost. Never sent unless the user clicked to confirm. */
  confirmedCost?: boolean;
  /** Re-run the AI pass even when an identical analysis is already on record. */
  force?: boolean;
  modelId?: number | null;
}

export function analyzeArticle(articleId: number, options: AnalyzeOptions = {}): Promise<SeoAnalysisOutcome> {
  return api.post<SeoAnalysisOutcome>(`/seo/articles/${articleId}/analyze`, options);
}

export function fetchAnalysisRuns(articleId: number): Promise<SeoAnalysisRun[]> {
  return api.get<{ runs: SeoAnalysisRun[] }>(`/seo/articles/${articleId}/runs`).then((r) => r.runs);
}

export function setFindingStatus(
  findingId: number,
  status: 'open' | 'dismissed' | 'resolved',
): Promise<SeoFinding> {
  return api.patch<{ finding: SeoFinding }>(`/seo/findings/${findingId}`, { status }).then((r) => r.finding);
}

/**
 * Approving a recommendation.
 *
 * `applied` in the response says whether anything actually changed: true for
 * an SEO metadata field with a proposed value, false for advice about the
 * article body, which Cynth records but never applies.
 */
export function setRecommendationStatus(
  id: number,
  status: 'proposed' | 'approved' | 'rejected',
): Promise<{ recommendation: SeoRecommendation; applied: boolean; note?: string; record?: ArticleSeoRecord }> {
  return api.patch(`/seo/recommendations/${id}`, { status });
}

export function setInternalLinkStatus(
  id: number,
  status: 'proposed' | 'approved' | 'rejected',
): Promise<InternalLinkOpportunity> {
  return api
    .patch<{ link: InternalLinkOpportunity }>(`/seo/internal-links/${id}`, { status })
    .then((r) => r.link);
}

export function setExternalSourceStatus(
  id: number,
  status: 'proposed' | 'approved' | 'rejected',
): Promise<ExternalSourceOpportunity> {
  return api
    .patch<{ source: ExternalSourceOpportunity }>(`/seo/external-sources/${id}`, { status })
    .then((r) => r.source);
}

export function setImageRequirementStatus(
  id: number,
  status: 'proposed' | 'approved' | 'rejected',
): Promise<ImageSeoRequirement> {
  return api
    .patch<{ requirement: ImageSeoRequirement }>(`/seo/image-requirements/${id}`, { status })
    .then((r) => r.requirement);
}

/* ---------------------------------------------------------------- gate --- */

export function fetchGateCriteria(): Promise<SeoGateCriteria> {
  return api.get<{ criteria: SeoGateCriteria }>('/seo/gate/criteria').then((r) => r.criteria);
}

export function saveGateCriteria(criteria: Partial<SeoGateCriteria>): Promise<SeoGateCriteria> {
  return api.put<{ criteria: SeoGateCriteria }>('/seo/gate/criteria', criteria).then((r) => r.criteria);
}

/* --------------------------------------------------- web intelligence --- */

export function fetchWebCapabilities(): Promise<WebCapabilities> {
  return api.get<WebCapabilities>('/web-intelligence/capabilities');
}

export function fetchWebSources(): Promise<WebSource[]> {
  return api.get<{ sources: WebSource[] }>('/web-intelligence/sources').then((r) => r.sources);
}

export function createWebSource(input: WebSourceInput): Promise<WebSource> {
  return api.post<{ source: WebSource }>('/web-intelligence/sources', input).then((r) => r.source);
}

export function updateWebSource(id: number, input: WebSourceInput): Promise<WebSource> {
  return api.put<{ source: WebSource }>(`/web-intelligence/sources/${id}`, input).then((r) => r.source);
}

export function deleteWebSource(id: number): Promise<void> {
  return api.delete(`/web-intelligence/sources/${id}`);
}

export function fetchBacklinkOpportunities(articleId?: number): Promise<BacklinkOpportunity[]> {
  const query = articleId ? `?articleId=${articleId}` : '';
  return api
    .get<{ opportunities: BacklinkOpportunity[] }>(`/web-intelligence/backlinks${query}`)
    .then((r) => r.opportunities);
}

export function setBacklinkStatus(
  id: number,
  status: BacklinkOpportunity['status'],
): Promise<BacklinkOpportunity> {
  return api
    .patch<{ opportunity: BacklinkOpportunity }>(`/web-intelligence/backlinks/${id}`, { status })
    .then((r) => r.opportunity);
}
