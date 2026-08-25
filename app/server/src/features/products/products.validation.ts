/** Field-presence validation only — no AI summaries, no scraping. */

export interface ProductInput {
  title: string;
  brand?: string;
  category?: string;
  shortDescription?: string;
  description?: string;
  affiliateLink?: string;
  editorialFit?: string;
  notes?: string;
  isActive?: boolean;
}

interface ValidationResult<T> {
  errors: string[];
  value?: T;
}

const OPTIONAL_STRING_FIELDS = [
  'brand',
  'category',
  'shortDescription',
  'description',
  'affiliateLink',
  'editorialFit',
  'notes',
] as const;

export function validateProductInput(body: unknown): ValidationResult<ProductInput> {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { errors: ['Request body must be an object.'] };
  }
  const input = body as Record<string, unknown>;

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) errors.push('Product title is required.');
  if (title.length > 200) errors.push('Product title must be 200 characters or fewer.');

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (input[field] !== undefined && input[field] !== null && typeof input[field] !== 'string') {
      errors.push(`${field} must be text.`);
    }
  }

  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') {
    errors.push('isActive must be true or false.');
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    value: {
      title,
      brand: (input.brand as string | undefined)?.trim() || undefined,
      category: (input.category as string | undefined)?.trim() || undefined,
      shortDescription: (input.shortDescription as string | undefined) || undefined,
      description: (input.description as string | undefined) || undefined,
      affiliateLink: (input.affiliateLink as string | undefined)?.trim() || undefined,
      editorialFit: (input.editorialFit as string | undefined) || undefined,
      notes: (input.notes as string | undefined) || undefined,
      isActive: input.isActive as boolean | undefined,
    },
  };
}
