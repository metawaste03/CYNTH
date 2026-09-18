import { Link } from 'react-router-dom';
import { DeleteArticleButton } from './DeleteArticleButton';
import type { ArticleSummary } from '../../shared/types/article';
import './ArticleList.css';

/**
 * Renders real Article records. One row per article — there is no minimum
 * count, no placeholder padding, and no fabricated data: if the repository
 * returns one article, this shows exactly that one article.
 */

/**
 * What an unfinished run adds to its article's row.
 *
 * Kept as a plain shape rather than the pipeline's own type so this list does
 * not depend on the pipeline feature: the owning page maps its data into this.
 */
export interface ArticleRunHint {
  pipelineId: number;
  /** What the run is waiting on, or what it would do next. */
  label: string;
  failed: boolean;
  /** The run's own topic or title — the article row has neither until the writer runs. */
  subject: string | null;
  spent: number | null;
}

interface ArticleListProps {
  articles: ArticleSummary[];
  /** Shown in place of the list when there is nothing to show. */
  emptyMessage: string;
  /** Called after a deletion, so the owning page can reload. Omit it to hide the delete control. */
  onDeleted?: () => void;
  /**
   * Unfinished runs, keyed by article id.
   *
   * An article whose run has not finished has no title and no body yet, so
   * without this it reads as an empty, useless draft — when in fact it is a
   * live run holding paid research and waiting to be continued.
   */
  runs?: Map<number, ArticleRunHint>;
}

/** SQLite writes datetime('now') as UTC without a zone marker; say so rather than letting the browser read it as local. */
export function formatArticleDate(value: string): string {
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`article-status article-status--${status}`}>{status}</span>;
}

export function ArticleList({ articles, emptyMessage, onDeleted, runs }: ArticleListProps) {
  if (articles.length === 0) {
    return <p className="article-list__empty">{emptyMessage}</p>;
  }

  return (
    <ul className="article-list">
      {articles.map((article) => {
        const run = runs?.get(article.id) ?? null;

        return (
        <li key={article.id} className="article-list__item">
          <div className="article-list__main">
            {/* An unfinished run points at the run, not at the empty article:
                the article has nothing to read yet, and the run is where the
                work actually is. */}
            <Link
              to={run ? `/generate/${run.pipelineId}` : `/articles/${article.id}`}
              className="article-list__title"
            >
              {run?.subject ?? article.displayTitle}
            </Link>

            <p className="article-list__meta">
              <StatusBadge status={article.status} />
              <span>{formatArticleDate(article.updatedAt)}</span>
              {article.articleTypeName && <span>{article.articleTypeName}</span>}
              {article.authorName && <span>{article.authorName}</span>}
              {article.isGenerated ? (
                <span className="article-list__generated">
                  AI draft{article.wordCount ? ` · ${article.wordCount.toLocaleString()} words` : ''}
                </span>
              ) : run ? (
                /* "Not generated yet" is true but useless here — it reads as a
                   dead draft. Say what the run is actually waiting on. */
                <span className={run.failed ? 'article-list__run-stopped' : 'article-list__run-waiting'}>
                  {run.failed ? 'Stopped' : 'In progress'} · {run.label}
                  {run.spent !== null && ` · $${run.spent.toFixed(4)} spent`}
                </span>
              ) : (
                <span className="article-list__pending">Not generated yet</span>
              )}
              {/* Whether this article already exists in WordPress, so a second
                  push is visibly an update rather than a fresh post. */}
              {article.isPushedToCms && (
                <span className="article-list__pushed">
                  In WordPress{article.cmsStatus === 'draft' ? ' · draft' : article.cmsStatus ? ` · ${article.cmsStatus}` : ''}
                </span>
              )}
            </p>

            {article.excerpt && <p className="article-list__excerpt">{article.excerpt}</p>}
          </div>

          <div className="article-list__actions">
            {run ? (
              <Link to={`/generate/${run.pipelineId}`} className="button button--primary">
                Continue
              </Link>
            ) : (
              <Link to={`/articles/${article.id}`} className="button">
                Open
              </Link>
            )}
            {/* The control owns its own confirmation state, so a row expands
                in place rather than opening a modal over the list. */}
            {onDeleted && (
              <DeleteArticleButton articleId={article.id} title={article.displayTitle} onDeleted={onDeleted} />
            )}
          </div>
        </li>
        );
      })}
    </ul>
  );
}
