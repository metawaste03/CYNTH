import { useState } from 'react';
import { ApiError } from '../../shared/services/apiClient';
import type { Topic, TopicInput } from '../../shared/types/content';

/**
 * Create or edit a topic, including the editorial guidance that reaches the
 * model at generation time.
 *
 * Structured fields rather than one large textarea: each field maps to a
 * distinct instruction in the prompt, so "what should this article avoid" is
 * separable from "what should it cover". Every field is optional — Cynth
 * never fills editorial direction in on the user's behalf.
 */

interface TopicFormProps {
  initial?: Topic;
  submitLabel: string;
  onSubmit: (values: TopicInput) => Promise<void>;
  onCancel: () => void;
}

export function TopicForm({ initial, submitLabel, onSubmit, onCancel }: TopicFormProps) {
  const [values, setValues] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    scope: initial?.scope ?? '',
    keyAreas: initial?.keyAreas ?? '',
    considerations: initial?.considerations ?? '',
    exclusions: initial?.exclusions ?? '',
    notes: initial?.notes ?? '',
    isActive: initial ? initial.isActive : true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!values.title.trim()) return;

    setIsSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: values.title.trim(),
        description: values.description.trim() || undefined,
        scope: values.scope.trim() || undefined,
        keyAreas: values.keyAreas.trim() || undefined,
        considerations: values.considerations.trim() || undefined,
        exclusions: values.exclusions.trim() || undefined,
        notes: values.notes.trim() || undefined,
        isActive: values.isActive,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not save the topic.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="content-form content-form--boxed" onSubmit={handleSubmit}>
      <label>
        Topic title <span aria-hidden="true">*</span>
        <input value={values.title} onChange={(e) => update('title', e.target.value)} required />
      </label>

      <label>
        What this topic covers
        <textarea
          rows={2}
          value={values.description}
          onChange={(e) => update('description', e.target.value)}
          placeholder="A short description of the subject."
        />
      </label>

      <label>
        Scope
        <textarea
          rows={2}
          value={values.scope}
          onChange={(e) => update('scope', e.target.value)}
          placeholder="How broad or narrow the article should be."
        />
      </label>

      <label>
        Key areas to cover
        <textarea
          rows={3}
          value={values.keyAreas}
          onChange={(e) => update('keyAreas', e.target.value)}
          placeholder="The points an article on this topic should always address."
        />
      </label>

      <label>
        Important considerations
        <textarea
          rows={2}
          value={values.considerations}
          onChange={(e) => update('considerations', e.target.value)}
          placeholder="Accuracy, safety, or editorial care this topic demands."
        />
      </label>

      <label>
        Out of scope — do not cover
        <textarea
          rows={2}
          value={values.exclusions}
          onChange={(e) => update('exclusions', e.target.value)}
          placeholder="Boundaries the article must respect. Sent to the model as an explicit instruction."
        />
      </label>

      <label>
        Additional notes
        <textarea rows={2} value={values.notes} onChange={(e) => update('notes', e.target.value)} />
      </label>

      <label className="content-form__checkbox">
        <input type="checkbox" checked={values.isActive} onChange={(e) => update('isActive', e.target.checked)} />
        Active
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="content-form__actions">
        <button type="submit" className="button button--primary" disabled={isSaving || !values.title.trim()}>
          {isSaving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="button" onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
