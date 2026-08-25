import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { fetchAuthors, fetchAuthorCategories, setAuthorStatus, deleteAuthor } from './api';
import type { Author } from '../../shared/types/author';
import { ApiError } from '../../shared/services/apiClient';
import './AuthorsList.css';

function formatDate(value: string): string {
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function AuthorsList() {
  const location = useLocation();
  const [authors, setAuthors] = useState<Author[]>([]);
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
    fetchAuthors({
      search: search.trim() || undefined,
      category: categoryFilter || undefined,
      status: statusFilter || undefined,
    })
      .then(setAuthors)
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load authors.'))
      .finally(() => setIsLoading(false));
  }, [search, categoryFilter, statusFilter]);

  // Debounce so search/filter changes don't fire a request per keystroke.
  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    fetchAuthorCategories()
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  const hasFilters = Boolean(search || categoryFilter || statusFilter);

  async function handleToggleStatus(author: Author) {
    setBusyId(author.id);
    try {
      await setAuthorStatus(author.id, !author.isActive);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to update status.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(author: Author) {
    if (!window.confirm(`Delete ${author.name}? This also deletes their writing samples.`)) return;
    setBusyId(author.id);
    try {
      await deleteAuthor(author.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to delete author.');
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

      <div className="authors-list__header">
        <PageHeader title="Authors" description="Manage the author identities Cynth uses to keep each byline's voice consistent." />
        <Link to="/authors/new" className="button button--primary">
          New Author
        </Link>
      </div>

      <div className="authors-list__filters">
        <input
          type="search"
          placeholder="Search by name or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search authors"
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
        <p>Loading authors…</p>
      ) : authors.length === 0 ? (
        <div className="empty-state">
          <h2>{hasFilters ? 'No authors match your filters' : 'No authors yet'}</h2>
          <p>{hasFilters ? 'Try a different search or clear your filters.' : 'Create your first author to get started.'}</p>
        </div>
      ) : (
        <div className="authors-list__table-wrap">
          <table className="authors-list__table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col">Last Updated</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {authors.map((author) => (
                <tr key={author.id}>
                  <td>
                    <Link to={`/authors/${author.id}`}>{author.name}</Link>
                  </td>
                  <td>{author.category || '—'}</td>
                  <td>
                    <span className={`status-badge ${author.isActive ? 'is-active' : 'is-inactive'}`}>
                      {author.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{formatDate(author.updatedAt)}</td>
                  <td className="authors-list__actions">
                    <button type="button" className="button" onClick={() => handleToggleStatus(author)} disabled={busyId === author.id}>
                      {author.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <Link to={`/authors/${author.id}/edit`} className="button">
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => handleDelete(author)}
                      disabled={busyId === author.id}
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
