import { useCallback, useEffect, useMemo, useState } from 'react';
import { addModelFromCatalog, discoverModels, fetchProviderMeta } from './api';
import { purposeLabel, PURPOSE_LABELS } from './purposeLabels';
import { ModelValidationReport } from './ModelValidationReport';
import { formatPerMillion, costClassLabel } from './pricing';
import type {
  CatalogFilter,
  CatalogModel,
  CatalogResult,
  ModelPurpose,
  ModelValidationResult,
} from '../../shared/types/aiProvider';
import { ApiError } from '../../shared/services/apiClient';
import './ModelDiscovery.css';

/**
 * MODEL DISCOVERY — browse a provider's live catalogue, inspect a model, add
 * it to Cynth's registry.
 *
 *   Discover -> inspect -> add
 *
 * No model name is hardcoded anywhere in Cynth. Everything on this screen was
 * published by the provider moments ago, which is the point: OpenRouter's
 * roster changes constantly, and adding a model must never mean editing
 * source code.
 *
 * Free / Paid is decided from published pricing, never from a model's name —
 * OpenRouter lists ids ending in ":free", and it also lists paid models with
 * "free" in their names.
 */

interface ModelDiscoveryProps {
  providerId: number;
  providerName: string;
  /** Called after a model is added, so the parent can refresh its registry list. */
  onModelAdded: () => void;
}

const PAGE_SIZE = 50;

const FILTERS: { value: CatalogFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
  { value: 'unknown', label: 'No pricing' },
];

function formatContext(length: number | null): string {
  if (length === null) return 'Not published';
  if (length >= 1000) return `${Math.round(length / 1000).toLocaleString()}K tokens`;
  return `${length.toLocaleString()} tokens`;
}

function formatWhen(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleTimeString();
}

export function ModelDiscovery({ providerId, providerName, onModelAdded }: ModelDiscoveryProps) {
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [inspectedId, setInspectedId] = useState<string | null>(null);
  /** The capability SET chosen for each catalogue entry — a model may hold several. */
  const [purposesById, setPurposesById] = useState<Record<string, ModelPurpose[]>>({});
  const [addingId, setAddingId] = useState<string | null>(null);
  /** The last validation report, so a refused model explains itself instead of just failing. */
  const [validationById, setValidationById] = useState<Record<string, ModelValidationResult>>({});

  /**
   * The capability list comes from the SERVER, not from the label map.
   *
   * The map is fallback wording only. Deriving the list from it meant a
   * capability added on the server was assignable everywhere except here —
   * which is exactly how Featured Image Generation ended up invisible on the
   * one screen where a new model is added.
   */
  const [serverPurposes, setServerPurposes] = useState<ModelPurpose[] | null>(null);
  useEffect(() => {
    fetchProviderMeta()
      .then((meta) => {
        const values = (meta.capabilities ?? []).map((capability) => capability.value as ModelPurpose);
        if (values.length) setServerPurposes(values);
      })
      .catch(() => undefined);
  }, []);

  const purposes = useMemo(
    () => serverPurposes ?? (Object.keys(PURPOSE_LABELS) as ModelPurpose[]),
    [serverPurposes],
  );

  const load = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      setIsLoading(true);
      setError(null);
      try {
        const loaded = await discoverModels(providerId, {
          filter,
          search,
          refresh: options.refresh,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        });
        setResult(loaded);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.errors.join(' ') : 'Could not read the provider’s model catalogue.',
        );
        setResult(null);
      } finally {
        setIsLoading(false);
      }
    },
    [providerId, filter, search, page],
  );

  // Debounced so typing in the search box does not fire a request per
  // keystroke. The catalogue itself is cached server-side, so this is about
  // render churn rather than network load.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  /**
   * ADD MODEL — validated first, saved second.
   *
   * The server runs the full pipeline before writing anything, so a refusal
   * here means nothing was saved. A 422 carries the per-stage report, which
   * is rendered rather than collapsed into "Request Failed": the whole point
   * is that "your Base URL points at the website" and "that model id does not
   * exist" are different problems with different fixes.
   */
  async function handleAdd(model: CatalogModel) {
    setAddingId(model.id);
    setError(null);
    setValidationById((prev) => {
      const next = { ...prev };
      delete next[model.id];
      return next;
    });

    try {
      const outcome = await addModelFromCatalog(providerId, {
        modelName: model.id,
        purposes: purposesById[model.id] ?? [],
      });
      setFlash(outcome.message);
      if (outcome.validation) {
        setValidationById((prev) => ({ ...prev, [model.id]: outcome.validation! }));
      }
      onModelAdded();
      // Reflect the new registered state without a full re-fetch.
      setResult((prev) =>
        prev
          ? { ...prev, models: prev.models.map((m) => (m.id === model.id ? { ...m, isRegistered: true } : m)) }
          : prev,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.details?.stages) {
        setValidationById((prev) => ({
          ...prev,
          [model.id]: {
            ok: false,
            code: err.code,
            message: err.errors.join(' '),
            failedStage: err.details!.failedStage ?? null,
            stages: err.details!.stages ?? [],
            costClass: model.costClass,
            liveProbeRan: false,
            probe: null,
          },
        }));
      } else {
        setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not add that model.');
      }
    } finally {
      setAddingId(null);
    }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.matched / PAGE_SIZE)) : 1;

  return (
    <section className="model-discovery">
      <div className="model-discovery__header">
        <div>
          <h2>Discover Models</h2>
          <p className="model-discovery__hint">
            {providerName}’s live catalogue. Cynth stores no model list of its own — everything here comes from the
            provider, including the prices.
          </p>
        </div>
        <button type="button" className="button" onClick={() => void load({ refresh: true })} disabled={isLoading}>
          {isLoading ? 'Reading…' : 'Refresh Catalogue'}
        </button>
      </div>

      <div className="model-discovery__controls">
        <div className="model-discovery__filters" role="group" aria-label="Filter models by price">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`model-discovery__filter${filter === option.value ? ' is-selected' : ''}`}
              onClick={() => {
                setFilter(option.value);
                setPage(0);
              }}
            >
              {option.label}
              {result && option.value !== 'all' && (
                <span className="model-discovery__filter-count">
                  {option.value === 'free'
                    ? result.counts.free
                    : option.value === 'paid'
                      ? result.counts.paid
                      : result.counts.unknown}
                </span>
              )}
              {result && option.value === 'all' && (
                <span className="model-discovery__filter-count">{result.total}</span>
              )}
            </button>
          ))}
        </div>

        <label className="model-discovery__search">
          <span className="visually-hidden">Search models</span>
          <input
            type="search"
            value={search}
            placeholder="Search by model, id or vendor…"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>

      {flash && (
        <div className="flash-banner" role="status">
          {flash}
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <p className="model-discovery__meta">
          Showing {result.models.length} of {result.matched} matching · {result.total} in the catalogue ·{' '}
          {result.fromCache ? 'cached' : 'read'} at {formatWhen(result.fetchedAt)}
        </p>
      )}

      {isLoading && !result && <p>Reading the provider’s catalogue…</p>}

      {result && result.models.length === 0 && !isLoading && (
        <p className="model-discovery__empty">
          No models match that filter. {filter !== 'all' && 'Try "All", or a different search.'}
        </p>
      )}

      <ul className="model-discovery__list">
        {result?.models.map((model) => {
          const isInspected = inspectedId === model.id;
          return (
            <li key={model.id} className={`catalog-model is-${model.costClass}`}>
              <div className="catalog-model__main">
                <div className="catalog-model__identity">
                  <h3>{model.displayName || model.id}</h3>
                  <p className="catalog-model__id">{model.id}</p>
                </div>

                <div className="catalog-model__badges">
                  <span className={`cost-badge is-${model.costClass}`}>{costClassLabel(model.costClass)}</span>
                  {model.isRegistered && <span className="status-badge is-active">In registry</span>}
                  {model.status && <span className="status-badge is-inactive">{model.status}</span>}
                </div>
              </div>

              <dl className="catalog-model__facts">
                <div>
                  <dt>Provider</dt>
                  <dd>{model.vendor ?? 'Not published'}</dd>
                </div>
                <div>
                  <dt>Context</dt>
                  <dd>{formatContext(model.contextLength)}</dd>
                </div>
                <div>
                  <dt>Input</dt>
                  <dd>{formatPerMillion(model.promptPrice)}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>{formatPerMillion(model.completionPrice)}</dd>
                </div>
                {/* Only when there is one — but when there is one it is often
                    the only price the model has, and its absence is what made
                    "Paid" look like a mistake. */}
                {model.imageOutputPrice !== null && (
                  <div>
                    <dt>Image output</dt>
                    <dd>{formatPerMillion(model.imageOutputPrice)}</dd>
                  </div>
                )}
              </dl>

              <div className="catalog-model__actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => setInspectedId(isInspected ? null : model.id)}
                  aria-expanded={isInspected}
                >
                  {isInspected ? 'Hide details' : 'Inspect'}
                </button>

                {/* A capability SET, not a single purpose: one model may
                    legitimately write articles AND review SEO. */}
                <div className="catalog-model__capabilities">
                  <span className="visually-hidden">Capabilities for {model.id}</span>
                  {purposes.map((purpose) => {
                    const chosen = purposesById[model.id] ?? [];
                    return (
                      <label key={purpose} className="catalog-model__capability">
                        <input
                          type="checkbox"
                          checked={chosen.includes(purpose)}
                          onChange={(event) =>
                            setPurposesById((prev) => ({
                              ...prev,
                              [model.id]: event.target.checked
                                ? [...chosen, purpose]
                                : chosen.filter((value) => value !== purpose),
                            }))
                          }
                        />
                        {purposeLabel(purpose)}
                      </label>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void handleAdd(model)}
                  disabled={addingId === model.id}
                >
                  {addingId === model.id
                    ? 'Validating…'
                    : model.isRegistered
                      ? 'Re-validate & Refresh'
                      : 'Validate & Add'}
                </button>
              </div>

              {validationById[model.id] && <ModelValidationReport result={validationById[model.id]} />}

              {isInspected && (
                <div className="catalog-model__details">
                  {model.description && <p className="catalog-model__description">{model.description}</p>}
                  <dl className="catalog-model__facts catalog-model__facts--wide">
                    <div>
                      <dt>Model ID</dt>
                      <dd>
                        <code>{model.id}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Per-request charge</dt>
                      <dd>
                        {model.requestPrice === null
                          ? 'Not published'
                          : model.requestPrice === 0
                            ? 'None'
                            : `$${model.requestPrice}`}
                      </dd>
                    </div>
                    <div>
                      <dt>Accepts</dt>
                      <dd>{model.capabilities.inputModalities?.join(', ') ?? 'Not published'}</dd>
                    </div>
                    <div>
                      <dt>Produces</dt>
                      <dd>{model.capabilities.outputModalities?.join(', ') ?? 'Not published'}</dd>
                    </div>
                    <div>
                      <dt>Max output</dt>
                      <dd>
                        {model.capabilities.maxCompletionTokens
                          ? `${model.capabilities.maxCompletionTokens.toLocaleString()} tokens`
                          : 'Not published'}
                      </dd>
                    </div>
                    <div>
                      <dt>Tokenizer</dt>
                      <dd>{model.capabilities.tokenizer ?? 'Not published'}</dd>
                    </div>
                    <div>
                      <dt>Moderated</dt>
                      <dd>
                        {model.capabilities.moderated === null || model.capabilities.moderated === undefined
                          ? 'Not published'
                          : model.capabilities.moderated
                            ? 'Yes'
                            : 'No'}
                      </dd>
                    </div>
                    <div>
                      <dt>Published</dt>
                      <dd>
                        {model.publishedAt ? new Date(model.publishedAt).toLocaleDateString() : 'Not published'}
                      </dd>
                    </div>
                  </dl>
                  {model.capabilities.supportedParameters?.length ? (
                    <p className="catalog-model__parameters">
                      <strong>Supported parameters:</strong> {model.capabilities.supportedParameters.join(', ')}
                    </p>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {result && result.matched > PAGE_SIZE && (
        <div className="model-discovery__pager">
          <button type="button" className="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            Previous
          </button>
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            className="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={page + 1 >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
