import { getDatabase } from '../../shared/database/index.js';
import { TEMPLATE_DEFINITIONS, TEMPLATE_FALLBACKS } from './templates.definitions.js';
import type { ContentSchema, PresentationSchema, TemplateDefinition } from './templates.definitions.js';

/**
 * THE ARTICLE TEMPLATE REGISTRY.
 *
 * Templates are versioned and never overwritten. Editing one creates a new
 * version, and an article records the template id AND version it was written
 * to — so republishing something written to v1 does not silently reinterpret
 * it under a v2 schema, and EveryFiveDays can always resolve the presentation
 * template the article was actually built for.
 */

export interface TemplateDto {
  id: number;
  templateId: string;
  version: number;
  name: string;
  articleTypeSlug: string;
  description: string | null;
  contentSchema: ContentSchema;
  presentationSchema: PresentationSchema | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function map(row: any): TemplateDto {
  return {
    id: row.id,
    templateId: row.template_id,
    version: row.version,
    name: row.name,
    articleTypeSlug: row.article_type_slug,
    description: row.description ?? null,
    // The fallback is what an unreadable schema degrades to. maxWords 0 means
    // "no ceiling of its own", which lets the publication-wide limit apply
    // rather than leaving the article unbounded.
    contentSchema: parse<ContentSchema>(row.content_schema, {
      sections: [],
      minWords: 0,
      maxWords: 0,
      requiresFaq: false,
      requiresSources: false,
    }),
    presentationSchema: parse<PresentationSchema | null>(row.presentation_schema, null),
    isDefault: row.is_default === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTemplates(options: { activeOnly?: boolean } = {}): TemplateDto[] {
  const db = getDatabase();
  const where = options.activeOnly ? 'WHERE is_active = 1' : '';
  const rows = db
    .prepare(`SELECT * FROM article_templates ${where} ORDER BY article_type_slug, template_id, version DESC`)
    .all() as any[];
  return rows.map(map);
}

export function getTemplate(templateId: string, version?: number): TemplateDto | null {
  const db = getDatabase();
  const row =
    version === undefined
      ? db
          .prepare('SELECT * FROM article_templates WHERE template_id = ? ORDER BY version DESC LIMIT 1')
          .get(templateId)
      : db.prepare('SELECT * FROM article_templates WHERE template_id = ? AND version = ?').get(templateId, version);
  return row ? map(row) : null;
}

/**
 * The template an article type resolves to.
 *
 * Falls back to a structurally similar template where a type has none of its
 * own, rather than to nothing — a classified article should always have a
 * shape to write to. Returns null only when even the fallback is missing,
 * which means the registry was never seeded.
 */
export function getDefaultTemplateForType(articleTypeSlug: string): TemplateDto | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT * FROM article_templates
       WHERE article_type_slug = ? AND is_default = 1 AND is_active = 1
       ORDER BY version DESC LIMIT 1`,
    )
    .get(articleTypeSlug);
  if (row) return map(row);

  const fallbackId = TEMPLATE_FALLBACKS[articleTypeSlug];
  return fallbackId ? getTemplate(fallbackId) : null;
}

export interface TemplateInput {
  templateId: string;
  name: string;
  articleTypeSlug: string;
  description?: string | null;
  contentSchema: ContentSchema;
  presentationSchema?: PresentationSchema | null;
  isDefault?: boolean;
}

/**
 * Saves a template as a NEW VERSION.
 *
 * There is deliberately no update-in-place: an existing version is immutable,
 * because articles reference it. Editing means creating version n+1, and
 * articles already written keep pointing at the version they were built for.
 */
export function saveTemplateVersion(input: TemplateInput): TemplateDto {
  const db = getDatabase();
  const current = getTemplate(input.templateId);
  const version = current ? current.version + 1 : 1;

  if (input.isDefault) clearDefaultFor(input.articleTypeSlug);

  db.prepare(
    `INSERT INTO article_templates
       (template_id, version, name, article_type_slug, description, content_schema, presentation_schema, is_default, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    input.templateId,
    version,
    input.name,
    input.articleTypeSlug,
    input.description ?? null,
    JSON.stringify(input.contentSchema),
    input.presentationSchema ? JSON.stringify(input.presentationSchema) : null,
    input.isDefault ? 1 : 0,
  );

  return getTemplate(input.templateId, version)!;
}

/** Exactly one default per article type, applied the same way products and providers do it. */
function clearDefaultFor(articleTypeSlug: string): void {
  const db = getDatabase();
  db.prepare('UPDATE article_templates SET is_default = 0 WHERE article_type_slug = ?').run(articleTypeSlug);
}

export function setDefaultTemplate(templateId: string, version: number): TemplateDto | { error: string } {
  const template = getTemplate(templateId, version);
  if (!template) return { error: 'Template not found.' };

  clearDefaultFor(template.articleTypeSlug);
  const db = getDatabase();
  db.prepare(
    `UPDATE article_templates SET is_default = 1, updated_at = datetime('now') WHERE template_id = ? AND version = ?`,
  ).run(templateId, version);

  return getTemplate(templateId, version)!;
}

export function setTemplateActive(templateId: string, version: number, isActive: boolean): TemplateDto | null {
  const db = getDatabase();
  const result = db
    .prepare(
      `UPDATE article_templates SET is_active = ?, updated_at = datetime('now') WHERE template_id = ? AND version = ?`,
    )
    .run(isActive ? 1 : 0, templateId, version);
  return result.changes ? getTemplate(templateId, version) : null;
}

/**
 * Seeds the initial templates, once.
 *
 * Idempotent by (template_id, version): a template already present is left
 * exactly as it is, including any edits, because overwriting a template an
 * article was written to would change what that article means.
 */
export function seedTemplates(): { seeded: number; existing: number } {
  const db = getDatabase();
  let seeded = 0;
  let existing = 0;

  for (const definition of TEMPLATE_DEFINITIONS as TemplateDefinition[]) {
    const present = db
      .prepare('SELECT id FROM article_templates WHERE template_id = ? AND version = ?')
      .get(definition.templateId, definition.version);

    if (present) {
      existing += 1;
      continue;
    }

    db.prepare(
      `INSERT INTO article_templates
         (template_id, version, name, article_type_slug, description, content_schema, presentation_schema, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      definition.templateId,
      definition.version,
      definition.name,
      definition.articleTypeSlug,
      definition.description,
      JSON.stringify(definition.contentSchema),
      JSON.stringify(definition.presentationSchema),
      definition.isDefault ? 1 : 0,
    );
    seeded += 1;
  }

  return { seeded, existing };
}
