import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchGenerationStatus, generateArticle, fetchGenerationHistory } from './api';
import { ApiError } from '../../shared/services/apiClient';
import type { GeneratedArticle, GenerationPreflight, GenerationHistoryEntry, TokenUsage } from '../../shared/types/generation';
import './GenerateArticlePanel.css';

/**
 * Step 8's Generate Article action (Milestone 9).
 *
 * Shows what will be sent and where before anything happens, runs exactly one
 * generation per press, and displays the result saved against the draft.
 * There is no provider picker on purpose: the Model Router decides, from the
 * default model configured for Article Generation.
 *
 * Generating never publishes anything — the article stays a draft for a human
 * to review.
 */

interface GenerateArticlePanelProps {
  draftId: number;
  /** The draft's working title, shown when the model didn't write a title of its own. */
  workingTitle: string;
}

/** Configuration problems are the user's to fix in AI Provider settings — anything else is not. */
const CONFIGURATION_CODES = new Set([
  'provider_not_configured',
  'missing_api_key',
  'missing_model',
  'unsupported_provider',
  'invalid_configuration',
]);

function formatTimestamp(value: string): string {
  // SQLite datetime('now') is UTC without a zone marker; say so explicitly
  // rather than letting the browser read it as local time.
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function describeUsage(usage: TokenUsage | null): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.promptTokens !== null) parts.push(`${usage.promptTokens.toLocaleString()} prompt`);
  if (usage.completionTokens !== null) parts.push(`${usage.completionTokens.toLocaleString()} completion`);
  if (usage.totalTokens !== null) parts.push(`${usage.totalTokens.toLocaleString()} total`);
  return parts.length ? `${parts.join(' · ')} tokens` : null;
}

/**
 * One compact token figure for a history row. Providers differ in what they
 * report — Anthropic gives input/output but no total — so fall back to the
 * sum only when both halves are present. Nothing is shown when nothing was
 * reported; no count is ever estimated.
 */
function historyTokens(entry: GenerationHistoryEntry): number | null {
  if (entry.totalTokens !== null) return entry.totalTokens;
  if (entry.promptTokens !== null && entry.completionTokens !== null) {
    return entry.promptTokens + entry.completionTokens;
  }
  return null;
}

function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? <span className="editorial-review__empty">Not set</span>}</dd>
    </div>
  );
}

export function GenerateArticlePanel({ draftId, workingTitle }: GenerateArticlePanelProps) {
  const [preflight, setPreflight] = useState<GenerationPreflight | null>(null);
  const [generation, setGeneration] = useState<GeneratedArticle | null>(null);
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [history, setHistory] = useState<GenerationHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  const loadHistory = useCallback(() => {
    fetchGenerationHistory(draftId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [draftId]);

  // Reloads the preflight check and whatever was last generated, so a browser
  // refresh restores the generated article rather than losing it.
  useEffect(() => {
    setIsLoading(true);
    setLoadError(null);

    fetchGenerationStatus(draftId)
      .then((status) => {
        setPreflight(status.preflight);
        setGeneration(status.generation);
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to check generation readiness.');
      })
      .finally(() => setIsLoading(false));

    loadHistory();
  }, [draftId, loadHistory]);

  async function handleGenerate() {
    // Belt and braces alongside the disabled button — the server also refuses
    // a second concurrent request for the same draft.
    if (isGenerating) return;

    setIsGenerating(true);
    setErrors(null);
    setErrorCode(null);
    setCanRetry(false);

    try {
      const result = await generateArticle(draftId);
      setGeneration(result.generation);
      setUsage(result.usage);
      // Re-run the readiness check so the panel reflects the current state.
      fetchGenerationStatus(draftId)
        .then((status) => setPreflight(status.preflight))
        .catch(() => undefined);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors);
        setErrorCode(err.code);
        setCanRetry(err.retryable);
      } else {
        setErrors(['Generation failed. Please try again.']);
        setCanRetry(true);
      }
    } finally {
      setIsGenerating(false);
      loadHistory();
    }
  }

  if (isLoading) return <p>Checking generation readiness…</p>;

  if (loadError) {
    return (
      <p className="form-error" role="alert">
        {loadError}
      </p>
    );
  }

  if (!preflight) return null;

  const providerLabel = preflight.provider ? preflight.provider.name : null;
  const modelLabel = preflight.model ? preflight.model.displayName || preflight.model.modelName : null;
  const promptSize =
    preflight.promptCharacterCount !== null && preflight.promptWordCount !== null
      ? `${preflight.promptCharacterCount.toLocaleString()} characters · ${preflight.promptWordCount.toLocaleString()} words`
      : null;
  const isConfigurationProblem = errorCode !== null && CONFIGURATION_CODES.has(errorCode);
  const usageLabel = describeUsage(usage);

  return (
    <section className="generate-panel">
      <h3>Generate Article</h3>
      <p className="generate-panel__hint">
        Cynth sends the assembled prompt to the model configured for Article Generation. The result is saved as a draft
        for you to review — nothing is published.
      </p>

      <dl className="generate-panel__summary">
        <SummaryRow label="Selected Provider" value={providerLabel} />
        <SummaryRow label="Selected Model" value={modelLabel} />
        <SummaryRow label="Article Type" value={preflight.articleTypeName} />
        <SummaryRow label="Author" value={preflight.authorName} />
        <SummaryRow label="Product" value={preflight.productName ?? 'None'} />
        <SummaryRow label="Prompt Size" value={promptSize} />
      </dl>

      {!preflight.ready && (
        <div className="form-error" role="alert">
          <p>Generation can't run yet:</p>
          <ul>
            {preflight.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          {preflight.configurationErrorCode && (
            <p className="generate-panel__settings-link">
              <Link to="/settings/ai-providers">Open AI Provider settings</Link>
            </p>
          )}
        </div>
      )}

      <div className="generate-panel__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={handleGenerate}
          disabled={!preflight.ready || isGenerating}
        >
          {isGenerating ? 'Generating…' : generation ? 'Generate Again' : 'Generate Article'}
        </button>

        {isGenerating && (
          <span className="generate-panel__status" role="status" aria-live="polite">
            <span className="generate-panel__spinner" aria-hidden="true" />
            Generating with {providerLabel ?? 'the configured provider'} · {modelLabel ?? 'the configured model'} — this
            can take a minute. Please don't close this page.
          </span>
        )}
      </div>

      {errors && (
        <div className="form-error" role="alert">
          <p>Generation failed:</p>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          {isConfigurationProblem && (
            <p className="generate-panel__settings-link">
              <Link to="/settings/ai-providers">Open AI Provider settings</Link>
            </p>
          )}
          {canRetry && (
            <p>
              <button type="button" className="button" onClick={handleGenerate} disabled={isGenerating}>
                Retry Generation
              </button>
            </p>
          )}
        </div>
      )}

      {generation && (
        <article className="generated-article">
          <div className="generated-article__meta">
            <span>
              Generated <strong>{formatTimestamp(generation.generatedAt)}</strong>
            </span>
            <span>
              Provider <strong>{generation.provider ?? '—'}</strong>
            </span>
            <span>
              Model <strong>{generation.model ?? '—'}</strong>
            </span>
            {usageLabel && <span>{usageLabel}</span>}
          </div>

          <h4 className="generated-article__title">{generation.title ?? workingTitle}</h4>
          {generation.title === null && (
            <p className="generate-panel__hint">
              The model didn't return a separate title, so your working title is shown here. The full response is below.
            </p>
          )}

          <div className="generated-article__body" tabIndex={0} aria-label="Generated article">
            {generation.content}
          </div>

          <p className="generate-panel__hint">
            This is an AI-generated draft. It stays unpublished until you review and approve it.
          </p>
        </article>
      )}

      {history.length > 0 && (
        <div className="generate-panel__history">
          <button type="button" className="button" onClick={() => setShowHistory((open) => !open)}>
            {showHistory ? 'Hide' : 'Show'} Generation History ({history.length})
          </button>

          {showHistory && (
            <ul className="generate-panel__history-list">
              {history.map((entry) => {
                const tokens = historyTokens(entry);
                return (
                  <li key={entry.id} className={`generate-panel__history-item is-${entry.status ?? 'unknown'}`}>
                    <span className="generate-panel__history-when">{formatTimestamp(entry.createdAt)}</span>
                    <span className="generate-panel__history-what">
                      {entry.status === 'success' ? 'Success' : 'Failed'} · {entry.provider ?? '—'} ·{' '}
                      {entry.model ?? '—'}
                      {tokens !== null && ` · ${tokens.toLocaleString()} tokens`}
                      {entry.durationMs !== null && ` · ${(entry.durationMs / 1000).toFixed(1)}s`}
                    </span>
                    {entry.errorMessage && <span className="generate-panel__history-error">{entry.errorMessage}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
