import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError, api } from '../../shared/services/apiClient';
import { fetchRoles, setRole } from './api';
import type { PipelineMode, RoleAssignment, RoleModel } from './api';
import '../content/Content.css';
import './Pipeline.css';

/**
 * Which model plays which role, per mode.
 *
 * The cost tier is shown beside every option because the allocation is the
 * point: premium models on topic research and writing, a much cheaper one on
 * the narrow keyword and title task. Making the price visible is what lets a
 * reassignment be judged rather than guessed at.
 */
export function ModelRoles() {
  const [mode, setMode] = useState<PipelineMode>('production');
  const [roles, setRoles] = useState<RoleAssignment[]>([]);
  const [models, setModels] = useState<RoleModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load(target: PipelineMode) {
    setIsLoading(true);
    fetchRoles(target)
      .then((data) => {
        setRoles(data.roles);
        setModels(data.models);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load model roles.'))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => load(mode), [mode]);

  async function change(role: string, field: 'primaryModelId' | 'fallbackModelId', value: string) {
    const current = roles.find((r) => r.role === role);
    if (!current) return;

    setBusy(role);
    try {
      await setRole(mode, role, {
        primaryModelId: field === 'primaryModelId' ? (value ? Number(value) : null) : current.primary?.id ?? null,
        fallbackModelId: field === 'fallbackModelId' ? (value ? Number(value) : null) : current.fallback?.id ?? null,
      });
      load(mode);
      setNotice('Saved.');
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not save that assignment.');
      setNotice(null);
    } finally {
      setBusy(null);
    }
  }

  async function seedDefaults() {
    setBusy('seed');
    try {
      await api.post('/pipeline/roles/seed', {});
      load(mode);
      setNotice('Default models registered and roles assigned.');
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not seed the defaults.');
    } finally {
      setBusy(null);
    }
  }

  function priceOf(model: RoleModel): string {
    if (model.isFree) return 'free';
    if (model.promptPrice === null || model.completionPrice === null) return 'price unknown';
    return `$${(model.promptPrice * 1e6).toFixed(2)}/$${(model.completionPrice * 1e6).toFixed(2)} per M`;
  }

  function label(model: RoleModel): string {
    return `${model.displayName ?? model.modelName} — ${priceOf(model)}`;
  }

  if (isLoading) {
    return (
      <div className="page">
        <p>Loading model roles…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Model Roles"
        description="Which model performs which job. Development and Production run the identical pipeline — only these assignments differ."
      />

      <p className="content-scope">
        <Link to="/settings">← Settings</Link>
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}

      <section className="content-section">
        <div className="content-section__head">
          <h2>Mode</h2>
          <button type="button" className="button" disabled={busy === 'seed'} onClick={seedDefaults}>
            {busy === 'seed' ? 'Seeding…' : 'Restore Defaults'}
          </button>
        </div>

        <label className="wizard-field">
          Configuring
          <select value={mode} onChange={(e) => setMode(e.target.value as PipelineMode)}>
            <option value="production">Production — the paid models used for real articles</option>
            <option value="development">Development — free models for exercising the pipeline</option>
          </select>
        </label>

        <p className="content-hint">
          A fallback is used <strong>only</strong> when the primary fails technically — a timeout, a provider error, a
          rate limit. It is never used because a result was judged poor: that is an editorial problem, and it triggers
          the one permitted revision instead.
        </p>
      </section>

      <section className="content-section">
        <h2>Roles</h2>

        {roles.map((role) => (
          <div key={role.role} className="role-row">
            <div>
              <span className="role-row__name">{role.label}</span>
              <span className="role-row__guidance">{role.description}</span>
              <span className="role-row__guidance">
                <strong>Recommended:</strong> {role.costGuidance}
              </span>
              {role.issues.map((issue) => (
                <span key={issue} className="role-row__guidance" style={{ color: 'var(--color-danger, inherit)' }}>
                  {issue}
                </span>
              ))}
            </div>

            <div>
              <span className="role-row__label">Primary</span>
              <select
                value={role.primary?.id ?? ''}
                disabled={busy === role.role}
                onChange={(e) => change(role.role, 'primaryModelId', e.target.value)}
              >
                <option value="">Unassigned</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {label(model)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="role-row__label">Fallback (technical failure only)</span>
              <select
                value={role.fallback?.id ?? ''}
                disabled={busy === role.role}
                onChange={(e) => change(role.role, 'fallbackModelId', e.target.value)}
              >
                <option value="">None</option>
                {models
                  .filter((model) => model.fallbackEligible && model.id !== role.primary?.id)
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      {label(model)}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
