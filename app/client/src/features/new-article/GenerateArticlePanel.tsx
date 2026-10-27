import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchGenerationStatus, generateArticle, fetchGenerationHistory } from './api';
import { fetchSelectableModels } from '../ai-providers/api';
import { ModelPicker } from './ModelPicker';
import { formatCost } from '../ai-providers/pricing';
import type { SelectableModel } from '../../shared/types/aiProvider';
import { ApiError } from '../../shared/services/apiClient';
import type {
  GeneratedArticle,
  GenerationPreflight,
  GenerationHistoryEntry,
  TokenUsage,
} from '../../shared/types/generation';
import './GenerateArticlePanel.css';

/**
 * Step 8's Generate Article action (Milestone 9).
 *
 * Shows what will be sent and where before anything happens, runs exactly one
 * generation per press, and displays the result saved against the draft.
 *
 * The model is selectable (Milestone 13) and its price is stated plainly
 * beside it. The selection names a registry entry only — the Model Router
 * still resolves which provider serves it, so the browser never picks an
 * endpoint or touches a credential. A selected model is the model that runs:
 * there is no path where Cynth substitutes a different one, and above all
 * none where a free model quietly becomes a paid one.
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
  // Cost confirmation is per attempt and never sticky: it resets whenever the
  // panel reloads, so a paid generation can never be triggered by a stale tick.
  const [costConfirmed, setCostConfirmed] = useState(false);

  // The model the user picked, or null to use the configured default for
  // Article Generation. Held here rather than in the preflight so the
  // preflight can be re-read *for* the chosen model.
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [selectableModels, setSelectableModels] = useState<SelectableModel[]>([]);
  /** The model the configured default resolves to, so the picker can name it. */
  const [defaultModelLabel, setDefaultModelLabel] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    fetchGenerationHistory(draftId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [draftId]);

  // Reloads the preflight check and whatever was last generated, so a browser
  // refresh restores the generated article rather than losing it.
  //
  // Re-runs whenever the selected model changes: the provider, the price and
  // the spend decision all belong to the model, so switching models must
  // re-ask the server rather than leaving stale figures on screen.
  useEffect(() => {
    setIsLoading(true);
    setLoadError(null);
    // Any earlier confirmation applied to the previous model. Switching models
    // is a new spending decision.
    setCostConfirmed(false);

    fetchGenerationStatus(draftId, selectedModelId)
      .then((status) => {
        setPreflight(status.preflight);
        setGeneration(status.generation);
        // Remember what the default resolves to, from the one request that
        // asked for the default.
        if (selectedModelId === null && status.preflight.model) {
          setDefaultModelLabel(status.preflight.model.displayName || status.preflight.model.modelName);
        }
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to check generation readiness.');
      })
      .finally(() => setIsLoading(false));
  }, [draftId, selectedModelId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  /**
   * The models available to choose from.
   *
   * PURPOSE FILTERING (Milestone 15): only models registered for Article
   * Generation. An SEO reviewer is a different job with a different best
   * answer, and offering every registered model here hid that — the whole
   * reason a model now carries a capability set.
   *
   * A failure here is not fatal: without a picker the configured default
   * still works.
   */
  useEffect(() => {
    fetchSelectableModels('article_generation')
      .then(setSelectableModels)
      .catch(() => setSelectableModels([]));
  }, []);

  async function handleGenerate() {
    // Belt and braces alongside the disabled button — the server also refuses
    // a second concurrent request for the same draft.
    if (isGenerating) return;

    setIsGenerating(true);
    setErrors(null);
    setErrorCode(null);
    setCanRetry(false);

    try {
      const result = await generateArticle(draftId, costConfirmed, selectedModelId);
      setGeneration(result.generation);
      setUsage(result.usage);
      // Re-run the readiness check so the panel reflects the current state.
      fetchGenerationStatus(draftId, selectedModelId)
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
      // Require a fresh decision for any subsequent paid attempt.
      setCostConfirmed(false);
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
        Cynth sends the assembled prompt to the model you choose below. The result is saved as a draft for you to
        review — nothing is published.
      </p>

      {/* MODEL SELECTION. The price of the choice is shown with the choice,
          never behind it. */}
      <ModelPicker
        models={selectableModels}
        value={selectedModelId}
        onChange={setSelectedModelId}
        disabled={isGenerating}
        defaultModelLabel={defaultModelLabel}
      />

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

      {/* GENERATION PLAN — what Cynth is about to do, and what it may cost,
          shown before the user can commit to anything. */}
      <div className={`generate-panel__plan is-${preflight.costClass}`}>
        <p className="generate-panel__plan-head">
          <strong>{preflight.mode === 'test' ? 'Test mode' : 'Production mode'}</strong>
          {' · '}
          {preflight.costClass === 'free'
            ? 'Free model'
            : preflight.costClass === 'paid'
              ? 'Paid model'
              : 'Pricing unknown — treated as paid'}
        </p>

        {preflight.cost && (
          <p className="generate-panel__plan-cost">
            {preflight.cost.totalCost !== null ? (
              <>
                Estimated cost: <strong>{formatCost(preflight.cost.totalCost)}</strong>{' '}
                <span className="generate-panel__hint">
                  (~{preflight.cost.promptTokens?.toLocaleString()} prompt +{' '}
                  {preflight.cost.estimatedCompletionTokens?.toLocaleString()} output tokens)
                </span>
              </>
            ) : (
              <>Estimated cost: <strong>unavailable</strong></>
            )}
          </p>
        )}

        {preflight.cost && <p className="generate-panel__hint">{preflight.cost.note}</p>}

        {preflight.spend && !preflight.spend.allowed && preflight.spend.reason && (
          <p className={preflight.spend.requiresConfirmation ? 'generate-panel__hint' : 'form-error'} role="note">
            {preflight.spend.reason}
          </p>
        )}

        {/* FREE MODEL SAFETY, stated where the decision is made. Cynth has no
            fallback path at all: a failed free model is an error to report,
            never a reason to try a paid one. */}
        {preflight.costClass === 'free' && (
          <p className="generate-panel__hint">
            Cynth will use this model and no other. If it fails, generation fails — Cynth never switches to a
            different model, and never to a paid one.
          </p>
        )}

        {/* A paid generation cannot start until this is deliberately ticked.
            There is no path where Cynth substitutes a free model instead. */}
        {preflight.spend?.requiresConfirmation && (
          <label className="generate-panel__confirm">
            <input
              type="checkbox"
              checked={costConfirmed}
              onChange={(e) => setCostConfirmed(e.target.checked)}
            />
            I understand this will use a paid model and may charge my provider account.
          </label>
        )}
      </div>

      <div className="generate-panel__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={handleGenerate}
          disabled={
            !preflight.ready ||
            isGenerating ||
            (preflight.spend?.requiresConfirmation === true && !costConfirmed) ||
            (preflight.spend?.allowed === false && preflight.spend?.requiresConfirmation === false)
          }
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

          {/* The wizard's state is not the article store — the database is.
              This links to the persisted Article record, which stays findable
              from the Dashboard and Drafts long after the wizard is closed. */}
          <p className="generate-panel__settings-link">
            <Link to={`/articles/${draftId}`}>Open the saved draft &rarr;</Link>
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
