import { getDatabase } from '../../shared/database/index.js';
import { slugify } from '../../shared/text/slug.js';

/**
 * The content architecture: projects, thematic areas, topics, and the
 * relationships between authors, article types and those areas.
 *
 * Everything here is generic engine code. It contains no theme names, no
 * author names, and no assumption about how many of anything exist —
 * EveryFiveDays' five thematic areas are rows seeded by
 * shared/database/seedProject.ts, and a sixth is an INSERT away.
 */

/* ------------------------------------------------------------------ types */

export interface ProjectDto {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  /** Project-wide editorial rules applied to every article. User-supplied. */
  editorialGuidance: string | null;
  isActive: boolean;
  isDefault: boolean;
  themeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ThemeDto {
  id: number;
  projectId: number;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  isActive: boolean;
  topicCount: number;
  authorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TopicDto {
  id: number;
  themeId: number;
  title: string;
  slug: string;
  description: string | null;
  notes: string | null;
  /**
   * Editorial guidance. This is what lets a topic instruct generation rather
   * than merely label it. Every field is user-supplied; Cynth never fills
   * these in on the user's behalf.
   */
  scope: string | null;
  keyAreas: string | null;
  considerations: string | null;
  exclusions: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleTypeDto {
  id: number;
  name: string;
  description: string | null;
}

/* --------------------------------------------------------------- helpers */

/** Makes a slug unique within a scope (project for themes, theme for topics). */
function uniqueSlug(table: 'themes' | 'topics', scopeColumn: string, scopeId: number, base: string, excludeId: number): string {
  const db = getDatabase();
  let candidate = base || 'item';
  let suffix = 2;

  while (
    db
      .prepare(`SELECT id FROM ${table} WHERE ${scopeColumn} = ? AND slug = ? AND id != ?`)
      .get(scopeId, candidate, excludeId) !== undefined
  ) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/* -------------------------------------------------------------- projects */

export function listProjects(): ProjectDto[] {
  const db = getDatabase();
  const rows = db
    .prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM themes t WHERE t.project_id = p.id) AS theme_count
      FROM projects p ORDER BY p.is_default DESC, p.name
    `)
    .all() as unknown as Record<string, never>[];

  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    editorialGuidance: row.editorial_guidance ?? null,
    isActive: row.is_active === 1,
    isDefault: row.is_default === 1,
    themeCount: row.theme_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * The project new work belongs to when nothing else says otherwise.
 *
 * Returns null rather than inventing one: Cynth runs perfectly well with no
 * project configured, and a caller must handle that rather than assume
 * EveryFiveDays exists.
 */
export function getDefaultProject(): ProjectDto | null {
  const projects = listProjects();
  return projects.find((p) => p.isDefault) ?? projects[0] ?? null;
}

export function getProjectById(id: number): ProjectDto | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

/* ---------------------------------------------------------------- themes */

function mapTheme(row: any): ThemeDto {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    position: row.position,
    isActive: row.is_active === 1,
    topicCount: row.topic_count ?? 0,
    authorCount: row.author_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const THEME_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM topics tp WHERE tp.theme_id = t.id) AS topic_count,
    (SELECT COUNT(*) FROM author_themes at WHERE at.theme_id = t.id) AS author_count
  FROM themes t
`;

export function listThemes(options: { projectId?: number; activeOnly?: boolean } = {}): ThemeDto[] {
  const db = getDatabase();
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.projectId !== undefined) {
    where.push('t.project_id = ?');
    params.push(options.projectId);
  }
  if (options.activeOnly) where.push('t.is_active = 1');

  const rows = db
    .prepare(`${THEME_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.position, t.name`)
    .all(...(params as never[])) as unknown as any[];

  return rows.map(mapTheme);
}

export function getThemeById(id: number): ThemeDto | null {
  const db = getDatabase();
  const row = db.prepare(`${THEME_SELECT} WHERE t.id = ?`).get(id) as unknown as any;
  return row ? mapTheme(row) : null;
}

export interface ThemeInput {
  name: string;
  description: string | null;
  position?: number;
  isActive?: boolean;
}

export function createTheme(projectId: number, input: ThemeInput): ThemeDto {
  const db = getDatabase();
  const id = Number(
    db
      .prepare('INSERT INTO themes (project_id, name, slug, description, position, is_active) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projectId, input.name, `pending-${Date.now()}-${Math.random()}`, input.description, input.position ?? 0, input.isActive === false ? 0 : 1)
      .lastInsertRowid,
  );

  db.prepare('UPDATE themes SET slug = ? WHERE id = ?').run(uniqueSlug('themes', 'project_id', projectId, slugify(input.name), id), id);
  return getThemeById(id)!;
}

export function updateTheme(id: number, input: ThemeInput): ThemeDto | null {
  const db = getDatabase();
  const existing = db.prepare('SELECT project_id FROM themes WHERE id = ?').get(id) as unknown as { project_id: number } | undefined;
  if (!existing) return null;

  db.prepare(`
    UPDATE themes SET name = ?, slug = ?, description = ?, position = ?, is_active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name,
    uniqueSlug('themes', 'project_id', existing.project_id, slugify(input.name), id),
    input.description,
    input.position ?? 0,
    input.isActive === false ? 0 : 1,
    id,
  );

  return getThemeById(id);
}

export function setThemeActive(id: number, isActive: boolean): ThemeDto | null {
  const db = getDatabase();
  const result = db
    .prepare("UPDATE themes SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(isActive ? 1 : 0, id);
  return result.changes === 0 ? null : getThemeById(id);
}

/**
 * Whether a theme can be deleted without destroying editorial history.
 *
 * Deactivating is always safe; deleting is refused while any article still
 * points at it. Retiring a thematic area must never remove published work.
 */
export function themeDeletionBlockers(id: number): string[] {
  const db = getDatabase();
  const articles = db.prepare('SELECT COUNT(*) AS count FROM articles WHERE theme_id = ?').get(id) as { count: number };
  const blockers: string[] = [];
  if (articles.count > 0) {
    blockers.push(`${articles.count} article(s) reference this thematic area. Deactivate it instead of deleting it.`);
  }
  return blockers;
}

export function deleteTheme(id: number): boolean {
  const db = getDatabase();
  return db.prepare('DELETE FROM themes WHERE id = ?').run(id).changes > 0;
}

/* ---------------------------------------------------------------- topics */

function mapTopic(row: any): TopicDto {
  return {
    id: row.id,
    themeId: row.theme_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    notes: row.notes,
    scope: row.scope,
    keyAreas: row.key_areas,
    considerations: row.considerations,
    exclusions: row.exclusions,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTopics(options: { themeId?: number; projectId?: number; activeOnly?: boolean } = {}): TopicDto[] {
  const db = getDatabase();
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.themeId !== undefined) {
    where.push('tp.theme_id = ?');
    params.push(options.themeId);
  }
  if (options.projectId !== undefined) {
    where.push('tp.theme_id IN (SELECT id FROM themes WHERE project_id = ?)');
    params.push(options.projectId);
  }
  if (options.activeOnly) where.push('tp.is_active = 1');

  const rows = db
    .prepare(`SELECT tp.* FROM topics tp ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY tp.title`)
    .all(...(params as never[])) as unknown as any[];

  return rows.map(mapTopic);
}

export function getTopicById(id: number): TopicDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as unknown as any;
  return row ? mapTopic(row) : null;
}

export interface TopicInput {
  title: string;
  description: string | null;
  notes: string | null;
  scope?: string | null;
  keyAreas?: string | null;
  considerations?: string | null;
  exclusions?: string | null;
  isActive?: boolean;
}

export function createTopic(themeId: number, input: TopicInput): TopicDto {
  const db = getDatabase();
  const id = Number(
    db
      .prepare(`INSERT INTO topics (theme_id, title, slug, description, notes, scope, key_areas, considerations, exclusions, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        themeId,
        input.title,
        `pending-${Date.now()}-${Math.random()}`,
        input.description,
        input.notes,
        input.scope ?? null,
        input.keyAreas ?? null,
        input.considerations ?? null,
        input.exclusions ?? null,
        input.isActive === false ? 0 : 1,
      )
      .lastInsertRowid,
  );

  db.prepare('UPDATE topics SET slug = ? WHERE id = ?').run(uniqueSlug('topics', 'theme_id', themeId, slugify(input.title), id), id);
  return getTopicById(id)!;
}

export function updateTopic(id: number, input: TopicInput): TopicDto | null {
  const db = getDatabase();
  const existing = db.prepare('SELECT theme_id FROM topics WHERE id = ?').get(id) as unknown as { theme_id: number } | undefined;
  if (!existing) return null;

  db.prepare(`
    UPDATE topics SET title = ?, slug = ?, description = ?, notes = ?,
      scope = ?, key_areas = ?, considerations = ?, exclusions = ?,
      is_active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.title,
    uniqueSlug('topics', 'theme_id', existing.theme_id, slugify(input.title), id),
    input.description,
    input.notes,
    input.scope ?? null,
    input.keyAreas ?? null,
    input.considerations ?? null,
    input.exclusions ?? null,
    input.isActive === false ? 0 : 1,
    id,
  );

  return getTopicById(id);
}

export function deleteTopic(id: number): boolean {
  const db = getDatabase();
  return db.prepare('DELETE FROM topics WHERE id = ?').run(id).changes > 0;
}

/* -------------------------------------------------- author <-> theme ---- */

/**
 * Deliberately many-to-many. EveryFiveDays may run one author per thematic
 * area, but that is a configuration choice, not a rule the engine enforces —
 * one author can cover several areas and one area can have several authors.
 */
export function listThemesForAuthor(authorId: number): ThemeDto[] {
  const db = getDatabase();
  const rows = db
    .prepare(`${THEME_SELECT} JOIN author_themes at ON at.theme_id = t.id WHERE at.author_id = ? ORDER BY t.position, t.name`)
    .all(authorId) as unknown as any[];
  return rows.map(mapTheme);
}

export function listAuthorsForTheme(themeId: number): { id: number; name: string; isActive: boolean }[] {
  const db = getDatabase();
  const rows = db
    .prepare(`
      SELECT a.id, a.name, a.is_active FROM authors a
      JOIN author_themes at ON at.author_id = a.id
      WHERE at.theme_id = ? ORDER BY a.name
    `)
    .all(themeId) as unknown as any[];
  return rows.map((row) => ({ id: row.id, name: row.name, isActive: row.is_active === 1 }));
}

/** Replaces an author's thematic areas wholesale — the caller always sends the complete set. */
export function setAuthorThemes(authorId: number, themeIds: number[]): ThemeDto[] {
  const db = getDatabase();
  db.prepare('DELETE FROM author_themes WHERE author_id = ?').run(authorId);

  const insert = db.prepare('INSERT OR IGNORE INTO author_themes (author_id, theme_id) VALUES (?, ?)');
  for (const themeId of themeIds) insert.run(authorId, themeId);

  return listThemesForAuthor(authorId);
}

/* --------------------------------------------------- article types ------ */

/**
 * The article types a project offers.
 *
 * Falls back to the full shared taxonomy when a project has no explicit
 * links, so a newly created project is usable immediately rather than
 * appearing to support nothing.
 */
export function listArticleTypesForProject(projectId: number): ArticleTypeDto[] {
  const db = getDatabase();
  const linked = db
    .prepare(`
      SELECT at.id, at.name, at.description FROM article_types at
      JOIN project_article_types pat ON pat.article_type_id = at.id
      WHERE pat.project_id = ? AND pat.is_enabled = 1
      ORDER BY at.id
    `)
    .all(projectId) as unknown as ArticleTypeDto[];

  if (linked.length > 0) return linked;
  return db.prepare('SELECT id, name, description FROM article_types ORDER BY id').all() as unknown as ArticleTypeDto[];
}

/**
 * The article types a theme supports.
 *
 * No rows for a theme means "everything the project offers" — absence is
 * permissive, so narrowing stays opt-in and costs nothing until configured.
 */
export function listArticleTypesForTheme(themeId: number): ArticleTypeDto[] {
  const db = getDatabase();
  const narrowed = db
    .prepare(`
      SELECT at.id, at.name, at.description FROM article_types at
      JOIN theme_article_types tat ON tat.article_type_id = at.id
      WHERE tat.theme_id = ? ORDER BY at.id
    `)
    .all(themeId) as unknown as ArticleTypeDto[];

  if (narrowed.length > 0) return narrowed;

  const theme = getThemeById(themeId);
  return theme ? listArticleTypesForProject(theme.projectId) : [];
}

export function setProjectArticleTypes(projectId: number, articleTypeIds: number[]): ArticleTypeDto[] {
  const db = getDatabase();
  db.prepare('DELETE FROM project_article_types WHERE project_id = ?').run(projectId);
  const insert = db.prepare('INSERT OR IGNORE INTO project_article_types (project_id, article_type_id) VALUES (?, ?)');
  for (const id of articleTypeIds) insert.run(projectId, id);
  return listArticleTypesForProject(projectId);
}

export function setThemeArticleTypes(themeId: number, articleTypeIds: number[]): ArticleTypeDto[] {
  const db = getDatabase();
  db.prepare('DELETE FROM theme_article_types WHERE theme_id = ?').run(themeId);
  const insert = db.prepare('INSERT OR IGNORE INTO theme_article_types (theme_id, article_type_id) VALUES (?, ?)');
  for (const id of articleTypeIds) insert.run(themeId, id);
  return listArticleTypesForTheme(themeId);
}
