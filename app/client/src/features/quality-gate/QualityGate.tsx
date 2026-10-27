import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState/EmptyState';
import { ApiError } from '../../shared/services/apiClient';
import type { ReadinessRow } from '../../shared/types/qualityGate';
import { evaluateQualityGate, fetchReadinessRows } from './api';
import { QualityStatusBadge, SeoStatusBadge } from './StatusBadge';
import './QualityGate.css';

/**
 * QUALITY GATE — the cross-article view.
 *
 *   Article Generation -> QUALITY GATE -> SEO Status -> WordPress Draft
 *
 * Both statuses appear in their own column, side by side, because they answer
 * different questions:
 *
 *   Quality  is this a complete, coherent article a person could review?
 *   SEO      will it perform in search?
 *
 * An article can pass one and fail the other, and this page has to make that
 * legible rather than blending them into a single verdict.
 *
 * Nothing here blocks anything, and nothing here costs anything: the Quality
 * Gate is deterministic and local, and the SEO column reads results the SEO
 * engine has already stored rather than re-analysing.
 */

function evaluatedLabel(row: ReadinessRow): string {
  if (row.quality.status === 'not_evaluated') return 'Never evaluated';
  if (!row.quality.isCurrent) return `Evaluated ${row.quality.evaluatedAt} — the article has changed since`;
  return `Evaluated ${row.quality.evaluatedAt}`;
}

export function QualityGate() {
  const [rows, setRows] = useState<ReadinessRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    fetchReadinessRows()
      .then(setRows)
      .catch((err) => {
        setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not load article readiness.');
        setRows([]);
      });
  }, []);

  useEffect(load, [load]);

  async function run(articleId: number) {
    setBusyId(articleId);
    setError(null);
    try {
      await evaluateQualityGate(articleId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not run the Quality Gate.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Quality Gate"
        description="Article readiness, checked before SEO and before anything reaches WordPress. Quality and SEO are separate questions — an article can pass one and fail the other."
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {rows === null ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="qualityGate"
          title="No articles to check yet"
          message="Generate an article and it will appear here with its quality and SEO status."
        />
      ) : (
        <div className="readiness-table__wrap">
          <table className="readiness-table">
            <thead>
              <tr>
                <th scope="col">Article</th>
                <th scope="col">Quality Gate</th>
                <th scope="col">SEO Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.articleId}>
                  <th scope="row" className="readiness-table__title">
                    <Link to={`/articles/${row.articleId}`}>{row.title ?? 'Untitled article'}</Link>
                    {!row.hasGeneratedContent && (
                      <span className="readiness-table__note">Not generated yet</span>
                    )}
                  </th>

                  <td>
                    <QualityStatusBadge status={row.quality.status} />
                    <span className="readiness-table__detail">
                      {row.quality.status === 'not_evaluated'
                        ? 'Run the gate to check this article.'
                        : `${row.quality.failedCount} blocking · ${row.quality.warningCount} warning`}
                    </span>
                    <span className="readiness-table__timestamp">{evaluatedLabel(row)}</span>
                  </td>

                  <td>
                    <SeoStatusBadge status={row.seo.status} />
                    <span className="readiness-table__detail">
                      {row.seo.score === null
                        ? 'No score calculated'
                        : `Score ${row.seo.score}/100 · ${row.seo.openBlocking} blocking · ${row.seo.openWarnings} warning`}
                    </span>
                    <span className="readiness-table__timestamp">
                      {row.seo.analysedAt
                        ? row.seo.isCurrent
                          ? `Analysed ${row.seo.analysedAt}`
                          : `Analysed ${row.seo.analysedAt} — the article has changed since`
                        : 'Never analysed'}
                    </span>
                  </td>

                  <td className="readiness-table__actions">
                    <button
                      type="button"
                      className="button"
                      onClick={() => void run(row.articleId)}
                      disabled={busyId === row.articleId}
                    >
                      {busyId === row.articleId ? 'Checking…' : 'Run Quality Gate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
