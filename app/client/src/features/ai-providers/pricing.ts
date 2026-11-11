import type { ModelCostClass } from '../../shared/types/aiProvider';

/**
 * Formatting for model prices, in one place so every screen states cost the
 * same way.
 *
 * Two rules run through all of it:
 *
 *   1. An unknown price is never shown as free, or as zero, or as a dash that
 *      could be read as either. It says "No pricing published", because that
 *      is what it is, and Cynth treats it as paid.
 *   2. Prices are shown per million tokens. Providers publish per-token
 *      figures like 0.000003, which are unreadable and invite
 *      order-of-magnitude mistakes when comparing two models.
 */

const PER_MILLION = 1_000_000;

/** A per-token price as a per-million-token figure. Null becomes an explicit statement, never a blank. */
export function formatPerMillion(pricePerToken: number | null): string {
  if (pricePerToken === null) return 'No pricing published';
  if (pricePerToken === 0) return 'Free';

  const perMillion = pricePerToken * PER_MILLION;
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/M`;
  if (perMillion < 1) return `$${perMillion.toFixed(3)}/M`;
  return `$${perMillion.toFixed(2)}/M`;
}

/** The short label for a cost class. "Unknown" is deliberately worded as a warning, not a neutral state. */
export function costClassLabel(costClass: ModelCostClass): string {
  if (costClass === 'free') return 'Free';
  if (costClass === 'paid') return 'Paid';
  return 'No pricing';
}

/** A one-line description of what a cost class means for the user's money. */
export function costClassDescription(costClass: ModelCostClass): string {
  if (costClass === 'free') return 'The provider prices this model at zero. Generating with it should not cost anything.';
  if (costClass === 'paid') return 'This model costs money. Cynth will ask you to confirm before spending anything.';
  return 'The provider publishes no price for this model, so Cynth cannot tell you what it costs and treats it as paid.';
}

/** An estimated total cost. Never shown when pricing is unknown — an invented figure is worse than none. */
export function formatCost(value: number | null): string | null {
  if (value === null) return null;
  if (value === 0) return '$0.00';
  if (value < 0.01) return 'less than $0.01';
  return `$${value.toFixed(2)}`;
}
