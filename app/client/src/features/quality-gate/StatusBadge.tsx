import type { QualityGateStatus, SeoStatus } from '../../shared/types/qualityGate';
import './QualityGate.css';

/**
 * The two status badges.
 *
 * Deliberately two components rather than one generic badge: Quality and SEO
 * have different vocabularies (there is no "In Progress" quality result, and
 * no "Passed with Warnings" SEO result), and collapsing them into one would
 * invite exactly the conflation this milestone exists to undo.
 *
 * The tone is shared, though — Passed reads the same green in both places, so
 * a glance down a list compares like with like.
 */

const QUALITY_LABELS: Record<QualityGateStatus, string> = {
  not_evaluated: 'Not Evaluated',
  passed: 'Passed',
  passed_with_warnings: 'Passed with Warnings',
  failed: 'Failed',
};

const SEO_LABELS: Record<SeoStatus, string> = {
  not_evaluated: 'Not Evaluated',
  in_progress: 'In Progress',
  passed: 'Passed',
  needs_attention: 'Needs Attention',
  failed: 'Failed',
};

/** Maps a status onto one of four tones, so the CSS never enumerates statuses. */
function toneOf(status: QualityGateStatus | SeoStatus): 'neutral' | 'good' | 'caution' | 'bad' {
  if (status === 'passed') return 'good';
  if (status === 'failed') return 'bad';
  if (status === 'passed_with_warnings' || status === 'needs_attention' || status === 'in_progress') return 'caution';
  return 'neutral';
}

export function QualityStatusBadge({ status, title }: { status: QualityGateStatus; title?: string }) {
  return (
    <span className={`readiness-badge readiness-badge--${toneOf(status)}`} title={title}>
      {QUALITY_LABELS[status] ?? status}
    </span>
  );
}

export function SeoStatusBadge({ status, title }: { status: SeoStatus; title?: string }) {
  return (
    <span className={`readiness-badge readiness-badge--${toneOf(status)}`} title={title}>
      {SEO_LABELS[status] ?? status}
    </span>
  );
}

/**
 * The two statuses together, in workflow order.
 *
 * Shown as a pair everywhere they appear, because the pair is the point:
 * "Quality: Passed / SEO: Needs Attention" is a valid state, and showing
 * either one alone loses that.
 */
export function ReadinessPair({
  quality,
  seo,
  qualityTitle,
  seoTitle,
}: {
  quality: QualityGateStatus;
  seo: SeoStatus;
  qualityTitle?: string;
  seoTitle?: string;
}) {
  return (
    <div className="readiness-pair">
      <span className="readiness-pair__item">
        <span className="readiness-pair__label">Quality</span>
        <QualityStatusBadge status={quality} title={qualityTitle} />
      </span>
      <span className="readiness-pair__arrow" aria-hidden="true">
        →
      </span>
      <span className="readiness-pair__item">
        <span className="readiness-pair__label">SEO</span>
        <SeoStatusBadge status={seo} title={seoTitle} />
      </span>
    </div>
  );
}
