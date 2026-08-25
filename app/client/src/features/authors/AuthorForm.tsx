import { useState, type FormEvent } from 'react';
import type { AuthorInput, WritingSampleInput } from '../../shared/types/author';
import { ApiError } from '../../shared/services/apiClient';
import './AuthorForm.css';

export interface AuthorFormValues {
  name: string;
  category: string;
  shortBiography: string;
  philosophy: string;
  writingStyle: string;
  tone: string;
  targetAudience: string;
  preferredExpressions: string;
  prohibitedExpressions: string;
  writingNotes: string;
  isActive: boolean;
}

interface AuthorFormProps {
  initialValues?: Partial<AuthorFormValues>;
  /** Only the create flow collects writing samples inline — edit manages them from the detail page. */
  showSamplesEditor?: boolean;
  submitLabel: string;
  onSubmit: (input: AuthorInput) => Promise<void>;
}

const EMPTY_VALUES: AuthorFormValues = {
  name: '',
  category: '',
  shortBiography: '',
  philosophy: '',
  writingStyle: '',
  tone: '',
  targetAudience: '',
  preferredExpressions: '',
  prohibitedExpressions: '',
  writingNotes: '',
  isActive: true,
};

export function AuthorForm({ initialValues, showSamplesEditor, submitLabel, onSubmit }: AuthorFormProps) {
  const [values, setValues] = useState<AuthorFormValues>({ ...EMPTY_VALUES, ...initialValues });
  const [samples, setSamples] = useState<WritingSampleInput[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<K extends keyof AuthorFormValues>(key: K, value: AuthorFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function updateSample(index: number, patch: Partial<WritingSampleInput>) {
    setSamples((prev) => prev.map((sample, i) => (i === index ? { ...sample, ...patch } : sample)));
  }

  function addSampleRow() {
    setSamples((prev) => [...prev, { title: '', notes: '', fullText: '' }]);
  }

  function removeSampleRow(index: number) {
    setSamples((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors([]);

    const clientErrors: string[] = [];
    if (!values.name.trim()) clientErrors.push('Name is required.');
    if (showSamplesEditor) {
      samples.forEach((sample, index) => {
        if (!sample.title.trim()) clientErrors.push(`Writing sample ${index + 1}: title is required.`);
        if (!sample.fullText?.trim()) clientErrors.push(`Writing sample ${index + 1}: full text is required.`);
      });
    }
    if (clientErrors.length) {
      setErrors(clientErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: values.name.trim(),
        category: values.category.trim() || undefined,
        shortBiography: values.shortBiography.trim() || undefined,
        philosophy: values.philosophy.trim() || undefined,
        writingStyle: values.writingStyle.trim() || undefined,
        tone: values.tone.trim() || undefined,
        targetAudience: values.targetAudience.trim() || undefined,
        preferredExpressions: values.preferredExpressions.trim() || undefined,
        prohibitedExpressions: values.prohibitedExpressions.trim() || undefined,
        writingNotes: values.writingNotes.trim() || undefined,
        isActive: values.isActive,
        writingSamples: showSamplesEditor && samples.length ? samples : undefined,
      });
    } catch (err) {
      setErrors(err instanceof ApiError ? err.errors : ['Something went wrong. Please try again.']);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="author-form" onSubmit={handleSubmit} noValidate>
      {errors.length > 0 && (
        <div className="form-error" role="alert">
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset>
        <legend>General</legend>
        <label>
          Name <span aria-hidden="true">*</span>
          <input value={values.name} onChange={(e) => updateField('name', e.target.value)} required maxLength={200} />
        </label>
        <label>
          Category
          <input value={values.category} onChange={(e) => updateField('category', e.target.value)} />
        </label>
        <label>
          Short Biography
          <textarea rows={3} value={values.shortBiography} onChange={(e) => updateField('shortBiography', e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Editorial</legend>
        <label>
          Philosophy
          <textarea rows={3} value={values.philosophy} onChange={(e) => updateField('philosophy', e.target.value)} />
        </label>
        <label>
          Writing Style
          <textarea rows={3} value={values.writingStyle} onChange={(e) => updateField('writingStyle', e.target.value)} />
        </label>
        <label>
          Tone
          <input value={values.tone} onChange={(e) => updateField('tone', e.target.value)} />
        </label>
        <label>
          Target Audience
          <input value={values.targetAudience} onChange={(e) => updateField('targetAudience', e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>AI Guidance</legend>
        <label>
          Preferred Recurring Expressions
          <textarea
            rows={2}
            value={values.preferredExpressions}
            onChange={(e) => updateField('preferredExpressions', e.target.value)}
          />
        </label>
        <label>
          Prohibited Expressions
          <textarea
            rows={2}
            value={values.prohibitedExpressions}
            onChange={(e) => updateField('prohibitedExpressions', e.target.value)}
          />
        </label>
        <label>
          Writing Notes
          <textarea rows={3} value={values.writingNotes} onChange={(e) => updateField('writingNotes', e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Status</legend>
        <label className="author-form__checkbox">
          <input type="checkbox" checked={values.isActive} onChange={(e) => updateField('isActive', e.target.checked)} />
          Active
        </label>
      </fieldset>

      {showSamplesEditor && (
        <fieldset>
          <legend>Writing Samples</legend>
          <p className="author-form__hint">
            Optional. Add approved writing samples now, or add them later from the author's detail page.
          </p>
          {samples.map((sample, index) => (
            <div className="author-form__sample" key={index}>
              <label>
                Title
                <input value={sample.title} onChange={(e) => updateSample(index, { title: e.target.value })} />
              </label>
              <label>
                Notes
                <input value={sample.notes ?? ''} onChange={(e) => updateSample(index, { notes: e.target.value })} />
              </label>
              <label>
                Full Text
                <textarea rows={4} value={sample.fullText} onChange={(e) => updateSample(index, { fullText: e.target.value })} />
              </label>
              <button type="button" className="button button--danger" onClick={() => removeSampleRow(index)}>
                Remove sample
              </button>
            </div>
          ))}
          <button type="button" className="button" onClick={addSampleRow}>
            Add writing sample
          </button>
        </fieldset>
      )}

      <div className="author-form__actions">
        <button type="submit" className="button button--primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
