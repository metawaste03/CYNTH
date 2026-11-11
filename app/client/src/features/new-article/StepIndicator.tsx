export const STEP_LABELS = [
  'Article Type',
  'Theme & Author',
  'Topic',
  'Title',
  'Keywords',
  'Product',
  'Content Brief',
  'Editorial Review',
];

export function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <ol className="step-indicator" aria-label="Progress">
      {STEP_LABELS.map((label, index) => {
        const stepNumber = index + 1;
        const state = stepNumber === currentStep ? 'current' : stepNumber < currentStep ? 'done' : 'upcoming';
        return (
          <li key={label} className={`step-indicator__item is-${state}`} aria-current={stepNumber === currentStep ? 'step' : undefined}>
            <span className="step-indicator__number">{stepNumber}</span>
            <span className="step-indicator__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
