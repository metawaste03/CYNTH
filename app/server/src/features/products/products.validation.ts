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
  /** The thematic area this product belongs to (Milestone 18). Null clears it. */
  themeId?: number | null;
  /**
   * The editorial fields (Milestone 27).
   *
   * These were previously writable only by product research, which meant a
   * product added by hand reached the writer as a name and a brand — nothing
   * about what it is FOR. That is the exact input a model needs to place a
   * product where the prose is already about the problem it solves, and
   * without it a placement can only be decorative.
   *
   * A person can now supply them directly. Research still fills them when it
   * runs; whichever wrote them, the writer reads the same fields.
   */
  useCase?: string;
  problemSolved?: string;
  bestFor?: string;
  /** Free-form, one per line in the UI, stored as JSON. */
  keyFeatures?: string[];
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

  let themeId: number | null | undefined;
  if (input.themeId !== undefined) {
    if (input.themeId === null || input.themeId === '') {
      // An explicit clear. Distinguished from 'not supplied' so an edit form
      // can remove an association it did not have to resubmit.
      themeId = null;
    } else if (Number.isInteger(Number(input.themeId)) && Number(input.themeId) > 0) {
      themeId = Number(input.themeId);
    } else {
      errors.push('themeId must be a positive whole number, or null for no thematic area.');
    }
  }

  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') {
    errors.push('isActive must be true or false.');
  }

  for (const field of ['useCase', 'problemSolved', 'bestFor'] as const) {
    if (input[field] !== undefined && typeof input[field] !== 'string') {
      errors.push(`${field} must be text.`);
    }
  }
  if (input.keyFeatures !== undefined && !Array.isArray(input.keyFeatures)) {
    errors.push('keyFeatures must be a list of short strings.');
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
      themeId,
      // Editorial fields (Milestone 27). An empty string is kept rather than
      // collapsed to undefined, because clearing a field a person filled in is
      // a real intention and undefined means "leave what is stored alone".
      useCase: input.useCase === undefined ? undefined : String(input.useCase),
      problemSolved: input.problemSolved === undefined ? undefined : String(input.problemSolved),
      bestFor: input.bestFor === undefined ? undefined : String(input.bestFor),
      keyFeatures: Array.isArray(input.keyFeatures)
        ? (input.keyFeatures as unknown[])
            .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            .map((entry) => entry.trim().slice(0, 300))
            .slice(0, 25)
        : undefined,
    },
  };
}
