import { useState } from 'react';
import type { SeoFinding, SeoSeverity } from '../../shared/types/seo';

/**
 * The findings list.
 *
 * Three things every row makes visible:
 *
 *   - WHERE. The locator names the heading, the paragraph, or the metadata
 *     field, and quotes the passage where there is one. "Improve your
 *     article" is not a finding.
 *   - WHO SAID SO. A deterministic finding is something Cynth computed; an AI
 *     finding is something a model judged, and carries its confidence.
 *   - WHAT TO DO. The recommendation is advice, and nothing here applies it.
 */

const SEVERITY_LABEL: Record<SeoSeverity, string> = {
  blocking: 'Blocking',
  warning: 'Warning',
  recommendation: 'Recommendation',
  info: 'Diagnostic',
};

const SEVERITY_ORDER: SeoSeverity[] = ['blocking', 'warning', 'recommendation', 'info'];

interface SeoFindingsListProps {
  findings: SeoFinding[];
  onSetStatus: (id: number, status: 'open' | 'dismissed') => void;
  busyId: number | null;
}

function LocatorLine({ finding }: { finding: SeoFinding }) {
  const locator = finding.locator;
  if (!locator) return null;

  const parts: string[] = [];
  if (locator.field) parts.push(`Field: ${locator.field.replace(/_/g, ' ')}`);
  if (locator.heading) {
    const path = locator.headingPath?.length ? locator.headingPath.join(' → ') : locator.heading;
    parts.push(`Under: ${path}`);
  }
  if (typeof locator.paragraphIndex === 'number') parts.push(`Paragraph ${locator.paragraphIndex + 1}`);

  if (!parts.length && !locator.excerpt) return null;

  return (
    <div className="seo-finding__locator">
      {parts.length > 0 && <p className="seo-finding__where">{parts.join(' · ')}</p>}
      {locator.excerpt && <blockquote className="seo-finding__excerpt">{locator.excerpt}</blockquote>}
    </div>
  );
}

export function SeoFindingsList({ findings, onSetStatus, busyId }: SeoFindingsListProps) {
  const [showDismissed, setShowDismissed] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeoSeverity | 'all'>('all');

  const visible = findings
    .filter((finding) => (showDismissed ? true : finding.status !== 'dismissed'))
    .filter((finding) => (severityFilter === 'all' ? true : finding.severity === severityFilter))
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        a.origin.localeCompare(b.origin),
    );

  const counts = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: findings.filter((finding) => finding.severity === severity && finding.status !== 'dismissed').length,
  }));

  if (!findings.length) {
    return <p className="seo-empty">No findings yet. Run an SEO analysis to produce some.</p>;
  }

  return (
    <div className="seo-findings">
      <div className="seo-findings__filters">
        <button
          type="button"
          className={`seo-chip ${severityFilter === 'all' ? 'seo-chip--on' : ''}`}
          onClick={() => setSeverityFilter('all')}
        >
          All ({findings.filter((f) => f.status !== 'dismissed').length})
        </button>
        {counts.map(({ severity, count }) => (
          <button
            key={severity}
            type="button"
            className={`seo-chip seo-chip--${severity} ${severityFilter === severity ? 'seo-chip--on' : ''}`}
            onClick={() => setSeverityFilter(severity)}
            disabled={count === 0}
          >
            {SEVERITY_LABEL[severity]} ({count})
          </button>
        ))}
        <label className="seo-findings__toggle">
          <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} />
          Show dismissed
        </label>
      </div>

      <ul className="seo-findings__list">
        {visible.map((finding) => (
          <li
            key={finding.id}
            className={`seo-finding seo-finding--${finding.severity} ${
              finding.status === 'dismissed' ? 'seo-finding--dismissed' : ''
            }`}
          >
            <div className="seo-finding__head">
              <span className={`seo-badge seo-badge--${finding.severity}`}>{SEVERITY_LABEL[finding.severity]}</span>
              {/* Deterministic and AI claims are never blended into one voice. */}
              <span className="seo-finding__origin">
                {finding.origin === 'deterministic'
                  ? 'Checked by Cynth'
                  : `Model judgement · ${Math.round(finding.confidence * 100)}% confidence`}
              </span>
              <span className="seo-finding__category">{finding.category.replace(/_/g, ' ')}</span>
            </div>

            <p className="seo-finding__summary">{finding.summary}</p>
            {finding.explanation && <p className="seo-finding__explanation">{finding.explanation}</p>}
            <LocatorLine finding={finding} />
            {finding.recommendation && (
              <p className="seo-finding__recommendation">
                <strong>What to do:</strong> {finding.recommendation}
              </p>
            )}

            <div className="seo-finding__actions">
              {finding.status === 'dismissed' ? (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busyId === finding.id}
                  onClick={() => onSetStatus(finding.id, 'open')}
                >
                  Reopen
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busyId === finding.id}
                  onClick={() => onSetStatus(finding.id, 'dismissed')}
                  title="Dismissing records your review decision. It stops counting toward the gate and the score, and the finding itself is never deleted."
                >
                  Dismiss
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {visible.length === 0 && <p className="seo-empty">Nothing matches this filter.</p>}
    </div>
  );
}
