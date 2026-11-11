import { useEffect, useState } from 'react';
import { api, ApiError } from '../../shared/services/apiClient';
import type { GenerationMode, GenerationModeResponse } from '../../shared/types/generation';
import '../content/Content.css';

/**
 * The switch that decides whether Cynth is allowed to spend money.
 *
 * Deliberately a separate, explicit decision from confirming any individual
 * generation: being in Production mode permits spending, it does not approve
 * it. Every paid generation still needs its own confirmation.
 *
 * Test mode is the default, because the safe state has to be the one you get
 * by doing nothing.
 */
export function GenerationModeCard() {
  const [mode, setMode] = useState<GenerationMode | null>(null);
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<GenerationModeResponse>('/generation/mode')
      .then((r) => {
        setMode(r.mode);
        setDescription(r.description);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not read the generation mode.'));
  }

  useEffect(load, []);

  async function change(next: GenerationMode) {
    if (next === mode) return;
    if (
      next === 'production' &&
      !window.confirm(
        'Production mode allows Cynth to use paid models. Every paid generation will still ask you to confirm its estimated cost. Continue?',
      )
    ) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await api.put<{ mode: GenerationMode }>('/generation/mode', { mode: next });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not change the generation mode.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!mode) {
    return error ? (
      <p className="form-error" role="alert">
        {error}
      </p>
    ) : null;
  }

  return (
    <section className="content-section">
      <h2>Generation Mode</h2>

      <p className="content-hint">{description}</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="content-form__actions">
        <button
          type="button"
          className={`button${mode === 'test' ? ' button--primary' : ''}`}
          disabled={isSaving}
          onClick={() => change('test')}
        >
          Test — free models only
        </button>
        <button
          type="button"
          className={`button${mode === 'production' ? ' button--primary' : ''}`}
          disabled={isSaving}
          onClick={() => change('production')}
        >
          Production — paid models allowed
        </button>
      </div>

      <p className="content-hint">
        Cynth never falls back from a free model to a paid one. If a free model fails, generation stops and the choice
        is yours.
      </p>
    </section>
  );
}
