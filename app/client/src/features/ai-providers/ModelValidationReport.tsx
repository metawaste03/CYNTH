import type { ModelValidationResult, ValidationStage } from '../../shared/types/aiProvider';

/**
 * VALIDATION REPORT (Milestone 15).
 *
 * Shows what each stage of validation established, in the order it ran.
 *
 * This exists because of a specific failure: a provider configured with a
 * website URL instead of an API endpoint produced only
 *
 *     "The provider returned a response Cynth could not read."
 *
 * which is true and unactionable. A per-stage report cannot produce that
 * outcome — whichever stage fails is named, so the reader sees that the
 * configuration was fine, the key was fine, and the ENDPOINT was the problem.
 */

const STAGE_LABELS: Record<ValidationStage, string> = {
  configuration: 'Configuration',
  endpoint: 'Endpoint',
  credential: 'Credential',
  catalog: 'Provider catalogue',
  live_probe: 'Live request',
  normalisation: 'Response format',
};

/** Formats a probe cost. Sub-cent amounts are the norm, so the usual two decimals would read as $0.00. */
function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return 'not published by the provider';
  if (cost === 0) return 'nothing — this model is free';
  if (cost < 0.01) return `about $${cost.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `about $${cost.toFixed(4)}`;
}

export function ModelValidationReport({ result }: { result: ModelValidationResult }) {
  return (
    <div className={`validation-report validation-report--${result.ok ? 'ok' : 'failed'}`}>
      <p className="validation-report__verdict">
        <strong>{result.ok ? 'Validated' : 'Not valid'}</strong>
        {!result.ok && result.failedStage && (
          <span className="validation-report__stage-tag"> — failed at {STAGE_LABELS[result.failedStage]}</span>
        )}
      </p>
      <p className="validation-report__message">{result.message}</p>

      <ol className="validation-report__stages">
        {result.stages.map((stage) => (
          <li
            key={stage.stage}
            className={`validation-report__stage validation-report__stage--${
              stage.skipped ? 'skipped' : stage.ok ? 'passed' : 'failed'
            }`}
          >
            <span className="validation-report__stage-name">
              {STAGE_LABELS[stage.stage]}
              <span className="validation-report__stage-outcome">
                {stage.skipped ? 'Skipped' : stage.ok ? 'Passed' : 'Failed'}
              </span>
            </span>
            <span className="validation-report__stage-detail">{stage.detail}</span>
          </li>
        ))}
      </ol>

      {result.probe ? (
        <p className="validation-report__probe">
          A minimal request was sent and answered in {result.probe.durationMs} ms
          {result.probe.promptTokens !== null && result.probe.completionTokens !== null
            ? ` (${result.probe.promptTokens} prompt / ${result.probe.completionTokens} completion tokens)`
            : ''}
          . No article was created — the response was discarded.
        </p>
      ) : (
        <p className="validation-report__probe">
          No request was sent to the model, so nothing was charged. One live request would cost{' '}
          {formatCost(result.estimatedProbeCost)}.
        </p>
      )}
    </div>
  );
}
