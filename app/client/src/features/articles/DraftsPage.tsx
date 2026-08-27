import { useEffect, useState } from 'react';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import type { ArticleSummary } from '../../shared/types/article';
import { fetchArticles } from './api';
import { ArticleList } from './ArticleList';

/**
 * Every article still in the Draft state, newest first.
 *
 * Reads real Article records. A single generated article appears here on its
 * own — there is no minimum count and no dependency on any aggregate.
 */
export function DraftsPage() {
  const [drafts, setDrafts] = useState<ArticleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchArticles({ status: 'draft' })
      .then(setDrafts)
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load drafts.'))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="page">
      <PageHeader
        title="Drafts"
        description="Articles that have not been published. A generated article lands here as a draft and stays here until you approve it."
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {isLoading ? (
        <p>Loading drafts…</p>
      ) : (
        !error && (
          <>
            <p className="page__count">
              {drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}
            </p>
            <ArticleList
              articles={drafts}
              emptyMessage="No drafts yet. Start one from New Article — it is saved as a draft as soon as you pick an article type."
            />
          </>
        )
      )}
    </div>
  );
}
