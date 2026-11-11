/**
 * Field-presence validation only — no AI analysis, no writing-style
 * extraction. Just makes sure the shapes CRUD needs are actually there.
 */

export interface WritingSampleInput {
  title: string;
  notes?: string;
  fullText?: string;
}

export interface AuthorInput {
  name: string;
  category?: string;
  shortBiography?: string;
  philosophy?: string;
  writingStyle?: string;
  tone?: string;
  targetAudience?: string;
  preferredExpressions?: string;
  prohibitedExpressions?: string;
  writingNotes?: string;
  expertise?: string;
  perspective?: string;
  editorialPrinciples?: string;
  boundaries?: string;
  isActive?: boolean;
  writingSamples?: WritingSampleInput[];
}

interface ValidationResult<T> {
  errors: string[];
  value?: T;
}

const OPTIONAL_STRING_FIELDS = [
  'category',
  'shortBiography',
  'philosophy',
  'writingStyle',
  'tone',
  'targetAudience',
  'preferredExpressions',
  'prohibitedExpressions',
  'writingNotes',
  'expertise',
  'perspective',
  'editorialPrinciples',
  'boundaries',
] as const;

export function validateAuthorInput(body: unknown): ValidationResult<AuthorInput> {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { errors: ['Request body must be an object.'] };
  }
  const input = body as Record<string, unknown>;

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.push('Name is required.');
  if (name.length > 200) errors.push('Name must be 200 characters or fewer.');

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (input[field] !== undefined && input[field] !== null && typeof input[field] !== 'string') {
      errors.push(`${field} must be text.`);
    }
  }

  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') {
    errors.push('isActive must be true or false.');
  }

  const writingSamples: WritingSampleInput[] = [];
  if (input.writingSamples !== undefined) {
    if (!Array.isArray(input.writingSamples)) {
      errors.push('writingSamples must be a list.');
    } else {
      input.writingSamples.forEach((sample, index) => {
        const result = validateSampleInput(sample, index + 1);
        errors.push(...result.errors);
        if (result.value) writingSamples.push(result.value);
      });
    }
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    value: {
      name,
      category: (input.category as string | undefined)?.trim() || undefined,
      shortBiography: (input.shortBiography as string | undefined) || undefined,
      philosophy: (input.philosophy as string | undefined) || undefined,
      writingStyle: (input.writingStyle as string | undefined) || undefined,
      tone: (input.tone as string | undefined) || undefined,
      targetAudience: (input.targetAudience as string | undefined) || undefined,
      preferredExpressions: (input.preferredExpressions as string | undefined) || undefined,
      prohibitedExpressions: (input.prohibitedExpressions as string | undefined) || undefined,
      writingNotes: (input.writingNotes as string | undefined) || undefined,
      isActive: input.isActive as boolean | undefined,
      writingSamples: writingSamples.length ? writingSamples : undefined,
    },
  };
}

export function validateSampleInput(body: unknown, position?: number): ValidationResult<WritingSampleInput> {
  const errors: string[] = [];
  const label = position ? `Writing sample ${position}` : 'Writing sample';

  if (typeof body !== 'object' || body === null) {
    return { errors: [`${label}: request body must be an object.`] };
  }
  const input = body as Record<string, unknown>;

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) errors.push(`${label}: title is required.`);

  const fullText = typeof input.fullText === 'string' ? input.fullText : '';
  if (!fullText.trim()) errors.push(`${label}: full text is required.`);

  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') {
    errors.push(`${label}: notes must be text.`);
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    value: {
      title,
      notes: (input.notes as string | undefined) || undefined,
      fullText,
    },
  };
}
