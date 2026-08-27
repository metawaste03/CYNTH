import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { GenerationModeCard } from './GenerationModeCard';
import { fetchProviders, setProviderStatus, setDefaultProvider, deleteProvider } from './api';
import type { Provider } from '../../shared/types/aiProvider';
import { ApiError } from '../../shared/services/apiClient';
import './AIProvidersList.css';

export function AIProvidersList() {
  const location = useLocation();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);
    fetchProviders()
      .then(setProviders)
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load providers.'))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggleStatus(provider: Provider) {
    setBusyId(provider.id);
    try {
      await setProviderStatus(provider.id, !provider.isActive);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to update status.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetDefault(provider: Provider) {
    setBusyId(provider.id);
    try {
      await setDefaultProvider(provider.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to set default provider.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(provider: Provider) {
    if (!window.confirm(`Delete ${provider.name}? This also deletes its models and stored API key.`)) return;
    setBusyId(provider.id);
    try {
      await deleteProvider(provider.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to delete provider.');
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

      <div className="ai-providers-list__header">
        <PageHeader
          title="AI Providers"
          description="Configure the AI providers and models Cynth routes generation tasks to, and whether it may spend money."
        />
        <Link to="/settings/ai-providers/new" className="button button--primary">
          Add Provider
        </Link>
      </div>

      <GenerationModeCard />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {isLoading ? (
        <p>Loading providers…</p>
      ) : providers.length === 0 ? (
        <div className="empty-state">
          <h2>No providers yet</h2>
          <p>Add your first AI provider to get started.</p>
        </div>
      ) : (
        <div className="ai-providers-list__table-wrap">
          <table className="ai-providers-list__table">
            <thead>
              <tr>
                <th scope="col">Provider Name</th>
                <th scope="col">Type</th>
                <th scope="col">Models</th>
                <th scope="col">API Key</th>
                <th scope="col">Status</th>
                <th scope="col">Default</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>
                    <Link to={`/settings/ai-providers/${provider.id}`}>{provider.name}</Link>
                  </td>
                  <td>{provider.providerType}</td>
                  <td>{provider.modelCount}</td>
                  <td>{provider.hasApiKey ? 'Set' : 'Not set'}</td>
                  <td>
                    <span className={`status-badge ${provider.isActive ? 'is-active' : 'is-inactive'}`}>
                      {provider.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{provider.isDefault ? <span className="status-badge is-active">Default</span> : '—'}</td>
                  <td className="ai-providers-list__actions">
                    <button type="button" className="button" onClick={() => handleToggleStatus(provider)} disabled={busyId === provider.id}>
                      {provider.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    {!provider.isDefault && (
                      <button type="button" className="button" onClick={() => handleSetDefault(provider)} disabled={busyId === provider.id}>
                        Set Default
                      </button>
                    )}
                    <Link to={`/settings/ai-providers/${provider.id}/edit`} className="button">
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => handleDelete(provider)}
                      disabled={busyId === provider.id}
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
