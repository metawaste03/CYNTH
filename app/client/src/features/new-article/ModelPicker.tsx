import { useMemo } from 'react';
import { costClassLabel, formatPerMillion } from '../ai-providers/pricing';
import type { SelectableModel } from '../../shared/types/aiProvider';
import './ModelPicker.css';

/**
 * MODEL SELECTION for generation (Milestone 13, Part 5).
 *
 * Lets the user choose which model writes the article, and makes the
 * financial consequence of that choice impossible to miss: every option
 * carries its provider and its price, and the selected model's cost is spelled
 * out beneath the picker rather than hidden behind a tooltip.
 *
 * The picker names a registry entry and nothing more. It never names a
 * provider endpoint or a credential — the Model Router still resolves the
 * choice server-side, and a model that cannot run produces an error rather
 * than a silent substitution.
 */

interface ModelPickerProps {
  models: SelectableModel[];
  /** The chosen registry entry id, or null to use the configured default for this task. */
  value: number | null;
  onChange: (modelId: number | null) => void;
  disabled?: boolean;
  /** The model the configured default resolves to, so "Default" can name it. */
  defaultModelLabel: string | null;
}

/** Free first, then cheapest paid, then anything unpriced. The order the user's wallet cares about. */
function sortForChoice(models: SelectableModel[]): SelectableModel[] {
  const rank = (model: SelectableModel) => (model.costClass === 'free' ? 0 : model.costClass === 'paid' ? 1 : 2);
  return [...models].sort((a, b) => {
    const byClass = rank(a) - rank(b);
    if (byClass !== 0) return byClass;

    const priceA = (a.promptPrice ?? 0) + (a.completionPrice ?? 0);
    const priceB = (b.promptPrice ?? 0) + (b.completionPrice ?? 0);
    if (priceA !== priceB) return priceA - priceB;

    return (a.displayName || a.modelName).localeCompare(b.displayName || b.modelName);
  });
}

function optionLabel(model: SelectableModel): string {
  const name = model.displayName || model.modelName;
  const price =
    model.costClass === 'free'
      ? 'Free'
      : model.costClass === 'unknown'
        ? 'no pricing published'
        : `${formatPerMillion(model.promptPrice)} in / ${formatPerMillion(model.completionPrice)} out`;

  return `${name} — ${model.providerName} — ${price}`;
}

export function ModelPicker({ models, value, onChange, disabled, defaultModelLabel }: ModelPickerProps) {
  const sorted = useMemo(() => sortForChoice(models), [models]);
  const selected = value === null ? null : (models.find((model) => model.modelId === value) ?? null);

  const groups = useMemo(
    () => ({
      free: sorted.filter((model) => model.costClass === 'free'),
      paid: sorted.filter((model) => model.costClass === 'paid'),
      unknown: sorted.filter((model) => model.costClass === 'unknown'),
    }),
    [sorted],
  );

  if (models.length === 0) {
    return (
      <p className="model-picker__empty">
        No models are available to choose from. Add one in Settings → AI Providers, using Discover Models.
      </p>
    );
  }

  return (
    <div className="model-picker">
      <label className="model-picker__field">
        <span className="model-picker__label">Model</span>
        <select
          value={value === null ? '' : String(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
        >
          <option value="">
            {defaultModelLabel
              ? `Configured default — ${defaultModelLabel}`
              : 'Configured default for Article Generation'}
          </option>

          {/* Grouped by what they cost, because that is the distinction that
              matters most when picking one. */}
          {groups.free.length > 0 && (
            <optgroup label="Free">
              {groups.free.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {optionLabel(model)}
                </option>
              ))}
            </optgroup>
          )}
          {groups.paid.length > 0 && (
            <optgroup label="Paid">
              {groups.paid.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {optionLabel(model)}
                </option>
              ))}
            </optgroup>
          )}
          {groups.unknown.length > 0 && (
            <optgroup label="No pricing published — treated as paid">
              {groups.unknown.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {optionLabel(model)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      {selected && (
        <dl className={`model-picker__summary is-${selected.costClass}`}>
          <div>
            <dt>Model</dt>
            <dd>{selected.displayName || selected.modelName}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>
              {selected.providerName}
              {selected.vendor && selected.vendor !== selected.providerName ? ` · ${selected.vendor}` : ''}
            </dd>
          </div>
          <div>
            <dt>Pricing</dt>
            <dd>
              <span className={`cost-badge is-${selected.costClass}`}>{costClassLabel(selected.costClass)}</span>
              {selected.costClass === 'paid' && (
                <span className="model-picker__prices">
                  {formatPerMillion(selected.promptPrice)} input · {formatPerMillion(selected.completionPrice)} output
                </span>
              )}
            </dd>
          </div>
          {!selected.hasApiKey && (
            <div className="model-picker__problem">
              <dt>Problem</dt>
              <dd>No API key is stored for {selected.providerName}, so this model cannot run.</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
