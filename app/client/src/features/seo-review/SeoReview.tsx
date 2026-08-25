import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState/EmptyState';

export function SeoReview() {
  return (
    <div className="page">
      <PageHeader
        title="SEO Review"
        description="Review SEO readiness for drafts before they're published."
      />
      <EmptyState
        icon="seoReview"
        title="SEO review isn't available yet"
        message="Keyword, title, and readiness checks will appear here once the SEO Engine is implemented."
      />
    </div>
  );
}
