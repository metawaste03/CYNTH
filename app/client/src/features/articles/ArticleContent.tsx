import type { ReactElement } from 'react';
import type { ArticleProductCard } from './api';
import './ArticleContent.css';

/**
 * The article body, with `[[product:id]]` markers shown as the cards they
 * become.
 *
 * WHY THIS EXISTS. The writer never writes an image, a price or a URL — it
 * writes a marker, and the card is assembled from stored records at push time.
 * That is a deliberate rule: a link the model never sees is a link it cannot
 * alter, which is how the affiliate URL stays exactly as the editor supplied
 * it.
 *
 * The cost of that rule was that Cynth showed the marker as literal text. An
 * editor who had uploaded a primary image for every product saw it nowhere in
 * the app, and reasonably concluded the images were never used at all. They
 * were — but only after publishing, which is the last place you want to first
 * see how a card looks.
 *
 * So this renders the card, from the same fields the CMS renderer reads, with
 * the same precedence: the uploaded primary image wins over the retailer's.
 * It is a PREVIEW, not the published markup — `productCard.ts` remains the one
 * thing that generates what WordPress receives, and nothing here is ever sent
 * to a model or written back to the article.
 */

const MARKER = /^\s*\[\[product:(\d+)\]\]\s*$/;

/** How many features a preview card shows, matching the published card's cap. */
const MAX_CARD_FEATURES = 4;

function ProductCard({ product }: { product: ArticleProductCard }) {
  // The card says what the product is FOR — the one line a reader needs at the
  // point the writer reached for it.
  const blurb = product.useCase ?? product.description;

  return (
    <aside className="efd-card" data-product-id={product.productId}>
      {product.imageUrl ? (
        <img className="efd-card__image" src={product.imageUrl} alt={product.title} loading="lazy" />
      ) : (
        // Said plainly rather than left as a gap, because a missing image is
        // something the editor can fix on the Products page.
        <div className="efd-card__image efd-card__image--missing">No image</div>
      )}

      <div className="efd-card__body">
        <p className="efd-card__title">{product.title}</p>
        {product.brand && <p className="efd-card__brand">{product.brand}</p>}
        {blurb && <p className="efd-card__summary">{blurb}</p>}

        {product.keyFeatures.length > 0 && (
          <ul className="efd-card__features">
            {product.keyFeatures.slice(0, MAX_CARD_FEATURES).map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        )}

        {/* rel matches what the published card emits, so the preview behaves
            like the real thing rather than merely looking like it. */}
        {product.affiliateUrl ? (
          <p className="efd-card__cta">
            <a href={product.affiliateUrl} target="_blank" rel="sponsored nofollow noopener">
              Check price
            </a>
          </p>
        ) : (
          <p className="efd-card__warning">No affiliate link — this card will publish without one.</p>
        )}
      </div>
    </aside>
  );
}

/**
 * A marker whose product is not attached.
 *
 * The server strips invalid markers before storing, so this should not appear
 * — and if it does, showing it is the point. Silently dropping it would hide a
 * card the published article will also be missing.
 */
function OrphanMarker({ productId }: { productId: number }) {
  return (
    <p className="efd-card__orphan">
      A product card was placed here for product {productId}, which is no longer attached to this article. It will not
      appear when published.
    </p>
  );
}

export function ArticleContent({
  content,
  products,
}: {
  content: string;
  products: ArticleProductCard[];
}) {
  const byId = new Map(products.map((product) => [product.productId, product]));

  // Split on marker lines, keeping the prose between them intact. The content
  // is rendered as preformatted text exactly as before — this changes what a
  // marker looks like, and nothing else about how the body is displayed.
  const blocks: ReactElement[] = [];
  let prose: string[] = [];

  const flush = (key: string) => {
    const text = prose.join('\n');
    prose = [];
    if (text.trim()) blocks.push(<div key={key} className="article-view__content">{text}</div>);
  };

  content.split(/\r?\n/).forEach((line, index) => {
    const match = MARKER.exec(line);
    if (!match) {
      prose.push(line);
      return;
    }

    flush(`prose-${index}`);
    const productId = Number(match[1]);
    const product = byId.get(productId);
    blocks.push(
      product ? (
        <ProductCard key={`card-${index}`} product={product} />
      ) : (
        <OrphanMarker key={`orphan-${index}`} productId={productId} />
      ),
    );
  });

  flush('prose-end');

  return <>{blocks}</>;
}
