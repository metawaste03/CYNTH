import { useEffect, useState } from 'react';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { PlaceholderCard } from '../../shared/components/PlaceholderCard/PlaceholderCard';
import type { IconName } from '../../shared/components/Icon/Icon';
import { fetchDashboardSummary } from './api';
import type { DashboardSummary } from '../../shared/types/dashboard';
import { ApiError } from '../../shared/services/apiClient';
import './Dashboard.css';

/**
 * The Dashboard summarises collections; it does not manage their contents.
 *
 * Individual drafts deliberately do not appear here — one card reports how
 * many there are and links to the Drafts area, which is where drafts are read
 * and managed. Listing records inline made the Dashboard grow without bound
 * and put two different jobs on one page.
 *
 * Every number below is read from the database. Nothing is hardcoded, and no
 * count is derived from generation_history — that table records generation
 * attempts, not articles.
 */
export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardSummary()
      .then((loaded) => {
        setSummary(loaded);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load live dashboard data.'))
      .finally(() => setIsLoading(false));
  }, []);

  /** Renders a live count, or says plainly that it could not be read. Never falls back to a made-up number. */
  const liveStatus = (value: number | undefined, activeValue?: number): string => {
    if (isLoading) return 'Loading…';
    if (value === undefined) return 'Unavailable';
    return activeValue === undefined ? `${value} total` : `${value} total · ${activeValue} active`;
  };

  const draftStatus = (): string => {
    if (isLoading) return 'Loading…';
    if (!summary) return 'Unavailable';
    return `${summary.articles.draft} ${summary.articles.draft === 1 ? 'draft' : 'drafts'}`;
  };

  /**
   * WordPress state in one line, read from real rows.
   *
   * Says "Not connected" when no connection is configured rather than showing
   * a zero, because those are different facts: zero pushed articles with a
   * working connection is a normal state, and no connection at all is a setup
   * step the user has not done yet.
   */
  const wordPressStatus = (): string => {
    if (isLoading) return 'Loading…';
    if (!summary?.wordpress) return 'Unavailable';

    const { connections, activeConnections, pushedArticles, remoteDrafts } = summary.wordpress;
    if (connections === 0) return 'Not connected';
    if (activeConnections === 0) return 'Connection inactive';
    if (pushedArticles === 0) return 'Connected · nothing pushed yet';

    return `${pushedArticles} ${pushedArticles === 1 ? 'article' : 'articles'} pushed · ${remoteDrafts} still draft`;
  };

  const cards: { icon: IconName; title: string; status: string; description: string; action?: { label: string; to: string } }[] = [
    {
      icon: 'newArticle',
      title: 'Articles',
      status: liveStatus(summary?.articles.total),
      description: 'Every article Cynth has stored, across all lifecycle states.',
    },
    {
      icon: 'site',
      title: 'Drafts',
      status: draftStatus(),
      description: 'Articles not yet published. A generated article stays a draft until you approve it.',
      action: { label: 'View Drafts', to: '/drafts' },
    },
    {
      icon: 'authors',
      title: 'Authors',
      status: liveStatus(summary?.authors.total, summary?.authors.active),
      description: 'Author profiles and voice identities are managed here.',
      action: { label: 'View Authors', to: '/authors' },
    },
    {
      icon: 'products',
      title: 'Products',
      status: liveStatus(summary?.products.total, summary?.products.active),
      description: 'Products referenced or reviewed in articles are tracked here.',
      action: { label: 'View Products', to: '/products' },
    },
    {
      icon: 'media',
      title: 'Media Library',
      status:
        summary === null
          ? 'Loading…'
          : summary.media.total === 0
            ? 'No images yet'
            : `${summary.media.total} image(s) · ${summary.media.filed} filed by area`,
      description:
        'Images for articles, filed by thematic area. Product images live with their product and are not counted here.',
      action: { label: 'Open Media Library', to: '/media' },
    },
    {
      icon: 'seoReview',
      title: 'SEO Status',
      status: 'Not configured',
      description: 'SEO readiness across recent articles will be summarized here.',
    },
    {
      icon: 'site',
      title: 'WordPress',
      status: wordPressStatus(),
      description:
        'Articles Cynth has sent to WordPress as drafts. Publication stays a human action, performed in WordPress.',
      action: { label: 'WordPress Settings', to: '/settings/wordpress' },
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
        description="A quick overview of Cynth's editorial activity, read live from the database."
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
