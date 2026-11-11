import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../shared/services/apiClient';
import type { ArticleProduct } from '../../shared/types/articleProduct';
import { fetchArticleProducts, fetchPlacementReviewPreflight, reviewPlacements } from './api';
import './ProductResearch.css';

/**
 * Product placement review, on the SEO Review page.
 *
 * It answers one question per product: was this a good place to put it. A
 * good placement is reported as good — a review that only ever complains
 * leaves the editor unable to tell "checked and fine" from "not checked".
 *
 * Nothing here moves a product. A suggested section is shown as a suggestion,
 * and acting on it is the editor's decision, made in the draft.
 */
export function PlacementReviewPanel({ articleId, articleTitle }: { articleId: number; articleTitle: string }) {
  const [rows, setRows] = useState<ArticleProduct[]>([]);
  const [placedCount, setPlacedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const load = useCallback(() => {
    setIsLoading(true);
    Promise.all([fetchArticleProducts(articleId), fetchPlacementReviewPreflight(articleId)])
      .then(([products, preflight]) => {
        setRows(products);
        setPlacedCount(preflight.placedProductCount);
        setIssues(preflight.issues);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load product placements.'))
      .finally(() => setIsLoading(false));
  }, [articleId]);

  useEffect(load, [load]);

  async function run(confirmedCost = false) {
    setBusy(true);
    setError(null);
    try {
      const outcome = await reviewPlacements(articleId, { confirmedCost });
      load();
      const weak = outcome.items.filter((item) => item.verdict === 'weak' || item.verdict === 'misplaced').length;
      setNotice(
        weak === 0
          ? `Reviewed ${outcome.items.length} placement(s) — all read as well placed.`
          : `Reviewed ${outcome.items.length} placement(s); ${weak} could be better placed.`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'cost_confirmation_required') {
        if (window.confirm(`${err.errors.join(' ')}\n\nRun the review anyway?`)) {
          setBusy(false);
          return run(true);
        }
        setError('Review cancelled — nothing was spent.');
      } else {
        setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not review the placements.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <p>Loading product placements…</p>;
  if (!rows.length) return null;

  const placed = rows.filter((row) => row.status === 'placed');
  const omitted = rows.filter((row) => row.status === 'omitted');

  return (
    <section className="content-section">
      <div className="content-section__head">
        <h2>Product Placement</h2>
        <button type="button" className="button" disabled={busy || placedCount === 0} onClick={() => run()}>
          {busy ? 'Reviewing…' : 'Review Placement'}
        </button>
      </div>

      <p className="content-hint">
        Where each product ended up in <Link to={`/articles/${articleId}`}>{articleTitle}</Link>, and whether the
        surrounding content actually leads into it. Advice only — nothing here moves a product.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}
      {placedCount === 0 && issues.length > 0 && <p className="content-hint">{issues.join(' ')}</p>}

      <ul className="content-list">
        {placed.map((row) => (
          <li key={row.id}>
            <div>
              <strong>{row.product?.title ?? `Product ${row.productId}`}</strong>
              <div className="content-list__meta">
                Placed under “{row.placementSection ?? 'no heading'}”
                {row.reviewVerdict && (
                  <span className={`status-badge placement-verdict--${row.reviewVerdict}`}>
                    {row.reviewVerdict === 'good'
                      ? 'Well placed'
                      : row.reviewVerdict === 'acceptable'
                        ? 'Acceptable'
                        : row.reviewVerdict === 'weak'
                          ? 'Could be better placed'
                          : 'Misplaced'}
                  </span>
                )}
              </div>
              {row.reviewAssessment && <div className="content-list__desc">{row.reviewAssessment}</div>}
              {row.reviewSuggestedSection && (
                <div className="placement-suggestion">
                  Suggested instead: <strong>{row.reviewSuggestedSection}</strong> — a suggestion only; move it
                  yourself if you agree.
                </div>
              )}
              {!row.reviewVerdict && <div className="content-list__desc">Not reviewed yet.</div>}
            </div>
          </li>
        ))}
      </ul>

      {omitted.length > 0 && (
        <p className="content-hint">
          Attached but not placed, because the author judged they did not fit:{' '}
          {omitted.map((row) => row.product?.title ?? `Product ${row.productId}`).join(', ')}. That is a valid outcome,
          not a failure.
        </p>
      )}
    </section>
  );
}
