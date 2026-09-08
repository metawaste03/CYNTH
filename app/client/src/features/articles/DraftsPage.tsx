import { useEffect, useState } from 'react';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import type { ArticleSummary } from '../../shared/types/article';
import { fetchArticles } from './api';
import { ArticleList } from './ArticleList';
import type { ArticleRunHint } from './ArticleList';
import { fetchResumableRuns } from '../pipeline/api';

/**
 * Every article still in the Draft state, newest first.
 *
 * Reads real Article records. A single generated article appears here on its
 * own — there is no minimum count and no dependency on any aggregate.
 */
export function DraftsPage() {
  const [drafts, setDrafts] = useState<ArticleSummary[]>([]);
  const [runs, setRuns] = useState<Map<number, ArticleRunHint>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    fetchArticles({ status: 'draft' })
      .then(setDrafts)
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load drafts.'))
      .finally(() => setIsLoading(false));

    // A draft whose run is unfinished is not a dead draft — it is a live run
    // that has not written its article yet. Failing to load these degrades the
    // list to what it was before rather than breaking it, so the error is not
    // surfaced.
    fetchResumableRuns()
      .then((list) =>
        setRuns(
          new Map(
            list.map((run) => [
              run.articleId,
              {
                pipelineId: run.pipelineId,
                label: run.failed
                  ? (run.nextStage ?? 'the failed stage')
                  : (run.waitingFor ?? run.nextStage ?? 'ready to continue'),
                failed: run.failed,
                subject: run.title ?? run.topic,
                spent: run.spent,
              },
            ]),
          ),
        ),
      )
      .catch(() => setRuns(new Map()));
  }

  useEffect(load, []);

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
              emptyMessage="No drafts yet. Start one from Generate Article, or from New Article (manual)."
              onDeleted={load}
              runs={runs}
            />
          </>
        )
      )}
    </div>
  );
}
