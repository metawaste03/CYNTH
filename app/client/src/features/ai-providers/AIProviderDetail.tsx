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
  testModel,
} from './api';
import { purposeLabel, PURPOSE_LABELS } from './purposeLabels';
import { ModelDiscovery } from './ModelDiscovery';
import { CapabilityPicker } from './CapabilityPicker';
import { ModelValidationReport } from './ModelValidationReport';
import { costClassLabel, formatPerMillion } from './pricing';
import type {
  CapabilityMeta,
  ModelPurpose,
  ModelValidationResult,
  ProviderDetail as ProviderDetailType,
  ProviderModel,
} from '../../shared/types/aiProvider';
import { ApiError } from '../../shared/services/apiClient';
import './AIProviderDetail.css';

interface ModelDraft {
  modelName: string;
  displayName: string;
  /** A capability SET (Milestone 15) — a model may hold several. */
  purposes: ModelPurpose[];
  isEnabled: boolean;
}

const EMPTY_MODEL_DRAFT: ModelDraft = { modelName: '', displayName: '', purposes: [], isEnabled: true };

/**
 * Fallback capability list, used only until /ai-providers/meta answers.
 * The server owns the labels, so a capability added there needs no change here.
 */
const FALLBACK_CAPABILITIES: CapabilityMeta[] = (Object.keys(PURPOSE_LABELS) as ModelPurpose[]).map((value) => ({
  value,
  label: PURPOSE_LABELS[value],
  description: '',
  implemented: true,
}));

/** The validation state, as a short badge. */
function ValidationBadge({ model }: { model: ProviderModel }) {
  const status = model.validation?.status ?? 'unvalidated';
  const label =
    status === 'valid' ? 'Validated' : status === 'invalid' ? 'Validation failed' : 'Not validated';

  return (
    <span className={`model-validation-badge model-validation-badge--${status}`} title={model.validation?.message ?? ''}>
      {label}
    </span>
  );
}

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
  const [capabilityMeta, setCapabilityMeta] = useState<CapabilityMeta[]>(FALLBACK_CAPABILITIES);
  /** Per-model Test Model state, keyed by registry id. */
  const [testingModelId, setTestingModelId] = useState<number | null>(null);
  const [modelTestResult, setModelTestResult] = useState<{ modelId: number; result: ModelValidationResult } | null>(
    null,
  );
  const [pendingPaidTest, setPendingPaidTest] = useState<{ modelId: number; message: string } | null>(null);
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
      .then((meta) => setCapabilityMeta(meta.capabilities?.length ? meta.capabilities : FALLBACK_CAPABILITIES))
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
        purposes: modelDraft.purposes,
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
      purposes: (model.assignedCapabilities ?? []).map((capability) => capability.purpose),
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
        purposes: editDraft.purposes,
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

  async function handleSetModelDefault(model: ProviderModel, purpose: ModelPurpose) {
    setModelError(null);
    try {
      await setModelDefault(providerId, model.id, purpose);
      load(); // reload so any other provider's model that lost default-for-purpose is reflected too
    } catch (err) {
      setModelError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to set default model.');
    }
  }

  /**
   * TEST MODEL.
   *
   * Sends the smallest request that establishes the model works. It does not
   * create an article. A paid model comes back as a 402 the first time, with
   * the estimated cost, so the confirmation is an informed one rather than a
   * blank "are you sure".
   */
  async function handleTestModel(model: ProviderModel, confirmed = false) {
    setModelError(null);
    setPendingPaidTest(null);
    setModelTestResult(null);
    setTestingModelId(model.id);

    try {
      const outcome = await testModel(providerId, model.id, confirmed);
      if (outcome.validation) setModelTestResult({ modelId: model.id, result: outcome.validation });
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        // Not a failure: Cynth declined to spend without being asked to.
        setPendingPaidTest({ modelId: model.id, message: err.errors.join(' ') });
      } else {
        setModelError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to test the model.');
      }
    } finally {
      setTestingModelId(null);
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
            <CapabilityPicker
              idPrefix="add-model"
              capabilities={capabilityMeta}
              selected={modelDraft.purposes}
              onChange={(purposes) => setModelDraft((d) => ({ ...d, purposes }))}
            />
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
                    <CapabilityPicker
                      idPrefix={`edit-model-${model.id}`}
                      capabilities={capabilityMeta}
                      selected={editDraft.purposes}
                      onChange={(purposes) => setEditDraft((d) => ({ ...d, purposes }))}
                    />
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
                        <ValidationBadge model={model} />
                      </div>
                    </div>

                    {/* CAPABILITIES. A model may hold several, and each one
                        carries its own default flag — "the default article
                        model" and "the default SEO model" are independent
                        choices that one model can hold both of. */}
                    <ul className="provider-model-card__capabilities">
                      {(model.assignedCapabilities ?? []).length === 0 ? (
                        <li className="capability-chip capability-chip--none">
                          No capability assigned — this model appears in no workflow&rsquo;s picker
                        </li>
                      ) : (
                        model.assignedCapabilities.map((capability) => (
                          <li
                            key={capability.purpose}
                            className={`capability-chip${capability.isDefaultForPurpose ? ' capability-chip--default' : ''}`}
                          >
                            {purposeLabel(capability.purpose)}
                            {capability.isDefaultForPurpose && <span className="capability-chip__tag">Default</span>}
                          </li>
                        ))
                      )}
                    </ul>

                    {model.validation?.lastTest && (
                      <p
                        className={`provider-model-card__test provider-model-card__test--${model.validation.lastTest.status}`}
                      >
                        <strong>
                          Last test: {model.validation.lastTest.status === 'passed' ? 'Passed' : 'Failed'}
                        </strong>{' '}
                        ({model.validation.lastTest.mode === 'live' ? 'live request' : 'metadata only'},{' '}
                        {model.validation.lastTest.testedAt}) — {model.validation.lastTest.message}
                      </p>
                    )}
                    {model.validation?.status === 'invalid' && !model.validation.lastTest && (
                      <p className="provider-model-card__warning" role="note">
                        {model.validation.message}
                      </p>
                    )}

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
                    {/* A paid model is never tested without being asked
                        for twice: the first press reports the cost, the
                        second one spends it. */}
                    {pendingPaidTest?.modelId === model.id && (
                      <div className="provider-model-card__cost-warning" role="alert">
                        <p>{pendingPaidTest.message}</p>
                        <div className="provider-model-card__actions">
                          <button
                            type="button"
                            className="button button--primary"
                            onClick={() => handleTestModel(model, true)}
                          >
                            Run the test anyway
                          </button>
                          <button type="button" className="button" onClick={() => setPendingPaidTest(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {modelTestResult?.modelId === model.id && (
                      <ModelValidationReport result={modelTestResult.result} />
                    )}

                    <div className="provider-model-card__actions">
                      <button
                        type="button"
                        className="button"
                        disabled={testingModelId === model.id}
                        onClick={() => handleTestModel(model)}
                      >
                        {testingModelId === model.id ? 'Testing…' : 'Test Model'}
                      </button>
                      {(model.assignedCapabilities ?? [])
                        .filter((capability) => !capability.isDefaultForPurpose)
                        .map((capability) => (
                          <button
                            key={capability.purpose}
                            type="button"
                            className="button"
                            onClick={() => handleSetModelDefault(model, capability.purpose)}
                          >
                            Make default for {purposeLabel(capability.purpose)}
                          </button>
                        ))}
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
