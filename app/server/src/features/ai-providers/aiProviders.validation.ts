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
  purpose: string | null;
  isEnabled: boolean;
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

  let purpose: string | null = null;
  if (input.purpose !== undefined && input.purpose !== null && input.purpose !== '') {
    if (!isValidPurpose(input.purpose)) {
      errors.push('purpose must be one of the built-in model purposes.');
    } else {
      purpose = input.purpose;
    }
  }

  if (input.isEnabled !== undefined && typeof input.isEnabled !== 'boolean') {
    errors.push('isEnabled must be true or false.');
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    value: {
      modelName,
      displayName: (input.displayName as string | undefined)?.trim() || null,
      purpose,
      isEnabled: input.isEnabled === undefined ? true : (input.isEnabled as boolean),
    },
  };
}
