import { getSetting, setSetting } from '../../shared/settings/settings.repository.js';
import type { SeoGateCheck, SeoGateCriteria, SeoGateDecision, StoredSeoFinding } from './seo.types.js';
import type { ArticleSeoRecord } from './seo.repository.js';
import type { SeoAnalysisRun } from './seo.types.js';

/**
 * THE SEO GATE.
 *
 *   Cynth Draft -> SEO Analysis -> SEO Findings -> User Review -> SEO Ready
 *   -> WordPress Draft
 *
 * The checkpoint an article passes before it may be handed to a CMS.
 *
 * Two things it deliberately is not:
 *
 *   - It is NOT a score threshold. A perfect score is never required, and by
 *     default no minimum score is required at all. An article can be SEO-ready
 *     at 62 if nothing about it is actually broken.
 *   - It is NOT a silent refusal. Every criterion reports its own verdict and
 *     its own reason, satisfied or not, so "not ready" always says which rule
 *     decided and what would satisfy it.
 *
 * Every criterion is configurable, including whether the gate runs at all.
 */

export const SEO_GATE_SETTINGS_KEY = 'seo.gate.criteria';

/**
 * The default criteria.
 *
 * `requireAnalysis` defaults to true because the whole point of the gate is
 * that an article reaches the CMS having been looked at. `requireAiAnalysis`
 * defaults to false because the deterministic pass is free and the AI pass
 * may not be — requiring a paid step to publish would be a cost decision
 * disguised as a quality one.
 *
 * `minScore` defaults to null: no minimum. Blocking findings are what stop a
 * push, not a number.
 */
export const DEFAULT_GATE_CRITERIA: SeoGateCriteria = {
  enforceBeforePush: true,
  requireAnalysis: true,
  requireAiAnalysis: false,
  blockOnBlocking: true,
  maxWarnings: null,
  minScore: null,
  requireSeoTitle: false,
  requireMetaDescription: false,
  requireTargetQuery: false,
  requireCurrentAnalysis: true,
};

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function coerceNullableNumber(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

export function getGateCriteria(): SeoGateCriteria {
  const raw = getSetting(SEO_GATE_SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_GATE_CRITERIA };

  try {
    const stored = JSON.parse(raw) as Partial<SeoGateCriteria>;
    return {
      enforceBeforePush: coerceBoolean(stored.enforceBeforePush, DEFAULT_GATE_CRITERIA.enforceBeforePush),
      requireAnalysis: coerceBoolean(stored.requireAnalysis, DEFAULT_GATE_CRITERIA.requireAnalysis),
      requireAiAnalysis: coerceBoolean(stored.requireAiAnalysis, DEFAULT_GATE_CRITERIA.requireAiAnalysis),
      blockOnBlocking: coerceBoolean(stored.blockOnBlocking, DEFAULT_GATE_CRITERIA.blockOnBlocking),
      maxWarnings: coerceNullableNumber(stored.maxWarnings, DEFAULT_GATE_CRITERIA.maxWarnings),
      minScore: coerceNullableNumber(stored.minScore, DEFAULT_GATE_CRITERIA.minScore),
      requireSeoTitle: coerceBoolean(stored.requireSeoTitle, DEFAULT_GATE_CRITERIA.requireSeoTitle),
      requireMetaDescription: coerceBoolean(
        stored.requireMetaDescription,
        DEFAULT_GATE_CRITERIA.requireMetaDescription,
      ),
      requireTargetQuery: coerceBoolean(stored.requireTargetQuery, DEFAULT_GATE_CRITERIA.requireTargetQuery),
      requireCurrentAnalysis: coerceBoolean(
        stored.requireCurrentAnalysis,
        DEFAULT_GATE_CRITERIA.requireCurrentAnalysis,
      ),
    };
  } catch {
    // A corrupt setting falls back to the safe defaults rather than
    // disabling the gate, which would be the dangerous direction to fail in.
    return { ...DEFAULT_GATE_CRITERIA };
  }
}

export function saveGateCriteria(input: Partial<SeoGateCriteria>): SeoGateCriteria {
  const merged: SeoGateCriteria = { ...getGateCriteria(), ...input };
  setSetting(SEO_GATE_SETTINGS_KEY, JSON.stringify(merged));
  return getGateCriteria();
}

export interface GateInput {
  articleId: number;
  seo: ArticleSeoRecord;
  latestRun: SeoAnalysisRun | null;
  /** Findings from the latest run. Dismissed ones do not count — that is what dismissing means. */
  findings: StoredSeoFinding[];
  /** Fingerprint of the article's current content, to detect an analysis that has gone stale. */
  currentContentFingerprint: string | null;
  criteria?: SeoGateCriteria;
}

function check(key: string, label: string, enforced: boolean, passed: boolean, detail: string): SeoGateCheck {
  return { key, label, enforced, passed: enforced ? passed : true, detail };
}

export function evaluateSeoGate(input: GateInput): SeoGateDecision {
  const criteria = input.criteria ?? getGateCriteria();
  const checks: SeoGateCheck[] = [];
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  const open = input.findings.filter((finding) => finding.status === 'open');
  const blocking = open.filter((finding) => finding.severity === 'blocking');
  const warningFindings = open.filter((finding) => finding.severity === 'warning');
  const score = input.latestRun?.score ?? input.seo.latestScore ?? null;

  const analysisIsCurrent =
    input.latestRun !== null &&
    (input.currentContentFingerprint === null ||
      input.latestRun.contentFingerprint === null ||
      input.latestRun.contentFingerprint === input.currentContentFingerprint);

  /* ------------------------------------------------------------ analysis */

  const hasAnalysis = input.latestRun !== null;
  checks.push(
    check(
      'analysis',
      'SEO analysis has been run',
      criteria.requireAnalysis,
      hasAnalysis,
      hasAnalysis
        ? `Last analysed ${input.latestRun!.createdAt} (${input.latestRun!.mode}).`
        : 'This article has never been analysed. The deterministic pass is free and takes no time.',
    ),
  );
  if (criteria.requireAnalysis && !hasAnalysis) {
    blockingReasons.push('No SEO analysis has been run for this article.');
  } else if (!hasAnalysis) {
    warnings.push('This article has not been analysed for SEO.');
  }

  const aiRan = input.latestRun?.mode === 'ai' || input.latestRun?.mode === 'combined';
  checks.push(
    check(
      'ai_analysis',
      'AI-assisted analysis has been run',
      criteria.requireAiAnalysis,
      aiRan,
      aiRan
        ? `An AI pass ran using ${input.latestRun?.model ?? 'the configured model'}.`
        : 'Only the deterministic pass has run. Search intent, content relevance and topical coverage are unassessed.',
    ),
  );
  if (criteria.requireAiAnalysis && !aiRan) {
    blockingReasons.push('An AI-assisted SEO analysis is required and has not been run.');
  } else if (!aiRan && hasAnalysis) {
    warnings.push('Search intent, content relevance and topical coverage were not assessed — no AI pass has run.');
  }

  checks.push(
    check(
      'analysis_current',
      'The analysis describes the current article',
      criteria.requireCurrentAnalysis && hasAnalysis,
      analysisIsCurrent,
      analysisIsCurrent
        ? 'The stored analysis matches the article as it stands.'
        : 'The article has changed since it was analysed, so these findings may no longer be accurate.',
    ),
  );
  if (criteria.requireCurrentAnalysis && hasAnalysis && !analysisIsCurrent) {
    blockingReasons.push('The article has changed since the last SEO analysis. Re-run it.');
  }

  /* ------------------------------------------------------------ findings */

  checks.push(
    check(
      'blocking_findings',
      'No open blocking findings',
      criteria.blockOnBlocking,
      blocking.length === 0,
      blocking.length === 0
        ? 'No blocking findings are open.'
        : `${blocking.length} blocking finding(s): ${blocking.map((finding) => finding.summary).join(' ')}`,
    ),
  );
  if (criteria.blockOnBlocking && blocking.length > 0) {
    for (const finding of blocking) blockingReasons.push(finding.summary);
  }

  const warningLimit = criteria.maxWarnings;
  checks.push(
    check(
      'warnings',
      warningLimit === null ? 'Warnings are advisory' : `At most ${warningLimit} open warnings`,
      warningLimit !== null,
      warningLimit === null || warningFindings.length <= warningLimit,
      warningLimit === null
        ? `${warningFindings.length} open warning(s). No limit is configured, so these do not block.`
        : `${warningFindings.length} open warning(s) against a limit of ${warningLimit}.`,
    ),
  );
  if (warningLimit !== null && warningFindings.length > warningLimit) {
    blockingReasons.push(
      `${warningFindings.length} open warnings exceed the configured limit of ${warningLimit}.`,
    );
  } else if (warningFindings.length > 0) {
    warnings.push(`${warningFindings.length} open warning(s) to review.`);
  }

  /* --------------------------------------------------------------- score */

  checks.push(
    check(
      'score',
      criteria.minScore === null ? 'No minimum score is required' : `Score of at least ${criteria.minScore}`,
      criteria.minScore !== null,
      criteria.minScore === null || (score !== null && score >= criteria.minScore),
      criteria.minScore === null
        ? `Score ${score ?? 'not calculated'}. No minimum is configured — a perfect score is never required.`
        : `Score ${score ?? 'not calculated'} against a minimum of ${criteria.minScore}.`,
    ),
  );
  if (criteria.minScore !== null && (score === null || score < criteria.minScore)) {
    blockingReasons.push(
      score === null
        ? 'No SEO score has been calculated, and a minimum score is required.'
        : `The SEO score is ${score}, below the required minimum of ${criteria.minScore}.`,
    );
  }

  /* ------------------------------------------------------------ metadata */

  const hasSeoTitle = Boolean(input.seo.metadata.seoTitle?.trim());
  checks.push(
    check(
      'seo_title',
      'An SEO title is set',
      criteria.requireSeoTitle,
      hasSeoTitle,
      hasSeoTitle ? 'An SEO title is set.' : 'No SEO title is set; the article title would be used instead.',
    ),
  );
  if (criteria.requireSeoTitle && !hasSeoTitle) blockingReasons.push('An SEO title is required and is not set.');

  const hasMetaDescription = Boolean(input.seo.metadata.metaDescription?.trim());
  checks.push(
    check(
      'meta_description',
      'A meta description is set',
      criteria.requireMetaDescription,
      hasMetaDescription,
      hasMetaDescription
        ? 'A meta description is set.'
        : 'No meta description is set; the search engine would write its own.',
    ),
  );
  if (criteria.requireMetaDescription && !hasMetaDescription) {
    blockingReasons.push('A meta description is required and is not set.');
  }

  const hasTargetQuery = Boolean(input.seo.configuration.targetQuery?.trim());
  checks.push(
    check(
      'target_query',
      'A target search query is set',
      criteria.requireTargetQuery,
      hasTargetQuery,
      hasTargetQuery
        ? `Target query: "${input.seo.configuration.targetQuery}".`
        : 'No target query is set. This is a valid configuration for a topic-oriented article.',
    ),
  );
  if (criteria.requireTargetQuery && !hasTargetQuery) {
    blockingReasons.push('A target search query is required and is not set.');
  }

  return {
    articleId: input.articleId,
    ready: blockingReasons.length === 0,
    enforced: criteria.enforceBeforePush,
    checks,
    blockingReasons,
    warnings,
    score,
    analysisId: input.latestRun?.id ?? null,
    analysedAt: input.latestRun?.createdAt ?? null,
    analysisIsCurrent,
    criteria,
  };
}

/** The readiness label stored alongside the article, for lists and badges. */
export function readinessFrom(decision: SeoGateDecision, hasAnalysis: boolean): string {
  if (!hasAnalysis) return 'not_analyzed';
  if (!decision.ready) return 'blocked';
  return decision.warnings.length ? 'warnings' : 'ready';
}
