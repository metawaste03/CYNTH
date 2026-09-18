/**
 * QUALITY GATE + SEO STATUS (Milestone 15).
 *
 *   Quality Gate -> SEO Status -> WordPress Draft
 *
 * Two different questions with two different answers, kept apart on purpose:
 *
 *   Quality  is this a complete, coherent article a person could review?
 *   SEO      will it perform in search?
 *
 *     Quality: Passed     SEO: Needs Attention
 *
 * is an ordinary state, and the user must be able to see it and still open,
 * read and edit the article.
 */

export type QualityGateStatus = 'not_evaluated' | 'passed' | 'passed_with_warnings' | 'failed';

export type SeoStatus = 'not_evaluated' | 'in_progress' | 'passed' | 'needs_attention' | 'failed';

/** How much a failed check matters. Only `blocking` can make an article Fail. */
export type QualitySeverity = 'blocking' | 'warning' | 'advisory';

export type QualityOutcome = 'passed' | 'failed' | 'not_applicable';

export interface QualityCheckResult {
  key: string;
  label: string;
  severity: QualitySeverity;
  outcome: QualityOutcome;
  /** Why this check reached its outcome. A failure always says what would satisfy it. */
  detail: string;
  /** Which part of the workflow fixes this. */
  fix: string | null;
}

export interface QualityCheckGroup {
  key: string;
  label: string;
  checks: QualityCheckResult[];
}

export interface QualityGateDecision {
  articleId: number;
  status: QualityGateStatus;
  failedCount: number;
  warningCount: number;
  passedCount: number;
  groups: QualityCheckGroup[];
  blockingReasons: string[];
  warnings: string[];
  evaluatedAt: string | null;
  /** False when the stored result predates an edit — reported as stale, never silently refreshed. */
  isCurrent: boolean;
  contentFingerprint: string | null;
}

export interface SeoStatusResult {
  articleId: number;
  status: SeoStatus;
  label: string;
  detail: string;
  /** Null is null — never rendered as zero. */
  score: number | null;
  openBlocking: number;
  openWarnings: number;
  analysedAt: string | null;
  analysisMode: string | null;
  aiAnalysisRan: boolean;
  isCurrent: boolean;
}

export interface QualityGateSummary {
  articleId: number;
  status: QualityGateStatus;
  failedCount: number;
  warningCount: number;
  evaluatedAt: string | null;
  isCurrent: boolean;
}

/** One row of the Quality Gate list: both statuses, side by side. */
export interface ReadinessRow {
  articleId: number;
  title: string | null;
  status: string;
  hasGeneratedContent: boolean;
  quality: QualityGateSummary;
  seo: {
    status: SeoStatus;
    label: string;
    score: number | null;
    openBlocking: number;
    openWarnings: number;
    analysedAt: string | null;
    isCurrent: boolean;
  };
}

/** One article's full readiness picture. */
export interface ArticleReadiness {
  articleId: number;
  quality: {
    /** The last stored evaluation. */
    stored: QualityGateDecision;
    /** What the gate would say right now. Differs from `stored` exactly when the article has changed. */
    preview: QualityGateDecision;
  };
  seo: SeoStatusResult;
}

export interface StatusMeta {
  value: string;
  label: string;
  description: string;
}
