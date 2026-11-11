/**
 * THE QUALITY GATE (Milestone 15).
 *
 *   Article Generation -> QUALITY GATE -> SEO Status -> WordPress Draft
 *
 * The readiness checkpoint that asks one question: is this a complete,
 * coherent article a person could sit down and review?
 *
 * It is deliberately NOT the SEO gate, and the two must never be merged:
 *
 *   Quality asks   "did generation actually produce an article, and is its
 *                   editorial configuration present?"
 *   SEO asks       "will this article perform in search?"
 *
 * Those have different answers, and
 *
 *     Quality: Passed     SEO: Needs Attention
 *
 * is a perfectly ordinary state — one the user must be able to see and act on
 * rather than being blocked by a single conflated verdict.
 *
 * Nothing in this feature contacts a model, and nothing in it writes to the
 * articles table. The gate observes an article; it never edits one, and it
 * never spends money.
 */

/** How much a failed check matters. */
export type QualitySeverity =
  /** The article is not reviewable until this is fixed. */
  | 'blocking'
  /** Reviewable, but something a person should look at. */
  | 'warning'
  /** Informational: reported, never counted against the article. */
  | 'advisory';

export type QualityOutcome = 'passed' | 'failed' | 'not_applicable';

/**
 * The overall verdict.
 *
 * Four states rather than a number, because a single score would hide the one
 * thing the user actually needs — WHICH check failed and what would satisfy
 * it. Every status here is reconstructible from the check list below it.
 */
export type QualityGateStatus = 'not_evaluated' | 'passed' | 'passed_with_warnings' | 'failed';

export interface QualityCheckResult {
  /** Stable machine key, e.g. 'content_present'. Safe to persist and to test against. */
  key: string;
  /** What the check is called, in the UI. */
  label: string;
  severity: QualitySeverity;
  outcome: QualityOutcome;
  /**
   * Why this check reached its outcome, in a sentence a person can act on.
   * A failed check must always say what would satisfy it — "the user should
   * be able to understand why an article failed" is the requirement, and a
   * bare "Failed" does not meet it.
   */
  detail: string;
  /** Which part of the workflow fixes this, so the UI can link to it. */
  fix: string | null;
}

/** One group of checks, so the UI can show structure rather than a flat list of twenty rows. */
export interface QualityCheckGroup {
  key: string;
  label: string;
  checks: QualityCheckResult[];
}

export interface QualityGateDecision {
  articleId: number;
  status: QualityGateStatus;
  /** Counts across every check that ran. */
  failedCount: number;
  warningCount: number;
  passedCount: number;
  groups: QualityCheckGroup[];
  /** Every blocking failure, in the order they were checked. Empty when the article passes. */
  blockingReasons: string[];
  /** Non-blocking things worth a look. An article with warnings still passes. */
  warnings: string[];
  evaluatedAt: string | null;
  /**
   * Whether the stored result still describes the article as it stands. A
   * stale result is reported as stale rather than quietly trusted.
   */
  isCurrent: boolean;
  contentFingerprint: string | null;
}

/** The four statuses, with the wording the UI uses. Kept server-side so label and meaning travel together. */
export const QUALITY_STATUS_META: Record<QualityGateStatus, { label: string; description: string }> = {
  not_evaluated: {
    label: 'Not Evaluated',
    description: 'The Quality Gate has not been run for this article.',
  },
  passed: {
    label: 'Passed',
    description: 'Every check succeeded. The article is complete enough to review.',
  },
  passed_with_warnings: {
    label: 'Passed with Warnings',
    description: 'Nothing blocks review, but some checks want a look before this goes further.',
  },
  failed: {
    label: 'Failed',
    description: 'At least one blocking check failed. The article is not ready to be reviewed.',
  },
};
