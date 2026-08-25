import { useEffect, useState, type FormEvent } from 'react';
import type { ProviderInput } from '../../shared/types/aiProvider';
import { ApiError } from '../../shared/services/apiClient';
import { fetchProviderMeta } from './api';
import './ProviderForm.css';

export interface ProviderFormValues {
  name: string;
  providerType: string;
  description: string;
  baseUrl: string;
  defaultModel: string;
}

interface ProviderFormProps {
  initialValues?: Partial<ProviderFormValues>;
  /** Whether a key is already stored — changes the API key field's hint text. */
  hasExistingKey?: boolean;
  submitLabel: string;
  onSubmit: (input: ProviderInput) => Promise<void>;
}

const EMPTY_VALUES: ProviderFormValues = {
  name: '',
  providerType: '',
  description: '',
  baseUrl: '',
  defaultModel: '',
};

export function ProviderForm({ initialValues, hasExistingKey, submitLabel, onSubmit }: ProviderFormProps) {
  const [values, setValues] = useState<ProviderFormValues>({ ...EMPTY_VALUES, ...initialValues });
  const [apiKey, setApiKey] = useState('');
  const [providerTypes, setProviderTypes] = useState<readonly string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchProviderMeta()
      .then((meta) => setProviderTypes(meta.providerTypes))
      .catch(() => undefined);
  }, []);

  function updateField<K extends keyof ProviderFormValues>(key: K, value: ProviderFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors([]);

    const clientErrors: string[] = [];
    if (!values.name.trim()) clientErrors.push('Provider Name is required.');
    if (!values.providerType.trim()) clientErrors.push('Provider type is required.');
    if (clientErrors.length) {
      setErrors(clientErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: values.name.trim(),
        providerType: values.providerType.trim(),
        description: values.description.trim() || undefined,
        baseUrl: values.baseUrl.trim() || undefined,
        defaultModel: values.defaultModel.trim() || undefined,
        // Leaving the field blank means "don't change the stored key" — only send it if the user typed something.
        apiKey: apiKey ? apiKey : undefined,
      });
    } catch (err) {
      setErrors(err instanceof ApiError ? err.errors : ['Something went wrong. Please try again.']);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="provider-form" onSubmit={handleSubmit} noValidate>
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
          Provider Name <span aria-hidden="true">*</span>
          <input value={values.name} onChange={(e) => updateField('name', e.target.value)} required maxLength={200} />
        </label>
        <label>
          Provider Type <span aria-hidden="true">*</span>
          <input
            value={values.providerType}
            onChange={(e) => updateField('providerType', e.target.value)}
            list="provider-type-options"
            placeholder="openrouter, anthropic, openai, or your own"
            required
          />
          <datalist id="provider-type-options">
            {providerTypes.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
        </label>
        <label>
          Description
          <textarea rows={2} value={values.description} onChange={(e) => updateField('description', e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Connection</legend>
        <label>
          API Key
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasExistingKey ? 'Leave blank to keep the current key' : 'Not set'}
          />
        </label>
        <p className="provider-form__hint">
          Stored as a local environment variable, never in the database, and never sent back to this page.
        </p>
        <label>
          Base URL (optional)
          <input value={values.baseUrl} onChange={(e) => updateField('baseUrl', e.target.value)} placeholder="https://…" />
        </label>
        <label>
          Default Model
          <input value={values.defaultModel} onChange={(e) => updateField('defaultModel', e.target.value)} placeholder="e.g. gpt-4o" />
        </label>
      </fieldset>

      <div className="provider-form__actions">
        <button type="submit" className="button button--primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
