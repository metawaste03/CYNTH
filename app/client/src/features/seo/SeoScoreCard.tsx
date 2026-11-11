import type { SeoScore } from '../../shared/types/seo';

/**
 * The score, and the reason it is what it is.
 *
 * The number is never shown alone. Every dimension is listed with its own
 * score, its weight, and a sentence explaining it — and a dimension that was
 * not assessed says so instead of showing a figure, so a deterministic-only
 * 82 can never be mistaken for a fully-analysed 82.
 */

function bandFor(score: number | null): string {
  if (score === null) return 'unknown';
  if (score >= 85) return 'strong';
  if (score >= 65) return 'fair';
  if (score >= 40) return 'weak';
  return 'poor';
}

export function SeoScoreCard({ score }: { score: SeoScore | null }) {
  if (!score) {
    return (
      <div className="seo-score seo-score--empty">
        <p>No SEO score yet. Run an analysis to get one.</p>
      </div>
    );
  }

  const coveragePercent = Math.round(score.coverage * 100);

  return (
    <div className="seo-score">
      <div className="seo-score__headline">
        <div className={`seo-score__number seo-score__number--${bandFor(score.overall)}`}>
          <strong>{score.overall ?? '—'}</strong>
          <span>/ 100</span>
        </div>
        <div className="seo-score__summary">
          <p className="seo-score__label">SEO readiness</p>
          {/* Coverage is stated next to the number, not buried, because a
              score from half the dimensions means something different. */}
          <p className="seo-score__coverage">
            {coveragePercent}% of the scoring weight was assessed
            {coveragePercent < 100 && ' — the rest needs an AI pass'}
          </p>
        </div>
      </div>

      <p className="seo-score__explanation">{score.explanation}</p>

      <ul className="seo-score__dimensions">
        {score.dimensions.map((dimension) => (
          <li key={dimension.dimension} className={dimension.evaluated ? '' : 'seo-score__dimension--skipped'}>
            <div className="seo-score__dimension-head">
              <span className="seo-score__dimension-label">{dimension.label}</span>
              <span className="seo-score__dimension-value">
                {dimension.evaluated ? dimension.score : 'Not assessed'}
              </span>
            </div>
            {dimension.evaluated && (
              <div className="seo-score__bar" aria-hidden="true">
                <div
                  className={`seo-score__bar-fill seo-score__bar-fill--${bandFor(dimension.score)}`}
                  style={{ width: `${dimension.score ?? 0}%` }}
                />
              </div>
            )}
            <p className="seo-score__dimension-explanation">{dimension.explanation}</p>
            <p className="seo-score__dimension-weight">Weight {dimension.weight} of 100</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
