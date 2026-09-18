import { api } from '../../shared/services/apiClient';
import type {
  ArticleReadiness,
  QualityGateDecision,
  ReadinessRow,
  SeoStatusResult,
  StatusMeta,
} from '../../shared/types/qualityGate';

/**
 * Every endpoint here is free and side-effect-free apart from `evaluate`,
 * which writes one row. None of them can call a model: the Quality Gate runs
 * deterministic checks, and the SEO status is read from what the SEO engine
 * already stored rather than by re-analysing anything.
 */

export function fetchStatusMeta(): Promise<{ qualityStatuses: StatusMeta[]; seoStatuses: StatusMeta[] }> {
  return api.get('/quality-gate/meta');
}

/** Every article with its stored Quality Gate status and its SEO status. Evaluates nothing. */
export function fetchReadinessRows(): Promise<ReadinessRow[]> {
  return api.get<{ articles: ReadinessRow[] }>('/quality-gate').then((r) => r.articles);
}

/** One article's readiness: the stored result, a fresh preview, and the SEO status. */
export function fetchArticleReadiness(articleId: number): Promise<ArticleReadiness> {
  return api.get<ArticleReadiness>(`/quality-gate/${articleId}`);
}

/** Runs the gate and stores the result. */
export function evaluateQualityGate(
  articleId: number,
): Promise<{ quality: QualityGateDecision; seo: SeoStatusResult }> {
  return api.post(`/quality-gate/${articleId}/evaluate`, {});
}
