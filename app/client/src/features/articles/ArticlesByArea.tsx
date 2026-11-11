import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { api } from '../../shared/services/apiClient';
import { formatArticleDate } from './ArticleList';
import './ArticlesByArea.css';

/**
 * THE CATALOGUE, BY THEMATIC AREA.
 *
 * The Dashboard's Articles card reported one total and went nowhere — the only
 * counting card with no destination. A total answers "how much have I made";
 * the question actually being asked is "what have I made, and where are the
 * holes", and that is a per-area question.
 *
 * Every column is something you would otherwise have to open an article to
 * learn: how long it is, whether it is on the site, whether its SEO score
 * still describes the article it was measured on.
 */

interface AreaArticle {
  id: number;
  title: string;
  status: string;
  wordCount: number;
  authorName: string | null;
  updatedAt: string;
  cmsStatus: string | null;
  externalUrl: string | null;
  seoScore: number | null;
  seoStale: boolean;
  hasContent: boolean;
}

interface AreaGroup {
  themeId: number | null;
  themeName: string;
  articles: AreaArticle[];
  total: number;
  live: number;
  notPushed: number;
  words: number;
}

interface Response {
  areas: AreaGroup[];
  totals: { articles: number; live: number; words: number };
}

/** Where the article is for a reader — the only status most questions are about. */
function WhereBadge({ article }: { article: AreaArticle }) {
  if (article.cmsStatus === 'publish') {
    const label = 'Live';
    return article.externalUrl ? (
      <a className="aba__where aba__where--live" href={article.externalUrl} target="_blank" rel="noreferrer">
        {label}
      </a>
    ) : (
      <span className="aba__where aba__where--live">{label}</span>
    );
  }
  if (article.cmsStatus) return <span className="aba__where aba__where--draft">Draft on site</span>;
  return <span className="aba__where aba__where--none">Not pushed</span>;
}

/**
 * The SEO score, and whether it still means anything.
 *
 * A score measured against a body that has since changed is not a lower
 * score — it is a score for a different article, and showing it bare would be
 * worse than showing nothing.
 */
function SeoCell({ article }: { article: AreaArticle }) {
  if (article.seoScore === null) return <span className="aba__seo aba__seo--none">—</span>;
  const band = article.seoScore >= 80 ? 'good' : article.seoScore >= 60 ? 'fair' : 'poor';
  return (
    <span className={`aba__seo aba__seo--${article.seoStale ? 'stale' : band}`}>
      {Math.round(article.seoScore)}
      {article.seoStale && <span className="aba__seo-note" title="The article changed after this was measured">stale</span>}
    </span>
  );
}

export function ArticlesByArea() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Response>('/articles/by-area')
      .then((result: Response) => !cancelled && setData(result))
      .catch(() => !cancelled && setError('Could not load the article catalogue.'));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page aba">
      <PageHeader
        title="Articles by area"
        description="Every article Cynth holds, grouped by thematic area, with where it stands."
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!data && !error && <p>Loading…</p>}

      {data && (
        <>
          <p className="aba__totals">
            <strong>{data.totals.articles}</strong> article{data.totals.articles === 1 ? '' : 's'} ·{' '}
            <strong>{data.totals.live}</strong> live on the site ·{' '}
            <strong>{data.totals.words.toLocaleString()}</strong> words written
          </p>

          {data.areas.length === 0 && <p className="aba__empty">No articles yet.</p>}

          {data.areas.map((area) => (
            <section key={area.themeId ?? 'unassigned'} className="aba__area">
              <header className="aba__area-head">
                <h2>{area.themeName}</h2>
                <p className="aba__area-meta">
                  {area.total} written · {area.live} live
                  {area.notPushed > 0 && ` · ${area.notPushed} never pushed`}
                  {area.words > 0 && ` · ${area.words.toLocaleString()} words`}
                </p>
              </header>

              <table className="aba__table">
                <thead>
                  <tr>
                    <th scope="col" className="aba__col-id">#</th>
                    <th scope="col">Title</th>
                    <th scope="col" className="aba__col-num">Words</th>
                    <th scope="col" className="aba__col-num">SEO</th>
                    <th scope="col">On the site</th>
                    <th scope="col">Author</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {area.articles.map((article) => (
                    <tr key={article.id} className={article.hasContent ? undefined : 'aba__row--empty'}>
                      <td className="aba__col-id">{article.id}</td>
                      <td>
                        <Link to={`/articles/${article.id}`}>{article.title}</Link>
                        {!article.hasContent && <span className="aba__not-written">not generated yet</span>}
                      </td>
                      <td className="aba__col-num">{article.wordCount ? article.wordCount.toLocaleString() : '—'}</td>
                      <td className="aba__col-num">
                        <SeoCell article={article} />
                      </td>
                      <td>
                        <WhereBadge article={article} />
                      </td>
                      <td>{article.authorName ?? '—'}</td>
                      <td>{formatArticleDate(article.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
