import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import {
  fetchProvider,
  fetchProviderMeta,
  deleteProvider,
  setProviderStatus,
  setDefaultProvider,
  testProviderConnection,
  syncProviderModels,
  addModel,
  updateModel,
  setModelStatus,
  setModelDefault,
  deleteModel,
} from './api';
import { purposeLabel, PURPOSE_LABELS } from './purposeLabels';
import { ModelDiscovery } from './ModelDiscovery';
import { costClassLabel, formatPerMillion } from './pricing';
import type { ModelPurpose, ProviderDetail as ProviderDetailType, ProviderModel } from '../../shared/types/aiProvider';
import { ApiError } from '../../shared/services/apiClient';
import './AIProviderDetail.css';

interface ModelDraft {
  modelName: string;
  displayName: string;
  purpose: ModelPurpose | '';
  isEnabled: boolean;
}

const EMPTY_MODEL_DRAFT: ModelDraft = { modelName: '', displayName: '', purpose: '', isEnabled: true };

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="provider-detail__field">
      <dt>{label}</dt>
      <dd>{value?.trim() ? value : <span className="provider-detail__empty">Not set</span>}</dd>
    </div>
  );
}

export function AIProviderDetail() {
  const { id } = useParams();
  const providerId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();

  const [provider, setProvider] = useState<ProviderDetailType | null>(null);
  const [purposes, setPurposes] = useState<readonly ModelPurpose[]>(Object.keys(PURPOSE_LABELS) as ModelPurpose[]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [isAddingModel, setIsAddingModel] = useState(false);
  const [modelDraft, setModelDraft] = useState<ModelDraft>(EMPTY_MODEL_DRAFT);
  const [editingModelId, setEditingModelId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ModelDraft>(EMPTY_MODEL_DRAFT);

  function load() {
    setIsLoading(true);
    fetchProvider(providerId)
      .then(setProvider)
      .catch(() => setError('Provider not found.'))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    fetchProviderMeta()
      .then((meta) => setPurposes(meta.purposes))
      .catch(() => undefined);
  }, [providerId]);

  async function handleToggleStatus() {
    if (!provider) return;
    const updated = await setProviderStatus(provider.id, !provider.isActive);
    setProvider((prev) => (prev ? { ...prev, isActive: updated.isActive } : prev));
  }

  async function handleSetDefault() {
    if (!provider) return;
    await setDefaultProvider(provider.id);
    load();
  }

  async function handleDelete() {
    if (!provider) return;
    if (!window.confirm(`Delete ${provider.name}? This also deletes its models and stored API key.`)) return;
    await deleteProvider(provider.id);
    navigate('/settings/ai-providers', { state: { flash: `${provider.name} was deleted.` } });
  }

  /**
   * Pulls the provider's model catalogue so Cynth knows what its models cost.
   * Free/paid classification and every cost estimate depend on this having
   * been run at least once.
   */
  async function handleSyncModels() {
    setBusy(true);
    try {
      const result = await syncProviderModels(Number(id));
      setTestMessage(
        `Refreshed from ${result.providerName}: ${result.catalogSize} models in the catalogue ` +
          `(${result.counts.free} free, ${result.counts.paid} paid, ${result.counts.unknown} with no published pricing). ` +
          `Updated metadata for ${result.updated} registered model(s). Your purposes and defaults were preserved.` +
          (result.missingFromCatalog.length
            ? ` No longer in the catalogue: ${result.missingFromCatalog.join(', ')} — their last known pricing has been kept.`
            : ''),
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not read the provider model catalogue.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTestConnection() {
    if (!provider) return;
    setBusy(true);
    try {
      const result = await testProviderConnection(provider.id);
      setTestMessage(result.message);
      // A successful test has just refreshed the catalogue cache, so the
      // discovery browser below is now showing current data too.
      await load();
    } catch (err) {
      setTestMessage(err instanceof ApiError ? err.errors.join(' ') : 'Failed to test connection.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddModel(event: FormEvent) {
    event.preventDefault();
    setModelError(null);
    if (!modelDraft.modelName.trim()) {
      setModelError('Model Name is required.');
      return;
    }
    try {
      const model = await addModel(providerId, {
        modelName: modelDraft.modelName,
        displayName: modelDraft.displayName || undefined,
        purpose: modelDraft.purpose || undefined,
        isEnabled: modelDraft.isEnabled,
      });
      setProvider((prev) => (prev ? { ...prev, models: [...prev.models, model], modelCount: prev.modelCount + 1 } : prev));
      setModelDraft(EMPTY_MODEL_DRAFT);
      setIsAddingModel(false);
    } catch (err) {
      setModelError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to add model.');
    }
  }

  function startEditModel(model: ProviderModel) {
    setEditingModelId(model.id);
    setEditDraft({
      modelName: model.modelName,
      displayName: model.displayName ?? '',
      purpose: model.purpose ?? '',
      isEnabled: model.isEnabled,
    });
    setModelError(null);
  }

  async function handleSaveModel(modelId: number) {
    if (!editDraft.modelName.trim()) {
      setModelError('Model Name is required.');
      return;
    }
    try {
      const updated = await updateModel(providerId, modelId, {
        modelName: editDraft.modelName,
        displayName: editDraft.displayName || undefined,
        purpose: editDraft.purpose || undefined,
        isEnabled: editDraft.isEnabled,
      });
      setProvider((prev) =>
        prev ? { ...prev, models: prev.models.map((m) => (m.id === modelId ? updated : m)) } : prev,
      );
      setEditingModelId(null);
    } catch (err) {
      setModelError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to save model.');
    }
  }

  async function handleToggleModelEnabled(model: ProviderModel) {
    const updated = await setModelStatus(providerId, model.id, !model.isEnabled);
    setProvider((prev) => (prev ? { ...prev, models: prev.models.map((m) => (m.id === model.id ? updated : m)) } : prev));
  }

  async function handleSetModelDefault(model: ProviderModel) {
    setModelError(null);
    try {
      await setModelDefault(providerId, model.id);
      load(); // reload so any other provider's model that lost default-for-purpose is reflected too
    } catch (err) {
      setModelError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to set default model.');
    }
  }

  async function handleDeleteModel(modelId: number) {
    if (!window.confirm('Remove this model?')) return;
    await deleteModel(providerId, modelId);
    setProvider((prev) =>
      prev ? { ...prev, models: prev.models.filter((m) => m.id !== modelId), modelCount: prev.modelCount - 1 } : prev,
    );
  }

  if (isLoading) {
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    );
  }

  if (error || !provider) {
    return (
      <div className="page">
        <PageHeader title="Provider not found" description="This AI provider may have been deleted." />
        <Link to="/settings/ai-providers">Back to AI Providers</Link>
      </div>
    );
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

      <div className="provider-detail__header">
        <PageHeader title={provider.name} description={provider.providerType} />
        <div className="provider-detail__actions">
          <span className={`status-badge ${provider.isActive ? 'is-active' : 'is-inactive'}`}>
            {provider.isActive ? 'Active' : 'Inactive'}
          </span>
          {provider.isDefault && <span className="status-badge is-active">Default Provider</span>}
          <button type="button" className="button" onClick={handleToggleStatus}>
            {provider.isActive ? 'Deactivate' : 'Activate'}
          </button>
          {!provider.isDefault && (
            <button type="button" className="button" onClick={handleSetDefault}>
              Set Default
            </button>
          )}
          <button type="button" className="button" onClick={handleTestConnection} disabled={busy}>
            Test Connection
          </button>
          {/* Pricing has to come from the provider — Cynth never guesses a
              cost. A metadata read: it generates nothing and costs nothing. */}
          <button type="button" className="button" onClick={handleSyncModels} disabled={busy}>
            Refresh Model Metadata
          </button>
          <Link to={`/settings/ai-providers/${provider.id}/edit`} className="button">
            Edit
          </Link>
          <button type="button" className="button button--danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>

      {testMessage && (
        <p className="provider-detail__test-message" role="status">
          {testMessage}
        </p>
      )}

      <section className="provider-detail__section">
        <h2>General</h2>
        <dl>
          <Field label="Description" value={provider.description} />
        </dl>
      </section>

      <section className="provider-detail__section">
        <h2>Connection</h2>
        <dl>
          <Field label="API Key" value={provider.hasApiKey ? 'Set (hidden)' : null} />
          <Field label="Base URL" value={provider.baseUrl} />
          <Field label="Default Model" value={provider.defaultModel} />
        </dl>
      </section>

      <section className="provider-detail__section">
        <div className="provider-detail__models-header">
          <h2>Models</h2>
          <button
            type="button"
            className="button"
            onClick={() => {
              setIsAddingModel((v) => !v);
              setModelError(null);
            }}
          >
            {isAddingModel ? 'Cancel' : 'Add Model'}
          </button>
        </div>

        {modelError && (
          <p className="form-error" role="alert">
            {modelError}
          </p>
        )}

        {isAddingModel && (
          <form className="provider-model-form" onSubmit={handleAddModel}>
            <label>
              Model Name
              <input value={modelDraft.modelName} onChange={(e) => setModelDraft((d) => ({ ...d, modelName: e.target.value }))} placeholder="e.g. gpt-4o" />
            </label>
            <label>
              Display Name
              <input value={modelDraft.displayName} onChange={(e) => setModelDraft((d) => ({ ...d, displayName: e.target.value }))} />
            </label>
            <label>
              Purpose
              <select value={modelDraft.purpose} onChange={(e) => setModelDraft((d) => ({ ...d, purpose: e.target.value as ModelPurpose | '' }))}>
                <option value="">No purpose set</option>
                {purposes.map((purpose) => (
                  <option key={purpose} value={purpose}>
                    {purposeLabel(purpose)}
                  </option>
                ))}
              </select>
            </label>
            <label className="provider-model-form__checkbox">
              <input type="checkbox" checked={modelDraft.isEnabled} onChange={(e) => setModelDraft((d) => ({ ...d, isEnabled: e.target.checked }))} />
              Enabled
            </label>
            <div className="provider-form__actions">
              <button type="submit" className="button button--primary">
                Save Model
              </button>
            </div>
          </form>
        )}

        {provider.models.length === 0 ? (
          <p>No models yet.</p>
        ) : (
          <ul className="provider-detail__models">
            {provider.models.map((model) => (
              <li key={model.id} className="provider-model-card">
                {editingModelId === model.id ? (
                  <div className="provider-model-form">
                    <label>
                      Model Name
                      <input value={editDraft.modelName} onChange={(e) => setEditDraft((d) => ({ ...d, modelName: e.target.value }))} />
                    </label>
                    <label>
                      Display Name
                      <input value={editDraft.displayName} onChange={(e) => setEditDraft((d) => ({ ...d, displayName: e.target.value }))} />
                    </label>
                    <label>
                      Purpose
                      <select value={editDraft.purpose} onChange={(e) => setEditDraft((d) => ({ ...d, purpose: e.target.value as ModelPurpose | '' }))}>
                        <option value="">No purpose set</option>
                        {purposes.map((purpose) => (
                          <option key={purpose} value={purpose}>
                            {purposeLabel(purpose)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="provider-model-form__checkbox">
                      <input type="checkbox" checked={editDraft.isEnabled} onChange={(e) => setEditDraft((d) => ({ ...d, isEnabled: e.target.checked }))} />
                      Enabled
                    </label>
                    <div className="provider-form__actions">
                      <button type="button" className="button button--primary" onClick={() => handleSaveModel(model.id)}>
                        Save
                      </button>
                      <button type="button" className="button" onClick={() => setEditingModelId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="provider-model-card__header">
                      <div>
                        <h3>{model.displayName || model.modelName}</h3>
                        <p className="provider-model-card__model-name">{model.modelName}</p>
                      </div>
                      <div className="provider-model-card__badges">
                        <span className={`status-badge ${model.isEnabled ? 'is-active' : 'is-inactive'}`}>
                          {model.isEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                        {model.isDefaultForPurpose && <span className="status-badge is-active">Default</span>}
                      </div>
                    </div>
                    <p className="provider-model-card__purpose">{purposeLabel(model.purpose)}</p>

                    {/* PRICING IS NEVER HIDDEN. A model with no published
                        price says so plainly — it is treated as paid, and
                        showing a blank would let it read as free. */}
                    <dl className="provider-model-card__pricing">
                      <div>
                        <dt>Cost</dt>
                        <dd>
                          <span className={`cost-badge is-${model.costClass}`}>{costClassLabel(model.costClass)}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Input</dt>
                        <dd>{formatPerMillion(model.promptPrice)}</dd>
                      </div>
                      <div>
                        <dt>Output</dt>
                        <dd>{formatPerMillion(model.completionPrice)}</dd>
                      </div>
                      <div>
                        <dt>Context</dt>
                        <dd>
                          {model.contextLength
                            ? `${Math.round(model.contextLength / 1000).toLocaleString()}K tokens`
                            : 'Not published'}
                        </dd>
                      </div>
                      <div>
                        <dt>Vendor</dt>
                        <dd>{model.vendor ?? 'Not published'}</dd>
                      </div>
                      <div>
                        <dt>Metadata</dt>
                        <dd>
                          {model.pricingSyncedAt
                            ? `Refreshed ${new Date(`${model.pricingSyncedAt.replace(' ', 'T')}Z`).toLocaleDateString()}`
                            : 'Never refreshed'}
                        </dd>
                      </div>
                    </dl>

                    {model.inCatalog === false && (
                      <p className="provider-model-card__warning" role="note">
                        This model is no longer in {provider.name}’s catalogue. Its last known pricing has been kept,
                        but generation with it may fail.
                      </p>
                    )}
                    <div className="provider-model-card__actions">
                      {model.purpose && !model.isDefaultForPurpose && (
                        <button type="button" className="button" onClick={() => handleSetModelDefault(model)}>
                          Set as Default for Purpose
                        </button>
                      )}
                      <button type="button" className="button" onClick={() => handleToggleModelEnabled(model)}>
                        {model.isEnabled ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" className="button" onClick={() => startEditModel(model)}>
                        Edit
                      </button>
                      <button type="button" className="button button--danger" onClick={() => handleDeleteModel(model.id)}>
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Discover -> inspect -> add. No model name is hardcoded in Cynth;
          everything offered here comes from the provider's live catalogue. */}
      <ModelDiscovery providerId={provider.id} providerName={provider.name} onModelAdded={load} />
    </div>
  );
}
