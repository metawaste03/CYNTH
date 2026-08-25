/**
 * Milestone 6: the full Content Brief workflow — article type, author,
 * topic, working title, keywords, product, and the content brief fields.
 * Still no title/content *generation*, no AI, no publishing — this is
 * storage + validation for what the wizard collects.
 */

export interface ArticleDraftInput {
  articleTypeId: number;
  authorId: number | null;
  productId: number | null;
  topic: string | null;
  title: string | null;
  targetAudience: string | null;
  searchIntent: string | null;
  readerPainPoints: string | null;
  questionsToAnswer: string | null;
  importantTopics: string | null;
  notes: string | null;
  primaryKeyword: string | null;
  secondaryKeywords: string | null;
}

interface ValidationResult<T> {
  errors: string[];
  value?: T;
}

const OPTIONAL_STRING_FIELDS = [
  'topic',
  'title',
  'targetAudience',
  'searchIntent',
  'readerPainPoints',
  'questionsToAnswer',
  'importantTopics',
  'notes',
  'primaryKeyword',
  'secondaryKeywords',
] as const;

function optionalPositiveId(value: unknown, label: string, errors: string[]): number | null {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    errors.push(`${label} must be a valid id.`);
    return null;
  }
  return id;
}

export function validateArticleDraftInput(body: unknown): ValidationResult<ArticleDraftInput> {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { errors: ['Request body must be an object.'] };
  }
  const input = body as Record<string, unknown>;

  const articleTypeId = Number(input.articleTypeId);
  if (!Number.isInteger(articleTypeId) || articleTypeId <= 0) {
    errors.push('An article type must be selected.');
  }

  const authorId = optionalPositiveId(input.authorId, 'authorId', errors);
  const productId = optionalPositiveId(input.productId, 'productId', errors);

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (input[field] !== undefined && input[field] !== null && typeof input[field] !== 'string') {
      errors.push(`${field} must be text.`);
    }
  }

  if (errors.length) return { errors };

  const asString = (field: (typeof OPTIONAL_STRING_FIELDS)[number]): string | null =>
    typeof input[field] === 'string' && input[field] !== '' ? (input[field] as string) : null;

  return {
    errors: [],
    value: {
      articleTypeId,
      authorId,
      productId,
      topic: asString('topic'),
      title: asString('title'),
      targetAudience: asString('targetAudience'),
      searchIntent: asString('searchIntent'),
      readerPainPoints: asString('readerPainPoints'),
      questionsToAnswer: asString('questionsToAnswer'),
      importantTopics: asString('importantTopics'),
      notes: asString('notes'),
      primaryKeyword: asString('primaryKeyword'),
      secondaryKeywords: asString('secondaryKeywords'),
    },
  };
}
