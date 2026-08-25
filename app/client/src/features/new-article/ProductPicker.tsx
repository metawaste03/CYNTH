import { useEffect, useState } from 'react';
import { fetchProducts } from '../products/api';
import type { ProductListItem } from '../../shared/types/product';
import { ApiError } from '../../shared/services/apiClient';

interface ProductPickerProps {
  selectedProductId: number | null;
  onSelect: (productId: number | null) => void;
}

/** Optional — active products only, image + name + brand, deselectable. */
export function ProductPicker({ selectedProductId, onSelect }: ProductPickerProps) {
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts({ status: 'active' })
      .then(setProducts)
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load products.'))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <p>Loading products…</p>;
  if (error) {
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="product-picker">
      <p className="product-picker__hint">Optional — link a product this article covers, or skip this step.</p>

      {products.length === 0 ? (
        <p>No active products yet.</p>
      ) : (
        <div className="product-picker__grid" role="radiogroup" aria-label="Product">
          {products.map((product) => (
            <label
              key={product.id}
              className={`product-picker__option${selectedProductId === product.id ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name="product"
                checked={selectedProductId === product.id}
                onChange={() => onSelect(product.id)}
              />
              {product.primaryImage ? (
                <img src={product.primaryImage.url} alt="" className="product-picker__thumb" />
              ) : (
                <div className="product-picker__thumb product-picker__thumb--empty" aria-hidden="true" />
              )}
              <span className="product-picker__name">{product.title}</span>
              <span className="product-picker__brand">{product.brand || '—'}</span>
            </label>
          ))}
        </div>
      )}

      {selectedProductId !== null && (
        <button type="button" className="button" onClick={() => onSelect(null)}>
          Deselect Product
        </button>
      )}
    </div>
  );
}
