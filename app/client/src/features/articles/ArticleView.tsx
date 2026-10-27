import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import type { ArticleDraft } from '../../shared/types/article';
import { fetchArticle, fetchArticleProducts, setArticleStatus } from './api';
import type { ArticleProductCard } from './api';
import { ArticleContent } from './ArticleContent';
import { formatArticleDate } from './ArticleList';
import { WordPressPushPanel } from './WordPressPushPanel';
import { DeleteArticleButton } from './DeleteArticleButton';
import { FeaturedImagePanel } from '../images/FeaturedImagePanel';
import { SeoPanel } from '../seo/SeoPanel';
import { QualityGatePanel } from '../quality-gate/QualityGatePanel';
import './ArticleView.css';

/**
 * Opens one stored Article and shows what is actually persisted.
 *
 * The content comes from the `articles` table via GET /api/articles/:id — it
 * is never reconstructed from generation_history. This is deliberately a
 * reader, not an editor: Cynth has no article editor yet, and building a full
 * editorial surface is not part of this task.
 */

function formatTimestamp(value: string): string {
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? <span className="article-view__unset">Not set</span>}</dd>
    </div>
  );
}

export function ArticleView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const articleId = Number(id);

  const [article, setArticle] = useState<ArticleDraft | null>(null);
  /**
   * The products behind this article's markers. Empty is the normal case —
   * most articles carry none — so a failure here degrades to the marker being
   * shown as an orphan rather than blocking the article from loading.
   */
  const [products, setProducts] = useState<ArticleProductCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const load = useCallback(() => {
    if (!Number.isInteger(articleId) || articleId <= 0) {
      setError('Invalid article id.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fetchArticle(articleId)
      .then((loaded) => {
        setArticle(loaded);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load this article.'))
      .finally(() => setIsLoading(false));

    fetchArticleProducts(articleId)
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [articleId]);

  useEffect(load, [load]);

  async function changeStatus(status: string) {
    setIsUpdating(true);
    setStatusError(null);
    try {
      setArticle(await setArticleStatus(articleId, status));
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.errors.join(' ') : 'Could not change the article status.');
    } finally {
      setIsUpdating(false);
    }
  }

  if (isLoading) return <p>Loading article…</p>;

  if (error) {
    return (
      <div className="page">
        <p className="form-error" role="alert">
          {error}
        </p>
        <p>
          <Link to="/drafts">Back to Drafts</Link>
        </p>
      </div>
    );
  }

  if (!article) return null;

  const displayTitle = article.title?.trim() || article.generated?.title?.trim() || 'Untitled draft';
  const isDraft = article.status === 'draft';

  return (
    <div className="page article-view">
      <PageHeader
        title={displayTitle}
        description="The stored article, exactly as it is saved in Cynth's database."
      />

      <p className="article-view__back">
        <Link to="/drafts">← Back to Drafts</Link>
      </p>

      <dl className="article-view__meta">
        <MetaRow label="Status" value={article.status} />
        <MetaRow label="Article ID" value={String(article.id)} />
        <MetaRow label="Slug" value={article.slug} />
        <MetaRow label="Topic" value={article.topic} />
        <MetaRow label="Created" value={formatArticleDate(article.createdAt)} />
        <MetaRow label="Updated" value={formatArticleDate(article.updatedAt)} />
        {article.generated && (
          <>
            <MetaRow label="Generated" value={formatTimestamp(article.generated.generatedAt)} />
            <MetaRow label="Provider" value={article.generated.provider} />
            <MetaRow label="Model" value={article.generated.model} />
          </>
        )}
      </dl>

      <div className="article-view__actions">
        <Link to={`/new-article/${article.id}`} className="button">
          Open in New Article wizard
        </Link>
        <button
          type="button"
          className="button"
          disabled={isUpdating}
          onClick={() => changeStatus(isDraft ? 'published' : 'draft')}
        >
          {isUpdating ? 'Saving…' : isDraft ? 'Mark as Published' : 'Move back to Draft'}
        </button>

        {/* Deleting from here returns to Drafts, since the page being viewed
            no longer exists afterwards. */}
        <DeleteArticleButton
          articleId={article.id}
          title={displayTitle}
          onDeleted={() => navigate('/drafts')}
        />
      </div>

      {statusError && (
        <p className="form-error" role="alert">
          {statusError}
        </p>
      )}

      {article.generated ? (
        <article className="article-view__body">
          {article.generated.title && article.generated.title !== article.title && (
            <p className="article-view__model-title">
              The model titled this: <strong>{article.generated.title}</strong>
            </p>
          )}
          {/* Product markers render as the cards they become, image included.
              Before this they showed as literal [[product:14]] text, so an
              uploaded primary image appeared nowhere in Cynth — it reached
              only the published post. */}
          <ArticleContent content={article.generated.content} products={products} />
          <p className="article-view__note">
            This is an AI-generated draft. It stays unpublished until you review and approve it.
          </p>
        </article>
      ) : (
        <p className="article-list__empty">
          This article has no generated content yet. Open it in the New Article wizard and generate a draft at the
          Editorial Review step.
        </p>
      )}

      {/* The featured image sits above the gates because it is part of the
          article rather than a check on it — and because the SEO pass and the
          CMS push both read it. */}
      <FeaturedImagePanel articleId={articleId} onChanged={load} />

      {/* Quality Gate -> SEO Status -> WordPress Draft, in that order down
          the page. Quality comes first because it asks the earlier question:
          is this a finished article at all? Neither gate blocks reading or
          editing — only the CMS push path can refuse. */}
      <QualityGatePanel articleId={articleId} />

      {/* The SEO Engine sits between the Cynth draft and the CMS. It reads
          the article and writes only SEO metadata beside it — never the
          article's own content, title or brief. */}
      <SeoPanel articleId={articleId} onChanged={load} />

      {/* Article -> WordPress Draft. Publication stays a human act performed
          in WordPress; nothing here can publish. */}
      <WordPressPushPanel articleId={articleId} onPushed={load} />
    </div>
  );
}
