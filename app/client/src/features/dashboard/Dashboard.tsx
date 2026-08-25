import { useEffect, useState } from 'react';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { PlaceholderCard } from '../../shared/components/PlaceholderCard/PlaceholderCard';
import type { IconName } from '../../shared/components/Icon/Icon';
import { fetchDashboardSummary } from './api';
import type { DashboardSummary } from '../../shared/types/dashboard';
import { ApiError } from '../../shared/services/apiClient';
import './Dashboard.css';

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardSummary()
      .then(setSummary)
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load live dashboard data.'))
      .finally(() => setIsLoading(false));
  }, []);

  const liveStatus = (value: number | undefined, activeValue?: number): string => {
    if (isLoading) return 'Loading…';
    if (value === undefined) return 'Unavailable';
    return activeValue === undefined ? `${value} total` : `${value} total · ${activeValue} active`;
  };

  const cards: { icon: IconName; title: string; status: string; description: string }[] = [
    {
      icon: 'newArticle',
      title: 'Recent Articles',
      status: liveStatus(summary?.articles.total),
      description: 'Drafts and published articles will appear here once the Article Engine is implemented.',
    },
    {
      icon: 'authors',
      title: 'Authors',
      status: liveStatus(summary?.authors.total, summary?.authors.active),
      description: 'Author profiles and voice identities are managed here.',
    },
    {
      icon: 'products',
      title: 'Products',
      status: liveStatus(summary?.products.total, summary?.products.active),
      description: 'Products referenced or reviewed in articles are tracked here.',
    },
    {
      icon: 'seoReview',
      title: 'SEO Status',
      status: 'Not configured',
      description: 'SEO readiness across recent articles will be summarized here.',
    },
    {
      icon: 'system',
      title: 'System Status',
      status: 'Foundation only',
      description: 'Health of the local application, database, and connected services will be shown here.',
    },
  ];

  return (
    <div className="page dashboard">
      <PageHeader
        title="Dashboard"
        description="A quick overview of Cynth's editorial activity. Authors, Products, and Recent Articles reflect live database counts."
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dashboard__grid">
        {cards.map((card) => (
          <PlaceholderCard key={card.title} {...card} />
        ))}
      </div>
    </div>
  );
}
