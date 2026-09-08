import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import type { ArticleSeoSummary, SeoGateCriteria } from '../../shared/types/seo';
import { fetchGateCriteria, fetchSeoSummaries, saveGateCriteria } from '../seo/api';
import { WebSourcesPanel } from '../seo/WebSourcesPanel';
import { PlacementReviewPanel } from '../product-research/PlacementReviewPanel';
import '../seo/Seo.css';

/**
 * SEO REVIEW — the cross-article view.
 *
 * Deliberately a summary, not a second SEO engine. The work happens on the
 * Article, where the context is; this page answers "which articles need
 * attention", and holds the two pieces of configuration that are not
 * per-article: the gate criteria and the authorised web sources.
 */

/**
 * The SEO status badge.
 *
 * Reads the server-derived status (Milestone 15) rather than re-deriving a
 * label from score, findings and gate — which is what every screen used to
 * do, differently, and why no two of them agreed.
 */
function readinessLabel(summary: ArticleSeoSummary): { text: string; className: string } {
  if (!summary.isGenerated) return { text: 'Not generated', className: 'not-analysed' };

  switch (summary.seoStatus) {
    case 'passed':
      return { text: 'Passed', className: 'ready' };
    case 'needs_attention':
      return { text: 'Needs Attention', className: 'blocked' };
    case 'in_progress':
      return { text: 'In Progress', className: 'not-analysed' };
    case 'failed':
      return { text: 'Failed', className: 'blocked' };
    default:
      return { text: 'Not Evaluated', className: 'not-analysed' };
  }
}

function GateSettings() {
  const [criteria, setCriteria] = useState<SeoGateCriteria | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGateCriteria()
      .then(setCriteria)
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not load the gate criteria.'));
  }, []);

  async function update(patch: Partial<SeoGateCriteria>) {
    setIsSaving(true);
    setError(null);
    try {
      setCriteria(await saveGateCriteria(patch));
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not save the gate criteria.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!criteria) return null;

  const toggles: { key: keyof SeoGateCriteria; label: string; hint: string }[] = [
    {
      key: 'enforceBeforePush',
      label: 'Enforce the gate before a WordPress push',
      hint: 'With this off, the gate is still evaluated and shown, but never blocks.',
    },
    {
      key: 'requireAnalysis',
      label: 'Require an SEO analysis',
      hint: 'The deterministic analysis is free and instant.',
    },
    {
      key: 'requireAiAnalysis',
      label: 'Require an AI-assisted analysis',
      hint: 'Off by default: requiring a paid step to publish would be a cost decision disguised as a quality one.',
    },
    {
      key: 'blockOnBlocking',
      label: 'Block on open blocking findings',
      hint: 'A dismissed finding stops counting, so review is always a way through.',
    },
    {
      key: 'requireCurrentAnalysis',
      label: 'Require the analysis to describe the current article',
      hint: 'An article edited after it was analysed has to be re-analysed.',
    },
    { key: 'requireSeoTitle', label: 'Require an SEO title', hint: 'Off by default — the article title can serve.' },
    {
      key: 'requireMetaDescription',
      label: 'Require a meta description',
      hint: 'Off by default. It is reported as a warning either way.',
    },
    {
      key: 'requireTargetQuery',
      label: 'Require a target search query',
      hint: 'Off by default: a topic-oriented article legitimately has none.',
    },
  ];

  return (
    <section className="seo-settings">
      <h3>SEO gate</h3>
      <p className="seo-form__hint">
        What an article must satisfy before Cynth will hand it to WordPress. A perfect score is never required — by
        default nothing here sets a minimum score at all.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="seo-settings__grid">
        {toggles.map((toggle) => (
          <label key={toggle.key} className="seo-settings__toggle">
            <input
              type="checkbox"
              checked={Boolean(criteria[toggle.key])}
              disabled={isSaving}
              onChange={(e) => void update({ [toggle.key]: e.target.checked } as Partial<SeoGateCriteria>)}
            />
            <div>
              {toggle.label}
              <span> — {toggle.hint}</span>
            </div>
          </label>
        ))}

        <label className="seo-settings__toggle">
          <div>
            Minimum score
            <span> — leave empty for no minimum, which is the default.</span>
            <br />
            <input
              type="number"
              min={0}
              max={100}
              value={criteria.minScore ?? ''}
              disabled={isSaving}
              onChange={(e) => void update({ minScore: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </div>
        </label>

        <label className="seo-settings__toggle">
          <div>
            Maximum open warnings
            <span> — leave empty for no limit.</span>
            <br />
            <input
              type="number"
              min={0}
              value={criteria.maxWarnings ?? ''}
              disabled={isSaving}
              onChange={(e) => void update({ maxWarnings: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </div>
        </label>
      </div>
    </section>
  );
}

export function SeoReview() {
  const [summaries, setSummaries] = useState<ArticleSeoSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const load = useCallback(() => {
    setIsLoading(true);
    fetchSeoSummaries()
      .then((loaded) => {
        setSummaries(loaded);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not load the SEO overview.'))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(load, [load]);

  const visible = onlyProblems
    ? summaries.filter((summary) => summary.readiness !== 'ready' || summary.blockingCount > 0)
    : summaries;

  return (
    <div className="page">
      <PageHeader
        title="SEO Review"
        description="SEO readiness across every article, plus the gate criteria and the websites Cynth is authorised to investigate."
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="seo-review__toolbar">
        <label className="seo-findings__toggle">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          Only articles needing attention
        </label>
        <button type="button" className="button button--ghost" onClick={load} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="seo-empty">
          {summaries.length === 0
            ? 'No articles yet. SEO analysis happens on the Article, once it has been generated.'
            : 'Every article is SEO ready.'}
        </p>
      ) : (
        <table className="seo-review__table">
          <thead>
            <tr>
              <th>Article</th>
              <th>Target query</th>
              <th>Score</th>
              <th>Issues</th>
              <th>Readiness</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((summary) => {
              const readiness = readinessLabel(summary);
              return (
                <tr key={summary.articleId}>
                  <td>
                    <Link to={`/articles/${summary.articleId}`}>{summary.displayTitle}</Link>
                    {summary.isPushedToCms && <div className="seo-review__muted">Pushed to WordPress</div>}
                  </td>
                  <td>
                    {summary.targetQuery ?? <span className="seo-review__muted">None — topic-oriented</span>}
                    {summary.searchIntent && (
                      <div className="seo-review__muted">{summary.searchIntent.replace(/_/g, ' ')}</div>
                    )}
                  </td>
                  <td className="seo-review__score">{summary.score ?? '—'}</td>
                  <td>
                    {summary.blockingCount > 0 && <div>{summary.blockingCount} blocking</div>}
                    {summary.warningCount > 0 && (
                      <div className="seo-review__muted">{summary.warningCount} warnings</div>
                    )}
                    {summary.blockingCount === 0 && summary.warningCount === 0 && (
                      <span className="seo-review__muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`seo-readiness seo-readiness--${readiness.className}`}>{readiness.text}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/*
        Product placement review (Milestone 18), one panel per article that
        carries products. Rendered here, alongside the other review
        information, rather than on its own screen — it is a review finding
        about an article, and this is where those live.
      */}
      {summaries.map((summary) => (
        <PlacementReviewPanel key={summary.articleId} articleId={summary.articleId} articleTitle={summary.displayTitle} />
      ))}

      <GateSettings />
      <WebSourcesPanel />
    </div>
  );
}
