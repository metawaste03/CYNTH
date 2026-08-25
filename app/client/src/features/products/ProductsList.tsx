import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { fetchProducts, fetchProductCategories, setProductStatus, deleteProduct } from './api';
import type { ProductListItem } from '../../shared/types/product';
import { ApiError } from '../../shared/services/apiClient';
import './ProductsList.css';

function formatDate(value: string): string {
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ProductsList() {
  const location = useLocation();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);
    fetchProducts({
      search: search.trim() || undefined,
      category: categoryFilter || undefined,
      status: statusFilter || undefined,
    })
      .then(setProducts)
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load products.'))
      .finally(() => setIsLoading(false));
  }, [search, categoryFilter, statusFilter]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    fetchProductCategories()
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  const hasFilters = Boolean(search || categoryFilter || statusFilter);

  async function handleToggleStatus(product: ProductListItem) {
    setBusyId(product.id);
    try {
      await setProductStatus(product.id, !product.isActive);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to update status.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(product: ProductListItem) {
    if (!window.confirm(`Delete ${product.title}? This also deletes its images.`)) return;
    setBusyId(product.id);
    try {
      await deleteProduct(product.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to delete product.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      {flash && (
        <div className="flash-banner" role="status">
          {flash}
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="products-list__header">
        <PageHeader title="Products" description="Reference data for products mentioned or reviewed in articles." />
        <Link to="/products/new" className="button button--primary">
          Add Product
        </Link>
      </div>

      <div className="products-list__filters">
        <input
          type="search"
          placeholder="Search by title, brand, or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search products"
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | 'active' | 'inactive')}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {isLoading ? (
        <p>Loading products…</p>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <h2>{hasFilters ? 'No products match your filters' : 'No products yet'}</h2>
          <p>{hasFilters ? 'Try a different search or clear your filters.' : 'Add your first product to get started.'}</p>
        </div>
      ) : (
        <div className="products-list__table-wrap">
          <table className="products-list__table">
            <thead>
              <tr>
                <th scope="col" aria-label="Image" />
                <th scope="col">Product Title</th>
                <th scope="col">Brand</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col">Last Updated</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    {product.primaryImage ? (
                      <img className="products-list__thumb" src={product.primaryImage.url} alt="" />
                    ) : (
                      <div className="products-list__thumb products-list__thumb--empty" aria-hidden="true" />
                    )}
                  </td>
                  <td>
                    <Link to={`/products/${product.id}`}>{product.title}</Link>
                  </td>
                  <td>{product.brand || '—'}</td>
                  <td>{product.category || '—'}</td>
                  <td>
                    <span className={`status-badge ${product.isActive ? 'is-active' : 'is-inactive'}`}>
                      {product.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{formatDate(product.updatedAt)}</td>
                  <td className="products-list__actions">
                    <button type="button" className="button" onClick={() => handleToggleStatus(product)} disabled={busyId === product.id}>
                      {product.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <Link to={`/products/${product.id}/edit`} className="button">
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => handleDelete(product)}
                      disabled={busyId === product.id}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
