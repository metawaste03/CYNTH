import { useEffect, useState } from 'react';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import type { ArticleSummary } from '../../shared/types/article';
import { fetchArticles } from './api';
import { ArticleList } from './ArticleList';
import type { ArticleRunHint } from './ArticleList';
import { fetchResumableRuns } from '../pipeline/api';

type StatusFilter = 'draft' | 'published' | 'all';

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'draft', label: 'Drafts' },
  { value: 'published', label: 'Published' },
  { value: 'all', label: 'All' },
];

/**
 * The articles, newest first.
 *
 * Reads real Article records. A single generated article appears here on its
 * own — there is no minimum count and no dependency on any aggregate.
 *
 * THE FILTER IS NOT DECORATION. This page asked the server for drafts and
 * nothing else, and it is the only page in Cynth that lists articles — so
 * marking an article published removed it from the application entirely. It
 * was reported as an article that "isn't present on CYNTH" when it was there
 * the whole time, written, with a featured image attached.
 */
export function DraftsPage() {
  const [filter, setFilter] = useState<StatusFilter>('draft');
  const [drafts, setDrafts] = useState<ArticleSummary[]>([]);
  const [runs, setRuns] = useState<Map<number, ArticleRunHint>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    setError(null);
    // 'all' omits the parameter rather than sending a third status the server
    // does not have — there are only two.
    fetchArticles(filter === 'all' ? {} : { status: filter })
      .then(setDrafts)
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load articles.'))
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

  useEffect(load, [filter]);

  return (
    <div className="page">
      <PageHeader
        title="Articles"
        description="Everything Cynth has written. A generated article lands here as a draft and stays here until you approve it; published ones stay reachable rather than disappearing."
      />

      <div className="content-form__actions">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`button${filter === option.value ? ' button--primary' : ''}`}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {isLoading ? (
        <p>Loading articles…</p>
      ) : (
        !error && (
          <>
            <p className="page__count">
              {drafts.length} {drafts.length === 1 ? 'article' : 'articles'}
              {filter === 'draft' ? ' in draft' : filter === 'published' ? ' published' : ''}
            </p>
            <ArticleList
              articles={drafts}
              emptyMessage={
                filter === 'published'
                  ? 'Nothing is marked published yet.'
                  : 'No drafts yet. Start one from Generate Article, or from New Article (manual).'
              }
              onDeleted={load}
              runs={runs}
            />
          </>
        )
      )}
    </div>
  );
}
