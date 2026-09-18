import { isValidPurpose } from './aiProviders.constants.js';

export interface ProviderInput {
  name: string;
  providerType: string;
  description: string | null;
  baseUrl: string | null;
  defaultModel: string | null;
  /** undefined = leave the stored secret untouched; '' = clear it; any other string = set/rotate it. Never read back from the API. */
  apiKey: string | undefined;
}

export interface ModelInput {
  modelName: string;
  displayName: string | null;
  /** The jobs this model is registered for. May be empty; may hold several. */
  purposes: string[];
  isEnabled: boolean;
}

/**
 * Reads the capability set off a request.
 *
 * Accepts `purposes: string[]` (Milestone 15) and, so an older client keeps
 * working, a single `purpose: string`. Every value is checked against the
 * built-in list — an unknown capability is refused rather than stored,
 * because a capability nothing routes to is worse than none.
 */
function readPurposes(input: Record<string, unknown>, errors: string[]): string[] {
  const raw: unknown[] = Array.isArray(input.purposes)
    ? input.purposes
    : input.purpose !== undefined && input.purpose !== null && input.purpose !== ''
      ? [input.purpose]
      : [];

  const purposes: string[] = [];
  for (const value of raw) {
    if (!isValidPurpose(value)) {
      errors.push(`"${String(value)}" is not one of Cynth's model capabilities.`);
      continue;
    }
    if (!purposes.includes(value)) purposes.push(value);
  }
  return purposes;
}

interface ValidationResult<T> {
  errors: string[];
  value?: T;
}

export function validateProviderInput(body: unknown): ValidationResult<ProviderInput> {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { errors: ['Request body must be an object.'] };
  }
  const input = body as Record<string, unknown>;

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.push('Provider Name is required.');

  const providerType = typeof input.providerType === 'string' ? input.providerType.trim() : '';
  if (!providerType) errors.push('Provider type is required.');

  for (const field of ['description', 'baseUrl', 'defaultModel'] as const) {
    if (input[field] !== undefined && input[field] !== null && typeof input[field] !== 'string') {
      errors.push(`${field} must be text.`);
    }
  }

  if (input.apiKey !== undefined && typeof input.apiKey !== 'string') {
    errors.push('apiKey must be text.');
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    value: {
      name,
      providerType,
      description: (input.description as string | undefined)?.trim() || null,
      baseUrl: (input.baseUrl as string | undefined)?.trim() || null,
      defaultModel: (input.defaultModel as string | undefined)?.trim() || null,
      apiKey: input.apiKey as string | undefined,
    },
  };
}

export function validateModelInput(body: unknown): ValidationResult<ModelInput> {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { errors: ['Request body must be an object.'] };
  }
  const input = body as Record<string, unknown>;

  const modelName = typeof input.modelName === 'string' ? input.modelName.trim() : '';
  if (!modelName) errors.push('Model Name is required.');

  if (input.displayName !== undefined && input.displayName !== null && typeof input.displayName !== 'string') {
    errors.push('displayName must be text.');
  }

  const purposes = readPurposes(input, errors);

  if (input.isEnabled !== undefined && typeof input.isEnabled !== 'boolean') {
    errors.push('isEnabled must be true or false.');
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    value: {
      modelName,
      displayName: (input.displayName as string | undefined)?.trim() || null,
      purposes,
      isEnabled: input.isEnabled === undefined ? true : (input.isEnabled as boolean),
    },
  };
}

export interface CatalogModelInput {
  /** The model id exactly as the provider's catalogue publishes it. */
  modelName: string;
  displayName: string | null;
  purposes: string[];
  isEnabled: boolean;
  /**
   * Permission to send one minimal, real request to the model as part of
   * validating it. Required before a PAID model is ever contacted — see
   * modelValidation.service.ts. Free models validate live without it.
   */
  confirmLiveTest: boolean;
}

/**
 * Validates a request to save a catalogue model into the registry.
 *
 * Note what is deliberately NOT accepted: any pricing or capability field.
 * The client names a model; the server reads what that model costs from the
 * provider's own catalogue. Letting a request assert its own prices would
 * make the entire cost-safety layer bypassable from the browser.
 */
export function validateCatalogModelInput(body: unknown): ValidationResult<CatalogModelInput> {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { errors: ['Request body must be an object.'] };
  }
  const input = body as Record<string, unknown>;

  const modelName = typeof input.modelName === 'string' ? input.modelName.trim() : '';
  if (!modelName) errors.push('modelName is required.');

  if (input.displayName !== undefined && input.displayName !== null && typeof input.displayName !== 'string') {
    errors.push('displayName must be text.');
  }

  const purposes = readPurposes(input, errors);

  if (input.isEnabled !== undefined && typeof input.isEnabled !== 'boolean') {
    errors.push('isEnabled must be true or false.');
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    value: {
      modelName,
      displayName: (input.displayName as string | undefined)?.trim() || null,
      purposes,
      isEnabled: input.isEnabled === undefined ? true : (input.isEnabled as boolean),
      // Defaults to false: permission to spend must be given, never assumed.
      confirmLiveTest: input.confirmLiveTest === true,
    },
  };
}
