import type { CapabilityMeta, ModelPurpose } from '../../shared/types/aiProvider';
import { purposeLabel } from './purposeLabels';

/**
 * CAPABILITY PICKER (Milestone 15).
 *
 * A model is Provider → Model → Capability, and a model may hold SEVERAL
 * capabilities — so this is a checkbox group, not a dropdown. The dropdown it
 * replaces forced one purpose per model, which meant registering the same
 * model twice to use it for two jobs.
 *
 * Capabilities that no Cynth workflow routes to yet are still offered, and
 * are labelled as such rather than hidden. Hiding them would make the
 * registry look narrower than it is; presenting them without the caveat would
 * imply a pipeline that does not exist.
 */
export function CapabilityPicker({
  capabilities,
  selected,
  onChange,
  disabled,
  idPrefix,
}: {
  capabilities: CapabilityMeta[];
  selected: ModelPurpose[];
  onChange: (next: ModelPurpose[]) => void;
  disabled?: boolean;
  /** Keeps input ids unique when more than one picker is on the page. */
  idPrefix: string;
}) {
  function toggle(purpose: ModelPurpose, checked: boolean) {
    onChange(checked ? [...selected, purpose] : selected.filter((value) => value !== purpose));
  }

  return (
    <fieldset className="capability-picker">
      <legend className="capability-picker__legend">
        Capabilities
        <span className="capability-picker__hint">
          What this model may be used for. A model can hold more than one — the best article writer is not
          automatically the best SEO reviewer.
        </span>
      </legend>

      <div className="capability-picker__options">
        {capabilities.map((capability) => (
          <label
            key={capability.value}
            className="capability-picker__option"
            htmlFor={`${idPrefix}-${capability.value}`}
          >
            <input
              id={`${idPrefix}-${capability.value}`}
              type="checkbox"
              checked={selected.includes(capability.value)}
              disabled={disabled}
              onChange={(event) => toggle(capability.value, event.target.checked)}
            />
            <span className="capability-picker__text">
              <span className="capability-picker__name">
                {capability.label || purposeLabel(capability.value)}
                {!capability.implemented && <span className="capability-picker__badge">Not yet routed</span>}
              </span>
              <span className="capability-picker__description">{capability.description}</span>
            </span>
          </label>
        ))}
      </div>

      {selected.length === 0 && (
        <p className="capability-picker__empty">
          No capability selected. The model will be registered but will not appear in any workflow&rsquo;s model
          picker.
        </p>
      )}
    </fieldset>
  );
}
