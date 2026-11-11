import { getDatabase } from '../../shared/database/index.js';
import type { ArticleQualityGateRow } from '../../shared/database/types.js';
import { getArticleById } from '../articles/articles.repository.js';
import { contentFingerprint } from '../seo/seoAnalysis.service.js';
import { evaluateQualityGate } from './qualityGate.service.js';
import type { QualityCheckGroup, QualityGateDecision, QualityGateStatus } from './qualityGate.types.js';

/**
 * Persistence for the Quality Gate.
 *
 * One row per article, holding the LATEST evaluation. History is deliberately
 * not kept: unlike a generation attempt, which cost something and can never
 * be repeated, a quality evaluation is free and reproducible — re-running it
 * is always cheaper than storing every result that ever was.
 *
 * Nothing here writes to the `articles` table. The gate observes an article;
 * it never edits one.
 */

/** The statuses a stored row may hold. An unrecognised value reads as not_evaluated rather than throwing. */
function readStatus(raw: string | null): QualityGateStatus {
  return raw === 'passed' || raw === 'passed_with_warnings' || raw === 'failed' ? raw : 'not_evaluated';
}

function readGroups(raw: string | null): QualityCheckGroup[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QualityCheckGroup[]) : [];
  } catch {
    // A corrupt blob must not make the article unreadable. The counts stored
    // alongside it are still true, and re-evaluating restores the detail.
    return [];
  }
}

/**
 * The stored decision for an article, or a not_evaluated one when it has
 * never been run.
 *
 * `isCurrent` compares the stored fingerprint against the article as it
 * stands now, so an evaluation that predates an edit is reported as stale
 * rather than presented as current. Cynth does not silently re-run it: an
 * automatic re-evaluation would hide the fact that the answer changed.
 */
export function getStoredDecision(articleId: number): QualityGateDecision {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM article_quality_gate WHERE article_id = ?')
    .get(articleId) as unknown as ArticleQualityGateRow | undefined;

  const article = getArticleById(articleId);
  const current = article ? contentFingerprint(article) : null;

  if (!row) {
    return {
      articleId,
      status: 'not_evaluated',
      failedCount: 0,
      warningCount: 0,
      passedCount: 0,
      groups: [],
      blockingReasons: [],
      warnings: [],
      evaluatedAt: null,
      isCurrent: false,
      contentFingerprint: null,
    };
  }

  const groups = readGroups(row.checks);
  const failed = groups.flatMap((group) => group.checks).filter((check) => check.outcome === 'failed');

  return {
    articleId,
    status: readStatus(row.status),
    failedCount: row.failed_count,
    warningCount: row.warning_count,
    passedCount: row.passed_count,
    groups,
    blockingReasons: failed.filter((check) => check.severity === 'blocking').map((check) => check.detail),
    warnings: failed.filter((check) => check.severity === 'warning').map((check) => check.detail),
    evaluatedAt: row.evaluated_at,
    // A null fingerprint on either side means "cannot tell", which is
    // reported as not current rather than assumed to match.
    isCurrent: Boolean(row.content_fingerprint && current && row.content_fingerprint === current),
    contentFingerprint: row.content_fingerprint,
  };
}

/** Runs the gate and stores the result. Returns the decision, with its evaluation timestamp filled in. */
export function evaluateAndStore(articleId: number): QualityGateDecision | null {
  const article = getArticleById(articleId);
  if (!article) return null;

  const decision = evaluateQualityGate(article);
  const db = getDatabase();

  db.prepare(`
    INSERT INTO article_quality_gate (
      article_id, status, failed_count, warning_count, passed_count, checks, content_fingerprint, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(article_id) DO UPDATE SET
      status = excluded.status,
      failed_count = excluded.failed_count,
      warning_count = excluded.warning_count,
      passed_count = excluded.passed_count,
      checks = excluded.checks,
      content_fingerprint = excluded.content_fingerprint,
      evaluated_at = excluded.evaluated_at,
      updated_at = datetime('now')
  `).run(
    articleId,
    decision.status,
    decision.failedCount,
    decision.warningCount,
    decision.passedCount,
    JSON.stringify(decision.groups),
    decision.contentFingerprint,
  );

  return getStoredDecision(articleId);
}

export interface QualityGateSummary {
  articleId: number;
  status: QualityGateStatus;
  failedCount: number;
  warningCount: number;
  evaluatedAt: string | null;
  isCurrent: boolean;
}

/**
 * The stored status for many articles at once, for list views.
 *
 * Returns only what has actually been evaluated. An article with no row is
 * absent from the map, and the caller renders 'Not Evaluated' — which is the
 * truth, rather than a status invented to fill a column.
 */
export function summariesFor(articleIds: number[]): Map<number, QualityGateSummary> {
  const summaries = new Map<number, QualityGateSummary>();
  if (articleIds.length === 0) return summaries;

  const db = getDatabase();
  const placeholders = articleIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT q.*, a.title, a.generated_title, a.content
       FROM article_quality_gate q
       JOIN articles a ON a.id = q.article_id
       WHERE q.article_id IN (${placeholders})`,
    )
    .all(...articleIds) as unknown as (ArticleQualityGateRow & {
    title: string | null;
    generated_title: string | null;
    content: string | null;
  })[];

  for (const row of rows) {
    const article = getArticleById(row.article_id);
    const current = article ? contentFingerprint(article) : null;
    summaries.set(row.article_id, {
      articleId: row.article_id,
      status: readStatus(row.status),
      failedCount: row.failed_count,
      warningCount: row.warning_count,
      evaluatedAt: row.evaluated_at,
      isCurrent: Boolean(row.content_fingerprint && current && row.content_fingerprint === current),
    });
  }

  return summaries;
}
