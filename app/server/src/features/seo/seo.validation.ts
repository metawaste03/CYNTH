import { isValidSearchIntent, SEARCH_INTENTS } from './seo.constants.js';
import type { SeoConfigurationInput, SeoMetadataInput } from './seo.repository.js';
import type { SeoGateCriteria } from './seo.types.js';
import { META_DESCRIPTION_MAX_CHARS } from './seo.constants.js';

/**
 * Input validation for the SEO feature.
 *
 * Two principles, both matching the rest of Cynth:
 *
 *   - Absent is a valid answer. Every SEO configuration field is optional,
 *     because an article without a target query or without a geographic
 *     target is a normal article, not an incomplete one.
 *   - Empty string means "clear it", and becomes null. There is no field
 *     where '' is meaningfully different from unset.
 */

export interface ValidationResult<T> {
  errors: string[];
  value: T | null;
}

/** Trimmed string, or null when the caller sent nothing meaningful. */
function optionalText(value: unknown, label: string, maxLength: number, errors: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    errors.push(`${label} must be text.`);
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    errors.push(`${label} must be ${maxLength} characters or fewer.`);
    return null;
  }
  return trimmed;
}

/** Accepts either an array of strings or a comma-separated string, since both are natural from a form. */
function optionalList(value: unknown, label: string, errors: string[]): string[] {
  if (value === undefined || value === null) return [];

  if (Array.isArray(value)) {
    const entries = value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim());
    return entries.filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  errors.push(`${label} must be a list of terms.`);
  return [];
}

export function validateSeoConfiguration(body: unknown): ValidationResult<SeoConfigurationInput> {
  const errors: string[] = [];
  const input = (body ?? {}) as Record<string, unknown>;

  const searchIntentRaw = input.searchIntent;
  let searchIntent: SeoConfigurationInput['searchIntent'] = null;
  if (searchIntentRaw !== undefined && searchIntentRaw !== null && searchIntentRaw !== '') {
    if (!isValidSearchIntent(searchIntentRaw)) {
      errors.push(`searchIntent must be one of: ${SEARCH_INTENTS.join(', ')}.`);
    } else {
      searchIntent = searchIntentRaw;
    }
  }

  const secondaryIntents = optionalList(input.secondaryIntents, 'secondaryIntents', errors);
  for (const intent of secondaryIntents) {
    if (!isValidSearchIntent(intent)) {
      errors.push(`secondaryIntents contains an unknown intent: ${intent}.`);
    }
  }

  const value: SeoConfigurationInput = {
    targetQuery: optionalText(input.targetQuery, 'targetQuery', 200, errors),
    searchIntent,
    secondaryIntents,
    secondaryKeywords: optionalList(input.secondaryKeywords, 'secondaryKeywords', errors),
    semanticTopics: optionalList(input.semanticTopics, 'semanticTopics', errors),
    targetAudience: optionalText(input.targetAudience, 'targetAudience', 500, errors),
    geoTarget: optionalText(input.geoTarget, 'geoTarget', 200, errors),
    seoObjectives: optionalText(input.seoObjectives, 'seoObjectives', 2000, errors),
    notes: optionalText(input.notes, 'notes', 4000, errors),
  };

  return { errors, value: errors.length ? null : value };
}

export function validateSeoMetadata(body: unknown): ValidationResult<SeoMetadataInput> {
  const errors: string[] = [];
  const input = (body ?? {}) as Record<string, unknown>;

  const canonicalUrl = optionalText(input.canonicalUrl, 'canonicalUrl', 2000, errors);
  if (canonicalUrl && !/^https?:\/\/\S+$/i.test(canonicalUrl)) {
    errors.push('canonicalUrl must be an absolute http(s) URL.');
  }

  const seoSlug = optionalText(input.seoSlug, 'seoSlug', 200, errors);
  if (seoSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(seoSlug)) {
    errors.push('seoSlug must be lowercase words separated by hyphens.');
  }

  // Length is validated generously here and reported precisely by the
  // analysis: an over-long description is a finding to review, not an input
  // the API should refuse outright.
  const metaDescription = optionalText(input.metaDescription, 'metaDescription', META_DESCRIPTION_MAX_CHARS * 3, errors);

  let structuredData: Record<string, unknown> | null = null;
  if (input.structuredData !== undefined && input.structuredData !== null) {
    if (typeof input.structuredData !== 'object' || Array.isArray(input.structuredData)) {
      errors.push('structuredData must be an object.');
    } else {
      structuredData = input.structuredData as Record<string, unknown>;
    }
  }

  const value: SeoMetadataInput = {
    seoTitle: optionalText(input.seoTitle, 'seoTitle', 300, errors),
    metaDescription,
    seoSlug,
    canonicalUrl,
    structuredDataTypes: optionalList(input.structuredDataTypes, 'structuredDataTypes', errors),
    structuredData,
  };

  return { errors, value: errors.length ? null : value };
}

export function validateGateCriteria(body: unknown): ValidationResult<Partial<SeoGateCriteria>> {
  const errors: string[] = [];
  const input = (body ?? {}) as Record<string, unknown>;
  const value: Partial<SeoGateCriteria> = {};

  const booleanKeys: (keyof SeoGateCriteria)[] = [
    'enforceBeforePush',
    'requireAnalysis',
    'requireAiAnalysis',
    'blockOnBlocking',
    'requireSeoTitle',
    'requireMetaDescription',
    'requireTargetQuery',
    'requireCurrentAnalysis',
  ];

  for (const key of booleanKeys) {
    const raw = input[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'boolean') {
      errors.push(`${key} must be true or false.`);
      continue;
    }
    (value as Record<string, unknown>)[key] = raw;
  }

  for (const key of ['maxWarnings', 'minScore'] as const) {
    const raw = input[key];
    if (raw === undefined) continue;
    if (raw === null) {
      value[key] = null;
      continue;
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0) {
      errors.push(`${key} must be a non-negative number, or null for no limit.`);
      continue;
    }
    if (key === 'minScore' && numeric > 100) {
      errors.push('minScore must be between 0 and 100.');
      continue;
    }
    value[key] = numeric;
  }

  return { errors, value: errors.length ? null : value };
}
