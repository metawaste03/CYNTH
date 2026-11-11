import { getDatabase } from '../../shared/database/index.js';
import type { AuthorSkillRow } from '../../shared/database/types.js';
import { slugify } from '../../shared/text/slug.js';
import type { AuthorSkillInput, AuthorSkillScope } from './authorSkills.validation.js';

/**
 * Author skills: long-form authoring documents, stored verbatim.
 *
 * The engine treats `body` as opaque. Nothing here parses the markdown,
 * summarises it, or extracts fields from it — Cynth stores what the Product
 * Owner wrote and hands the same text to the model. The only structure this
 * file imposes is the envelope around it: who it belongs to, whether it is
 * active, and what order several documents are assembled in.
 *
 * A skill is either scoped to one author or shared across all of them; see
 * schema.ts. Both kinds live in this table because they are the same object
 * doing the same job at two altitudes, and the prompt builder assembles them
 * in one pass.
 */

export interface AuthorSkillDto {
  id: number;
  /** Null when the document is unassigned, and always null when scope is 'shared'. */
  authorId: number | null;
  scope: AuthorSkillScope;
  name: string;
  slug: string;
  body: string;
  sourceFilename: string | null;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** List rows carry the size of the document rather than the document, so listing ten skills is not ten full personas. */
export interface AuthorSkillSummaryDto extends Omit<AuthorSkillDto, 'body'> {
  characterCount: number;
  wordCount: number;
  authorName: string | null;
  /** The thematic areas the assigned author covers — the answer to "which theme is this skill writing for". */
  themes: { id: number; name: string }[];
}

function readScope(raw: string): AuthorSkillScope {
  return raw === 'shared' ? 'shared' : 'author';
}

function mapSkill(row: AuthorSkillRow): AuthorSkillDto {
  return {
    id: row.id,
    authorId: row.author_id,
    scope: readScope(row.scope),
    name: row.name,
    slug: row.slug,
    body: row.body,
    sourceFilename: row.source_filename,
    position: row.position,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** The thematic areas an author covers, read through the existing author_themes link. */
function themesForAuthor(authorId: number | null): { id: number; name: string }[] {
  if (authorId === null) return [];
  const db = getDatabase();
  return db
    .prepare(
      `SELECT t.id, t.name FROM themes t
       JOIN author_themes at ON at.theme_id = t.id
       WHERE at.author_id = ? ORDER BY t.position, t.name`,
    )
    .all(authorId) as unknown as { id: number; name: string }[];
}

function toSummary(row: AuthorSkillRow, authorName: string | null): AuthorSkillSummaryDto {
  const { body, ...rest } = mapSkill(row);
  return {
    ...rest,
    characterCount: body.length,
    wordCount: countWords(body),
    authorName,
    themes: themesForAuthor(row.author_id),
  };
}

/**
 * Slugs are unique across skills, so a re-import updates the row it created
 * last time rather than accumulating copies. A numbered suffix only appears
 * when two genuinely different documents want the same name.
 */
function uniqueSlug(name: string, exceptId: number | null): string {
  const db = getDatabase();
  const base = slugify(name) || 'skill';

  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = db.prepare('SELECT id FROM author_skills WHERE slug = ?').get(candidate) as
      | { id: number }
      | undefined;
    if (!clash || clash.id === exceptId) return candidate;
  }
}

/** A shared skill belongs to everyone, so it can never also belong to one author. */
function authorIdForScope(scope: AuthorSkillScope, authorId: number | null | undefined): number | null | undefined {
  return scope === 'shared' ? null : authorId;
}

export interface AuthorSkillListFilters {
  authorId?: number;
  scope?: AuthorSkillScope;
  /** 'unassigned' lists author-scoped documents that have not been given an author yet. */
  assignment?: 'assigned' | 'unassigned';
  status?: 'active' | 'inactive';
  search?: string;
}

export function listSkills(filters: AuthorSkillListFilters = {}): AuthorSkillSummaryDto[] {
  const db = getDatabase();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.authorId !== undefined) {
    clauses.push('s.author_id = ?');
    params.push(filters.authorId);
  }
  if (filters.scope) {
    clauses.push('s.scope = ?');
    params.push(filters.scope);
  }
  if (filters.assignment === 'assigned') clauses.push("s.author_id IS NOT NULL");
  if (filters.assignment === 'unassigned') clauses.push("s.author_id IS NULL AND s.scope = 'author'");
  if (filters.status === 'active') clauses.push('s.is_active = 1');
  if (filters.status === 'inactive') clauses.push('s.is_active = 0');
  if (filters.search) {
    clauses.push('s.name LIKE ?');
    params.push(`%${filters.search}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT s.*, a.name AS author_name FROM author_skills s
       LEFT JOIN authors a ON a.id = s.author_id
       ${where} ORDER BY s.scope DESC, s.position, s.name`,
    )
    .all(...params) as unknown as (AuthorSkillRow & { author_name: string | null })[];

  return rows.map((row) => toSummary(row, row.author_name));
}

export function getSkillById(id: number): AuthorSkillDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM author_skills WHERE id = ?').get(id) as unknown as
    | AuthorSkillRow
    | undefined;
  return row ? mapSkill(row) : null;
}

export function getSkillBySourceFilename(filename: string): AuthorSkillDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM author_skills WHERE source_filename = ?').get(filename) as unknown as
    | AuthorSkillRow
    | undefined;
  return row ? mapSkill(row) : null;
}

/**
 * Every active shared document, in assembly order. These apply to every
 * author, so they are read once per generation regardless of who is writing.
 */
export function listActiveSharedSkills(): AuthorSkillDto[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM author_skills WHERE scope = 'shared' AND is_active = 1 ORDER BY position, id")
    .all() as unknown as AuthorSkillRow[];
  return rows.map(mapSkill);
}

/**
 * Every active document for one author, in assembly order.
 *
 * This and listActiveSharedSkills() are the generation path's only entry
 * points into this table. Inactive documents are invisible to both, so
 * deactivating a skill is how the user takes it out of generation without
 * deleting the work.
 */
export function listActiveSkillsForAuthor(authorId: number): AuthorSkillDto[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM author_skills WHERE author_id = ? AND scope = 'author' AND is_active = 1 ORDER BY position, id")
    .all(authorId) as unknown as AuthorSkillRow[];
  return rows.map(mapSkill);
}

function authorExists(authorId: number): boolean {
  const db = getDatabase();
  return Boolean(db.prepare('SELECT id FROM authors WHERE id = ?').get(authorId));
}

export function createSkill(input: AuthorSkillInput): AuthorSkillDto | { error: string } {
  const scope = input.scope ?? 'author';
  const authorId = authorIdForScope(scope, input.authorId) ?? null;

  if (authorId !== null && !authorExists(authorId)) return { error: 'Author not found.' };

  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO author_skills (author_id, scope, name, slug, body, source_filename, position, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      authorId,
      scope,
      input.name,
      uniqueSlug(input.name, null),
      input.body,
      input.sourceFilename ?? null,
      input.position ?? 0,
      input.isActive === false ? 0 : 1,
    );

  return getSkillById(Number(result.lastInsertRowid))!;
}

export function updateSkill(id: number, input: AuthorSkillInput): AuthorSkillDto | { error: string } | null {
  const existing = getSkillById(id);
  if (!existing) return null;

  const scope = input.scope ?? existing.scope;
  const requestedAuthorId = input.authorId === undefined ? existing.authorId : input.authorId;
  const authorId = authorIdForScope(scope, requestedAuthorId) ?? null;

  if (authorId !== null && !authorExists(authorId)) return { error: 'Author not found.' };

  const db = getDatabase();
  db.prepare(
    `UPDATE author_skills SET
       author_id = ?, scope = ?, name = ?, slug = ?, body = ?, source_filename = ?, position = ?, is_active = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    authorId,
    scope,
    input.name,
    // Renaming re-derives the slug; keeping the old one would leave a skill's
    // name and its identifier disagreeing after the first edit.
    input.name === existing.name ? existing.slug : uniqueSlug(input.name, id),
    input.body,
    input.sourceFilename === undefined ? existing.sourceFilename : input.sourceFilename,
    input.position ?? existing.position,
    input.isActive === undefined ? (existing.isActive ? 1 : 0) : input.isActive ? 1 : 0,
    id,
  );

  return getSkillById(id);
}

/**
 * Assignment is its own operation because it is the one the user performs
 * most: a document changing hands between authors, or a theme's author being
 * swapped. Assigning an author to a shared skill would contradict its scope,
 * so that is refused rather than silently narrowed.
 */
export function assignSkill(id: number, authorId: number | null): AuthorSkillDto | { error: string } | null {
  const existing = getSkillById(id);
  if (!existing) return null;
  if (existing.scope === 'shared' && authorId !== null) {
    return { error: 'A shared skill applies to every author and cannot be assigned to one. Change its scope first.' };
  }
  if (authorId !== null && !authorExists(authorId)) return { error: 'Author not found.' };

  const db = getDatabase();
  db.prepare(`UPDATE author_skills SET author_id = ?, updated_at = datetime('now') WHERE id = ?`).run(authorId, id);
  return getSkillById(id);
}

export function setSkillActiveStatus(id: number, isActive: boolean): AuthorSkillDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`UPDATE author_skills SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(isActive ? 1 : 0, id);
  return result.changes === 0 ? null : getSkillById(id);
}

export function deleteSkill(id: number): boolean {
  const db = getDatabase();
  return db.prepare('DELETE FROM author_skills WHERE id = ?').run(id).changes > 0;
}
