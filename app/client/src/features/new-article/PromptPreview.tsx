import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { fetchAssembledPrompt, fetchModelRoute } from './api';
import type { AssembledPrompt } from '../../shared/types/prompt';
import type { ModelRouteResult } from '../../shared/types/modelRoute';
import { ApiError } from '../../shared/services/apiClient';
import './PromptPreview.css';

const SECTION_HEADING = /^=== .+ ===$/;

export function PromptPreview() {
  const { id } = useParams();
  const draftId = Number(id);

  const [result, setResult] = useState<AssembledPrompt | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [route, setRoute] = useState<ModelRouteResult | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setValidationErrors(null);
    setNotFound(false);
    setResult(null);

    fetchAssembledPrompt(draftId)
      .then(setResult)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else if (err instanceof ApiError) {
          setValidationErrors(err.errors);
        } else {
          setValidationErrors(['Failed to build the prompt.']);
        }
      })
      .finally(() => setIsLoading(false));
  }, [draftId]);

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.prompt);
      setCopyMessage('Copied to clipboard.');
    } catch {
      setCopyMessage('Could not copy — your browser blocked clipboard access.');
    }
  }

  async function handlePrepareForGeneration() {
    setIsRouting(true);
    setRouteError(null);
    try {
      const routeResult = await fetchModelRoute('article_generation');
      setRoute(routeResult);
    } catch (err) {
      setRouteError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to check routing configuration.');
    } finally {
      setIsRouting(false);
    }
  }

  function handleExport() {
    if (!result) return;
    const blob = new Blob([result.prompt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cynth-prompt-draft-${draftId}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <PageHeader
        title="Prompt Preview"
        description="The complete prompt package assembled from this draft. Read-only — nothing is sent anywhere yet."
      />

      <p>
        <Link to={`/new-article/${draftId}`}>Back to draft</Link>
      </p>

      {isLoading ? (
        <p>Assembling prompt…</p>
      ) : notFound ? (
        <p className="form-error" role="alert">
          Draft not found.
        </p>
      ) : validationErrors ? (
        <div className="form-error" role="alert">
          <p>The prompt can't be assembled yet — the following are required:</p>
          <ul>
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : result ? (
        <>
          <div className="prompt-preview__meta">
            <span>
              <strong>{result.characterCount.toLocaleString()}</strong> characters
            </span>
            <span>
              <strong>{result.wordCount.toLocaleString()}</strong> words
            </span>
          </div>

          <div className="prompt-preview__actions">
            <button type="button" className="button button--primary" onClick={handleCopy}>
              Copy Prompt
            </button>
            <button type="button" className="button" onClick={handleExport}>
              Export Prompt (.txt)
            </button>
            {copyMessage && (
              <span className="prompt-preview__copy-message" role="status">
                {copyMessage}
              </span>
            )}
          </div>

          <pre className="prompt-preview__body" tabIndex={0} aria-label="Assembled prompt">
            {result.prompt.split('\n').map((line, index) => (
              <div key={index} className={SECTION_HEADING.test(line) ? 'prompt-preview__heading' : undefined}>
                {line || ' '}
              </div>
            ))}
          </pre>

          <section className="prompt-preview__handoff">
            <h2>Prompt Handoff</h2>
            <p className="prompt-preview__handoff-hint">
              Checks which provider and model are configured for Article Generation. No request is sent — this only
              reads local configuration.
            </p>
            <button type="button" className="button" onClick={handlePrepareForGeneration} disabled={isRouting}>
              {isRouting ? 'Checking…' : 'Prepare For Generation'}
            </button>

            {routeError && (
              <p className="form-error" role="alert">
                {routeError}
              </p>
            )}

            {route && (
              <dl className="prompt-preview__handoff-summary">
                <div>
                  <dt>Selected Provider</dt>
                  <dd>
                    {route.provider ? route.provider.name : <span className="editorial-review__empty">Not configured</span>}
                  </dd>
                </div>
                <div>
                  <dt>Selected Model</dt>
                  <dd>
                    {route.model ? (
                      route.model.displayName || route.model.modelName
                    ) : (
                      <span className="editorial-review__empty">Not configured</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Prompt Size</dt>
                  <dd>
                    {result.characterCount.toLocaleString()} characters · {result.wordCount.toLocaleString()} words
                  </dd>
                </div>
                {!route.configured && route.reason && (
                  <div>
                    <dt>Status</dt>
                    <dd>{route.reason}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
