/**
 * Field-presence validation only, matching authors.validation.ts.
 *
 * Deliberately says nothing about the shape of the markdown: there is no
 * required heading, no required section, and no schema the document must
 * conform to. A skill is whatever the Product Owner wrote. The only checks
 * here are the ones the database needs — a name, a non-empty body, and a
 * plausible author id.
 */

/** 'author' — belongs to one author. 'shared' — applies to every author. */
export type AuthorSkillScope = 'author' | 'shared';

export const AUTHOR_SKILL_SCOPES: AuthorSkillScope[] = ['author', 'shared'];

export interface AuthorSkillInput {
  name: string;
  body: string;
  scope?: AuthorSkillScope;
  /** null explicitly unassigns; undefined leaves the current assignment alone. */
  authorId?: number | null;
  sourceFilename?: string | null;
  position?: number;
  isActive?: boolean;
}

interface ValidationResult<T> {
  errors: string[];
  value?: T;
}

/** 1 MB. Far above any real persona document, and low enough that a mis-selected file is refused rather than stored. */
const MAX_BODY_CHARACTERS = 1_000_000;

export function validateAuthorSkillInput(body: unknown): ValidationResult<AuthorSkillInput> {
  const errors: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { errors: ['Request body must be an object.'] };
  }
  const input = body as Record<string, unknown>;

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.push('Name is required.');
  if (name.length > 200) errors.push('Name must be 200 characters or fewer.');

  const skillBody = typeof input.body === 'string' ? input.body : '';
  if (!skillBody.trim()) errors.push('Skill content is required.');
  if (skillBody.length > MAX_BODY_CHARACTERS) {
    errors.push('Skill content is too large — a skill document must be under 1,000,000 characters.');
  }

  let scope: AuthorSkillScope | undefined;
  if (input.scope !== undefined) {
    if (AUTHOR_SKILL_SCOPES.includes(input.scope as AuthorSkillScope)) {
      scope = input.scope as AuthorSkillScope;
    } else {
      errors.push(`scope must be one of: ${AUTHOR_SKILL_SCOPES.join(', ')}.`);
    }
  }

  let authorId: number | null | undefined;
  if (input.authorId !== undefined) {
    if (input.authorId === null) {
      authorId = null;
    } else if (Number.isInteger(input.authorId) && (input.authorId as number) > 0) {
      authorId = input.authorId as number;
    } else {
      errors.push('authorId must be a positive whole number, or null to leave the skill unassigned.');
    }
  }

  if (input.position !== undefined && !Number.isInteger(input.position)) {
    errors.push('position must be a whole number.');
  }
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') {
    errors.push('isActive must be true or false.');
  }
  if (
    input.sourceFilename !== undefined &&
    input.sourceFilename !== null &&
    typeof input.sourceFilename !== 'string'
  ) {
    errors.push('sourceFilename must be text.');
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    value: {
      name,
      // Not trimmed: the document is stored exactly as supplied.
      body: skillBody,
      scope,
      authorId,
      sourceFilename: (input.sourceFilename as string | null | undefined) ?? undefined,
      position: input.position as number | undefined,
      isActive: input.isActive as boolean | undefined,
    },
  };
}
