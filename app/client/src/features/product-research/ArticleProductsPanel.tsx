import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../shared/services/apiClient';
import type { ArticleProduct } from '../../shared/types/articleProduct';
import type { ProductListItem } from '../../shared/types/product';
import { fetchProducts } from '../products/api';
import {
  attachArticleProduct,
  checkProductUrl,
  detachArticleProduct,
  fetchArticleProducts,
  researchProduct,
  retrieveProduct,
} from './api';
import './ProductResearch.css';

/**
 * The products one article carries.
 *
 * Three ways in, in the order they are actually used: paste a product URL,
 * pick one already in the catalogue, or type it in on the Products page. The
 * URL path is first because it is the one this milestone exists for.
 *
 * The panel is deliberately explicit about what has and has not been
 * researched: a product Cynth knows nothing about beyond its title can still
 * be attached, and the article generation step is told as much rather than
 * pretending otherwise.
 */
export function ArticleProductsPanel({ articleId }: { articleId: number | null }) {
  const [attached, setAttached] = useState<ArticleProduct[]>([]);
  const [catalogue, setCatalogue] = useState<ProductListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [affiliateUrl, setAffiliateUrl] = useState('');
  const [editorialNote, setEditorialNote] = useState('');
  const [remedy, setRemedy] = useState<string | null>(null);

  function load() {
    if (articleId === null) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    Promise.all([fetchArticleProducts(articleId), fetchProducts({ status: 'active' })])
      .then(([rows, all]) => {
        setAttached(rows);
        setCatalogue(all);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load products.'))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, [articleId]);

  function fail(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
      setError(err.errors.join(' '));
      // The API returns a remedy alongside every refusal it can act on.
      setRemedy(typeof err.details?.remedy === 'string' ? err.details.remedy : null);
    } else {
      setError(fallback);
      setRemedy(null);
    }
    setNotice(null);
  }

  function announce(message: string) {
    setNotice(message);
    setError(null);
    setRemedy(null);
  }

  /** Checks whether the URL can be read at all, without fetching the page. */
  async function handleCheck() {
    if (!url.trim() || articleId === null) return;
    setBusy('check');
    try {
      const preflight = await checkProductUrl(url.trim());
      if (preflight.permitted) {
        announce(`${preflight.host} can be read. ${preflight.reason}`);
      } else {
        setError(preflight.reason);
        setRemedy(preflight.remedy);
        setNotice(null);
      }
    } catch (err) {
      fail(err, 'Could not check that URL.');
    } finally {
      setBusy(null);
    }
  }

  async function handleAddFromUrl(event: FormEvent) {
    event.preventDefault();
    if (articleId === null || !url.trim()) return;

    setBusy('retrieve');
    try {
      const result = await retrieveProduct({
        url: url.trim(),
        // Empty means the page URL is also the link. A supplied value is
        // stored exactly as typed.
        affiliateUrl: affiliateUrl.trim() || null,
        editorialNote: editorialNote.trim() || null,
      });
      await attachArticleProduct(articleId, result.product.id, editorialNote.trim() || null);

      setUrl('');
      setAffiliateUrl('');
      setEditorialNote('');
      load();
      announce(
        `Added "${result.product.title}".${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''} Research it next so Cynth knows where it belongs.`,
      );
    } catch (err) {
      fail(err, 'Could not read that product page.');
    } finally {
      setBusy(null);
    }
  }

  async function handleAttachExisting(productId: number) {
    if (articleId === null) return;
    setBusy(`attach-${productId}`);
    try {
      await attachArticleProduct(articleId, productId);
      load();
      announce('Product attached.');
    } catch (err) {
      fail(err, 'Could not attach that product.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDetach(productId: number) {
    if (articleId === null) return;
    setBusy(`detach-${productId}`);
    try {
      await detachArticleProduct(articleId, productId);
      load();
      announce('Product removed from this draft. The product itself is untouched.');
    } catch (err) {
      fail(err, 'Could not remove that product.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Runs the paid research step.
   *
   * `confirmedCost` is passed only after the user answers the confirmation
   * the server asked for — it is never sent as true on the first attempt.
   */
  async function handleResearch(productId: number, productTitle: string, confirmedCost = false) {
    setBusy(`research-${productId}`);
    try {
      const result = await researchProduct(productId, { confirmedCost });
      load();
      announce(`Researched "${productTitle}": ${result.understanding.useCase}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'cost_confirmation_required') {
        if (window.confirm(`${err.errors.join(' ')}\n\nRun the research anyway?`)) {
          setBusy(null);
          return handleResearch(productId, productTitle, true);
        }
        setError('Research cancelled — nothing was spent.');
        setRemedy(null);
      } else {
        fail(err, 'Could not research that product.');
      }
    } finally {
      setBusy(null);
    }
  }

  if (articleId === null) {
    return (
      <p className="wizard-hint">
        Save this draft first, then products can be attached to it. Use <strong>Save Draft</strong> below.
      </p>
    );
  }

  if (isLoading) return <p>Loading products…</p>;

  const attachedIds = new Set(attached.map((row) => row.productId));
  const available = catalogue.filter((product) => !attachedIds.has(product.id));

  return (
    <div className="product-research">
      <p className="wizard-hint">
        Products you have chosen for this article. Cynth reads what each product page publishes about itself, works
        out what the product is for, and lets the author place it where it is genuinely relevant — or leave it out.
        Your affiliate link is stored exactly as you supply it and is never rewritten.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
          {remedy && <span className="product-research__remedy">{remedy}</span>}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}

      <form className="product-research__form" onSubmit={handleAddFromUrl}>
        <label className="wizard-field">
          Product page URL
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            inputMode="url"
          />
        </label>

        <label className="wizard-field">
          Affiliate URL <span className="product-research__muted">(optional — leave empty to use the URL above)</span>
          <input
            value={affiliateUrl}
            onChange={(e) => setAffiliateUrl(e.target.value)}
            placeholder="Your tagged link, stored exactly as typed"
            inputMode="url"
          />
        </label>

        <label className="wizard-field">
          Why this product? <span className="product-research__muted">(optional)</span>
          <input
            value={editorialNote}
            onChange={(e) => setEditorialNote(e.target.value)}
            placeholder="e.g. for the seating section"
          />
        </label>

        <div className="product-research__actions">
          <button type="button" className="button" disabled={!url.trim() || busy === 'check'} onClick={handleCheck}>
            {busy === 'check' ? 'Checking…' : 'Check URL'}
          </button>
          <button type="submit" className="button button--primary" disabled={!url.trim() || busy === 'retrieve'}>
            {busy === 'retrieve' ? 'Reading…' : 'Add from URL'}
          </button>
        </div>
      </form>

      {attached.length === 0 ? (
        <p className="article-list__empty">No products attached yet.</p>
      ) : (
        <ul className="product-research__list">
          {attached.map((row) => {
            const product = row.product;
            if (!product) return null;
            const image = product.images?.find((i) => i.isPrimary)?.url ?? product.sourceImageUrl;

            return (
              <li key={row.id} className="product-research__item">
                {image && <img className="product-research__thumb" src={image} alt="" />}

                <div className="product-research__detail">
                  <strong>{product.title}</strong>
                  <div className="product-research__meta">
                    {product.vendor && <span>{product.vendor}</span>}
                    <span className={`status-badge status-badge--${product.researchStatus}`}>
                      {product.researchStatus === 'researched'
                        ? 'Researched'
                        : product.researchStatus === 'retrieved'
                          ? 'Page read — not yet researched'
                          : product.researchStatus === 'failed'
                            ? 'Research failed'
                            : 'Not researched'}
                    </span>
                    {row.status === 'placed' && (
                      <span className="status-badge is-active">Placed in “{row.placementSection ?? 'the article'}”</span>
                    )}
                    {row.status === 'omitted' && (
                      <span className="status-badge is-inactive">Not placed — the author judged it did not fit</span>
                    )}
                  </div>

                  {product.useCase ? (
                    <p className="product-research__use-case">{product.useCase}</p>
                  ) : (
                    <p className="product-research__muted">
                      Not researched yet — the author will only see this product's title.
                    </p>
                  )}

                  {row.editorialNote && <p className="product-research__note">Your note: {row.editorialNote}</p>}

                  {product.affiliateLink && (
                    <p className="product-research__link" title={product.affiliateLink}>
                      Affiliate link: <code>{product.affiliateLink}</code>
                    </p>
                  )}
                </div>

                <div className="product-research__item-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={busy === `research-${product.id}`}
                    onClick={() => handleResearch(product.id, product.title)}
                  >
                    {busy === `research-${product.id}`
                      ? 'Researching…'
                      : product.researchStatus === 'researched'
                        ? 'Re-research'
                        : 'Research'}
                  </button>
                  <Link to={`/products/${product.id}`} className="button">
                    Open
                  </Link>
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={busy === `detach-${product.id}`}
                    onClick={() => handleDetach(product.id)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {available.length > 0 && (
        <details className="product-research__existing">
          <summary>Attach a product already in the catalogue ({available.length})</summary>
          <ul className="product-research__list">
            {available.map((product) => (
              <li key={product.id} className="product-research__item">
                {product.primaryImage && (
                  <img className="product-research__thumb" src={product.primaryImage.url} alt="" />
                )}
                <div className="product-research__detail">
                  <strong>{product.title}</strong>
                  {product.brand && <div className="product-research__meta">{product.brand}</div>}
                </div>
                <div className="product-research__item-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={busy === `attach-${product.id}`}
                    onClick={() => handleAttachExisting(product.id)}
                  >
                    Attach
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
