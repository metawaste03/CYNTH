import { getDatabase } from '../../shared/database/index.js';
import type { AuthorRow, AuthorWritingSampleRow } from '../../shared/database/types.js';
import type { AuthorInput, WritingSampleInput } from './authors.validation.js';

export interface AuthorListFilters {
  search?: string;
  category?: string;
  status?: 'active' | 'inactive';
}

export interface WritingSampleDto {
  id: number;
  title: string;
  notes: string | null;
  fullText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorDto {
  id: number;
  name: string;
  category: string | null;
  shortBiography: string | null;
  philosophy: string | null;
  writingStyle: string | null;
  tone: string | null;
  targetAudience: string | null;
  preferredExpressions: string | null;
  prohibitedExpressions: string | null;
  writingNotes: string | null;
  /** Author persona (Milestone 11). Supplied by the user — Cynth never invents editorial identity. */
  expertise: string | null;
  perspective: string | null;
  editorialPrinciples: string | null;
  boundaries: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorDetailDto extends AuthorDto {
  writingSamples: WritingSampleDto[];
}

function mapAuthor(row: AuthorRow): AuthorDto {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    shortBiography: row.short_biography,
    philosophy: row.philosophy,
    writingStyle: row.writing_style,
    tone: row.tone,
    targetAudience: row.target_audience,
    preferredExpressions: row.preferred_expressions,
    prohibitedExpressions: row.prohibited_expressions,
    writingNotes: row.writing_notes,
    expertise: row.expertise,
    perspective: row.perspective,
    editorialPrinciples: row.editorial_principles,
    boundaries: row.boundaries,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSample(row: AuthorWritingSampleRow): WritingSampleDto {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    fullText: row.full_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAuthors(filters: AuthorListFilters): AuthorDto[] {
  const db = getDatabase();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.search) {
    clauses.push('(name LIKE ? OR category LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like);
  }
  if (filters.category) {
    clauses.push('category = ?');
    params.push(filters.category);
  }
  if (filters.status === 'active') {
    clauses.push('is_active = 1');
  } else if (filters.status === 'inactive') {
    clauses.push('is_active = 0');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM authors ${where} ORDER BY updated_at DESC`)
    .all(...params) as unknown as AuthorRow[];

  return rows.map(mapAuthor);
}

export function listDistinctCategories(): string[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT DISTINCT category FROM authors WHERE category IS NOT NULL AND category != '' ORDER BY category")
    .all() as unknown as { category: string }[];
  return rows.map((row) => row.category);
}

function getSamplesForAuthor(authorId: number): WritingSampleDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM author_writing_samples WHERE author_id = ? ORDER BY created_at ASC')
    .all(authorId) as unknown as AuthorWritingSampleRow[];
  return rows.map(mapSample);
}

export function getAuthorById(id: number): AuthorDetailDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM authors WHERE id = ?').get(id) as unknown as AuthorRow | undefined;
  if (!row) return null;
  return { ...mapAuthor(row), writingSamples: getSamplesForAuthor(id) };
}

export function createAuthor(input: AuthorInput): AuthorDetailDto {
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT INTO authors (
      name, category, short_biography, philosophy, writing_style, tone,
      target_audience, preferred_expressions, prohibited_expressions, writing_notes,
      expertise, perspective, editorial_principles, boundaries, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(
    input.name,
    input.category ?? null,
    input.shortBiography ?? null,
    input.philosophy ?? null,
    input.writingStyle ?? null,
    input.tone ?? null,
    input.targetAudience ?? null,
    input.preferredExpressions ?? null,
    input.prohibitedExpressions ?? null,
    input.writingNotes ?? null,
    input.expertise ?? null,
    input.perspective ?? null,
    input.editorialPrinciples ?? null,
    input.boundaries ?? null,
    input.isActive === false ? 0 : 1,
  );
  const authorId = Number(result.lastInsertRowid);

  if (input.writingSamples?.length) {
    const insertSample = db.prepare(
      'INSERT INTO author_writing_samples (author_id, title, notes, full_text) VALUES (?, ?, ?, ?)',
    );
    for (const sample of input.writingSamples) {
      insertSample.run(authorId, sample.title, sample.notes ?? null, sample.fullText ?? null);
    }
  }

  return getAuthorById(authorId)!;
}

export function updateAuthor(id: number, input: AuthorInput): AuthorDetailDto | null {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM authors WHERE id = ?').get(id);
  if (!existing) return null;

  db.prepare(`
    UPDATE authors SET
      name = ?, category = ?, short_biography = ?, philosophy = ?, writing_style = ?,
      tone = ?, target_audience = ?, preferred_expressions = ?, prohibited_expressions = ?,
      writing_notes = ?, expertise = ?, perspective = ?, editorial_principles = ?, boundaries = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name,
    input.category ?? null,
    input.shortBiography ?? null,
    input.philosophy ?? null,
    input.writingStyle ?? null,
    input.tone ?? null,
    input.targetAudience ?? null,
    input.preferredExpressions ?? null,
    input.prohibitedExpressions ?? null,
    input.writingNotes ?? null,
    input.expertise ?? null,
    input.perspective ?? null,
    input.editorialPrinciples ?? null,
    input.boundaries ?? null,
    id,
  );

  return getAuthorById(id);
}

export function setAuthorActiveStatus(id: number, isActive: boolean): AuthorDetailDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`UPDATE authors SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(isActive ? 1 : 0, id);
  if (result.changes === 0) return null;
  return getAuthorById(id);
}

export function deleteAuthor(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM authors WHERE id = ?').run(id);
  return result.changes > 0;
}

export function addWritingSample(authorId: number, sample: WritingSampleInput): WritingSampleDto | null {
  const db = getDatabase();
  const author = db.prepare('SELECT id FROM authors WHERE id = ?').get(authorId);
  if (!author) return null;

  const insert = db.prepare(
    'INSERT INTO author_writing_samples (author_id, title, notes, full_text) VALUES (?, ?, ?, ?)',
  );
  const result = insert.run(authorId, sample.title, sample.notes ?? null, sample.fullText ?? null);
  const row = db
    .prepare('SELECT * FROM author_writing_samples WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as unknown as AuthorWritingSampleRow;
  return mapSample(row);
}

export function updateWritingSample(
  authorId: number,
  sampleId: number,
  sample: WritingSampleInput,
): WritingSampleDto | null {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM author_writing_samples WHERE id = ? AND author_id = ?')
    .get(sampleId, authorId);
  if (!existing) return null;

  db.prepare(`
    UPDATE author_writing_samples SET title = ?, notes = ?, full_text = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(sample.title, sample.notes ?? null, sample.fullText ?? null, sampleId);

  const row = db
    .prepare('SELECT * FROM author_writing_samples WHERE id = ?')
    .get(sampleId) as unknown as AuthorWritingSampleRow;
  return mapSample(row);
}

export function deleteWritingSample(authorId: number, sampleId: number): boolean {
  const db = getDatabase();
  const result = db
    .prepare('DELETE FROM author_writing_samples WHERE id = ? AND author_id = ?')
    .run(sampleId, authorId);
  return result.changes > 0;
}
