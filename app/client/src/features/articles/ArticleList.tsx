import { Link } from 'react-router-dom';
import type { ArticleSummary } from '../../shared/types/article';
import './ArticleList.css';

/**
 * Renders real Article records. One row per article — there is no minimum
 * count, no placeholder padding, and no fabricated data: if the repository
 * returns one article, this shows exactly that one article.
 */

interface ArticleListProps {
  articles: ArticleSummary[];
  /** Shown in place of the list when there is nothing to show. */
  emptyMessage: string;
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

export function ArticleList({ articles, emptyMessage }: ArticleListProps) {
  if (articles.length === 0) {
    return <p className="article-list__empty">{emptyMessage}</p>;
  }

  return (
    <ul className="article-list">
      {articles.map((article) => (
        <li key={article.id} className="article-list__item">
          <div className="article-list__main">
            <Link to={`/articles/${article.id}`} className="article-list__title">
              {article.displayTitle}
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
            <Link to={`/articles/${article.id}`} className="button">
              Open
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
