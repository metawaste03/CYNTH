import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../shared/services/apiClient';
import type { ArticleReadiness, QualityCheckResult, QualityGateDecision } from '../../shared/types/qualityGate';
import { evaluateQualityGate, fetchArticleReadiness } from './api';
import { ReadinessPair } from './StatusBadge';
import './QualityGate.css';

/**
 * THE QUALITY GATE, on one article.
 *
 * Shows every check and its verdict, grouped, with a sentence explaining each
 * one. That explanation is the requirement: "the user should be able to
 * understand why an article failed", which a single number or a bare "Failed"
 * does not deliver.
 *
 * Running the gate is free and contacts nothing. Nothing on this panel
 * blocks: an article that fails is still fully readable and editable, and the
 * only place a gate actually refuses anything is the CMS push path.
 */

function CheckRow({ check }: { check: QualityCheckResult }) {
  /**
   * Severity decides how a FAILED check reads. An advisory failure is
   * reported and never counted against the article — a missing provenance
   * snapshot is a record-keeping gap, not a reason the article is unfit to
   * review — so it must not be dressed as a warning.
   */
  const outcome =
    check.outcome === 'not_applicable'
      ? 'skipped'
      : check.outcome === 'passed'
        ? 'passed'
        : check.severity === 'blocking'
          ? 'blocking'
          : check.severity === 'warning'
            ? 'warning'
            : 'advisory';

  const outcomeLabel = {
    passed: 'Passed',
    blocking: 'Blocking',
    warning: 'Warning',
    advisory: 'For information',
    skipped: 'Not applicable',
  }[outcome];

  return (
    <li className={`quality-check quality-check--${outcome}`}>
      <div className="quality-check__head">
        <span className="quality-check__label">{check.label}</span>
        <span className="quality-check__outcome">{outcomeLabel}</span>
      </div>
      <p className="quality-check__detail">{check.detail}</p>
      {check.fix && check.outcome === 'failed' && <p className="quality-check__fix">Fix: {check.fix}</p>}
    </li>
  );
}

function Decision({ decision }: { decision: QualityGateDecision }) {
  return (
    <>
      <p className="quality-gate__counts">
        {decision.passedCount} passed · {decision.failedCount} blocking · {decision.warningCount} warning
      </p>
      {decision.groups.map((group) => (
        <section key={group.key} className="quality-gate__group">
          <h4>{group.label}</h4>
          <ul className="quality-gate__checks">
            {group.checks.map((check) => (
              <CheckRow key={check.key} check={check} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function QualityGatePanel({ articleId }: { articleId: number }) {
  const [readiness, setReadiness] = useState<ArticleReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(() => {
    fetchArticleReadiness(articleId)
      .then(setReadiness)
      .catch((err) =>
        setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not read this article’s readiness.'),
      );
  }, [articleId]);

  useEffect(load, [load]);

  async function run() {
    setIsBusy(true);
    setError(null);
    try {
      await evaluateQualityGate(articleId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not run the Quality Gate.');
    } finally {
      setIsBusy(false);
    }
  }

  if (!readiness) {
    return (
      <section className="panel quality-gate">
        <h2>Readiness</h2>
        {error ? <p className="form-error">{error}</p> : <p>Loading…</p>}
      </section>
    );
  }

  const { stored, preview } = readiness.quality;
  const hasStored = stored.status !== 'not_evaluated';
  // They differ exactly when the article changed after it was last evaluated.
  const isStale = hasStored && !stored.isCurrent;

  return (
    <section className="panel quality-gate">
      <div className="quality-gate__header">
        <div>
          <h2>Readiness</h2>
          {/* The pair, in workflow order. Quality and SEO are different
              questions — passing one while failing the other is ordinary. */}
          <ReadinessPair
            quality={stored.status}
            seo={readiness.seo.status}
            qualityTitle={hasStored ? `Last evaluated ${stored.evaluatedAt}` : 'The Quality Gate has not been run.'}
            seoTitle={readiness.seo.detail}
          />
        </div>
        <button type="button" className="button button--primary" onClick={() => void run()} disabled={isBusy}>
          {isBusy ? 'Checking…' : hasStored ? 'Re-run Quality Gate' : 'Run Quality Gate'}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      <p className="quality-gate__seo-line">
        <strong>SEO:</strong> {readiness.seo.detail}
        {readiness.seo.score !== null && <> Score {readiness.seo.score}/100.</>}
        {!readiness.seo.aiAnalysisRan && readiness.seo.status !== 'not_evaluated' && (
          <> Only the deterministic pass has run, so search intent and relevance are unassessed.</>
        )}
      </p>

      {/* A stored result that predates an edit is reported as stale rather
          than silently refreshed — an automatic re-run would hide the fact
          that the answer changed. */}
      {isStale && (
        <p className="quality-gate__stale" role="note">
          This article has changed since it was last evaluated ({stored.evaluatedAt}). The checks below are a live
          preview; re-run the gate to store it.
        </p>
      )}

      {hasStored && !isStale ? (
        <Decision decision={stored} />
      ) : (
        <>
          {!hasStored && (
            <p className="quality-gate__preview-note">
              The Quality Gate has not been run for this article. Below is what it would report right now — nothing
              has been saved.
            </p>
          )}
          <Decision decision={preview} />
        </>
      )}
    </section>
  );
}
