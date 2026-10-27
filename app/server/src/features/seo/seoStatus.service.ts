import { getArticleById } from '../articles/articles.repository.js';
import type { ArticleDraftDto } from '../articles/articles.repository.js';
import {
  getArticleSeo,
  getLatestAnalysisAttempt,
  getLatestAnalysisRun,
  listFindingsForAnalysis,
} from './seo.repository.js';
import { evaluateSeoGate } from './seoGate.service.js';
import { contentFingerprint } from './seoAnalysis.service.js';
import type { SeoGateDecision } from './seo.types.js';

/**
 * SEO STATUS (Milestone 15).
 *
 * The SEO engine (Milestone 14) produced runs, findings, a score and a gate
 * decision — everything except one plain answer to "where does this article
 * stand on SEO?". Every screen was left to work that out for itself from four
 * different tables, which is why no screen showed it.
 *
 * This file derives that one answer, and derives it ENTIRELY from what the
 * SEO engine already stored. It runs no analysis, calls no model, invents no
 * finding, and writes nothing. There is one SEO system; this reads it.
 *
 *   Not Evaluated    no analysis has ever run
 *   In Progress      an analysis exists but does not describe the article as
 *                    it stands — either the AI pass did not complete, or the
 *                    article has been edited since
 *   Failed           the last analysis could not be produced at all
 *   Needs Attention  the analysis is complete and current, and it found
 *                    something that stops the article
 *   Passed           complete, current, and nothing blocking
 *
 * Note what Passed does NOT mean: a perfect score. The gate has no minimum
 * score by default and a high score is not a pass condition — an article is
 * SEO-ready when nothing about it is actually broken.
 */

export type SeoStatus = 'not_evaluated' | 'in_progress' | 'passed' | 'needs_attention' | 'failed';

export const SEO_STATUS_META: Record<SeoStatus, { label: string; description: string }> = {
  not_evaluated: {
    label: 'Not Evaluated',
    description: 'No SEO analysis has been run for this article. The deterministic pass is free.',
  },
  in_progress: {
    label: 'In Progress',
    description: 'An analysis exists but does not describe the article as it now stands.',
  },
  passed: {
    label: 'Passed',
    description: 'The analysis is current and nothing blocking is open.',
  },
  needs_attention: {
    label: 'Needs Attention',
    description: 'The analysis found something that would stop this article going to the CMS.',
  },
  failed: {
    label: 'Failed',
    description: 'The last SEO analysis could not be completed.',
  },
};

export interface SeoStatusResult {
  articleId: number;
  status: SeoStatus;
  label: string;
  /** One sentence saying why the status is what it is, for this article specifically. */
  detail: string;
  /** The 0-100 readiness score, when one has been calculated. Null is null — never rendered as zero. */
  score: number | null;
  /** Open findings by severity, from the latest run. */
  openBlocking: number;
  openWarnings: number;
  analysedAt: string | null;
  analysisMode: string | null;
  /** Whether an AI pass has run. False means intent and relevance are unassessed. */
  aiAnalysisRan: boolean;
  /** Whether the stored analysis still describes the current article body. */
  isCurrent: boolean;
  /** The full gate decision, for screens that show the reasoning rather than the badge. */
  gate: SeoGateDecision;
}

/**
 * Derives an article's SEO status from what the engine has stored.
 *
 * Reads only. Opening an article must never trigger an analysis — the AI pass
 * can cost money, and a status badge is not consent to spend it.
 */
export function getSeoStatus(article: ArticleDraftDto): SeoStatusResult {
  const seo = getArticleSeo(article.id);
  // Two different questions: what is the latest USABLE analysis (which the
  // gate evaluates against), and what was the latest ATTEMPT (which is how a
  // failed run is told apart from never having tried).
  const latestRun = getLatestAnalysisRun(article.id);
  const latestAttempt = getLatestAnalysisAttempt(article.id);
  const findings = latestRun ? listFindingsForAnalysis(latestRun.id) : [];

  const gate = evaluateSeoGate({
    articleId: article.id,
    seo,
    latestRun,
    findings,
    currentContentFingerprint: contentFingerprint(article),
  });

  const open = findings.filter((finding) => finding.status === 'open');
  const openBlocking = open.filter((finding) => finding.severity === 'blocking').length;
  const openWarnings = open.filter((finding) => finding.severity === 'warning').length;
  const aiAnalysisRan = latestRun?.mode === 'ai' || latestRun?.mode === 'combined';

  const base = {
    articleId: article.id,
    score: latestRun?.score ?? seo.latestScore ?? null,
    openBlocking,
    openWarnings,
    analysedAt: latestRun?.createdAt ?? null,
    analysisMode: latestRun?.mode ?? null,
    aiAnalysisRan,
    isCurrent: gate.analysisIsCurrent,
    gate,
  };

  const decide = (status: SeoStatus, detail: string): SeoStatusResult => ({
    ...base,
    status,
    label: SEO_STATUS_META[status].label,
    detail,
  });

  // A failed attempt is reported as Failed even when an older successful run
  // exists: the most recent thing that happened is what the user needs to
  // know about, and silently falling back to the older result would present a
  // stale analysis as the current state.
  if (latestAttempt?.status === 'failure') {
    return decide(
      'failed',
      latestAttempt.errorMessage
        ? `The last analysis failed: ${latestAttempt.errorMessage}`
        : 'The last analysis failed and produced no result.',
    );
  }

  if (!latestRun) {
    return decide('not_evaluated', 'This article has never been analysed. The deterministic pass is free and immediate.');
  }

  // 'partial' means the deterministic pass succeeded and the AI pass did not.
  // Reporting that as a completed analysis would overstate what was checked.
  if (latestRun.status === 'partial') {
    return decide(
      'in_progress',
      'The deterministic pass completed but the AI pass did not, so search intent and relevance are unassessed.',
    );
  }

  if (!gate.analysisIsCurrent) {
    return decide(
      'in_progress',
      'The article has been edited since it was last analysed, so these findings describe an older version.',
    );
  }

  if (!gate.ready) {
    return decide(
      'needs_attention',
      gate.blockingReasons.length === 1
        ? gate.blockingReasons[0]
        : `${gate.blockingReasons.length} things would stop this article going to the CMS.`,
    );
  }

  return decide(
    'passed',
    gate.warnings.length
      ? `Nothing blocking is open. ${gate.warnings.length} advisory warning(s) remain.`
      : 'Nothing blocking is open and the analysis is current.',
  );
}

/** Convenience for callers holding only an id. Null when the article does not exist. */
export function getSeoStatusForArticle(articleId: number): SeoStatusResult | null {
  const article = getArticleById(articleId);
  return article ? getSeoStatus(article) : null;
}
