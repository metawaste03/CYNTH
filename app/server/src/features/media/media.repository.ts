import { getDatabase } from '../../shared/database/index.js';

/**
 * The media library: images the editor uploads for articles.
 *
 * Distinct from product images, which belong to a product and reach an article
 * by the editor attaching that product. A media asset is loose, so it has to be
 * FOUND — which is why every asset carries a thematic area, a kind, tags and a
 * description. Cynth matches on those fields; it never looks at the pixels, and
 * it never claims to know what an image shows beyond what the editor wrote.
 */

export const MEDIA_KINDS = ['featured', 'inline', 'diagram', 'screenshot', 'other'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_ROLES = ['featured', 'inline'] as const;
export type MediaRole = (typeof MEDIA_ROLES)[number];

export interface MediaAssetDto {
  id: number;
  url: string;
  originalFilename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  title: string;
  description: string | null;
  altText: string | null;
  themeId: number | null;
  themeName: string | null;
  kind: MediaKind;
  tags: string[];
  credit: string | null;
  isActive: boolean;
  /** How many articles currently use it. Shown so an asset is never deleted blindly. */
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function readKind(raw: string | null): MediaKind {
  return (MEDIA_KINDS as readonly string[]).includes(raw ?? '') ? (raw as MediaKind) : 'featured';
}

function map(row: any): MediaAssetDto {
  return {
    id: row.id,
    url: `/${row.file_path}`,
    originalFilename: row.original_filename ?? null,
    mimeType: row.mime_type ?? null,
    byteSize: row.byte_size ?? null,
    title: row.title,
    description: row.description ?? null,
    altText: row.alt_text ?? null,
    themeId: row.theme_id ?? null,
    themeName: row.theme_name ?? null,
    kind: readKind(row.kind),
    tags: parseTags(row.tags ?? null),
    credit: row.credit ?? null,
    isActive: row.is_active === 1,
    usageCount: row.usage_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `
  SELECT m.*, t.name AS theme_name,
         (SELECT COUNT(*) FROM article_media am WHERE am.media_id = m.id) AS usage_count
  FROM media_assets m
  LEFT JOIN themes t ON t.id = m.theme_id
`;

export interface MediaListFilters {
  themeId?: number | 'none';
  kind?: MediaKind;
  search?: string;
  activeOnly?: boolean;
}

export function listMedia(filters: MediaListFilters = {}): MediaAssetDto[] {
  const db = getDatabase();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.themeId === 'none') clauses.push('m.theme_id IS NULL');
  else if (typeof filters.themeId === 'number') {
    clauses.push('m.theme_id = ?');
    params.push(filters.themeId);
  }
  if (filters.kind) {
    clauses.push('m.kind = ?');
    params.push(filters.kind);
  }
  if (filters.activeOnly) clauses.push('m.is_active = 1');
  if (filters.search) {
    clauses.push('(m.title LIKE ? OR m.description LIKE ? OR m.tags LIKE ? OR m.alt_text LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`${SELECT} ${where} ORDER BY m.created_at DESC`).all(...params) as any[];
  return rows.map(map);
}

export function getMedia(id: number): MediaAssetDto | null {
  const db = getDatabase();
  const row = db.prepare(`${SELECT} WHERE m.id = ?`).get(id);
  return row ? map(row) : null;
}

export interface MediaInput {
  title: string;
  description?: string | null;
  altText?: string | null;
  themeId?: number | null;
  kind?: MediaKind;
  tags?: string | null;
  credit?: string | null;
  isActive?: boolean;
}

export interface NewMediaInput extends MediaInput {
  filePath: string;
  originalFilename?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
}

export function createMedia(input: NewMediaInput): MediaAssetDto {
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO media_assets
         (file_path, original_filename, mime_type, byte_size, title, description, alt_text, theme_id, kind, tags, credit, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.filePath,
      input.originalFilename ?? null,
      input.mimeType ?? null,
      input.byteSize ?? null,
      input.title,
      input.description ?? null,
      input.altText ?? null,
      input.themeId ?? null,
      input.kind ?? 'featured',
      input.tags ?? null,
      input.credit ?? null,
      input.isActive === false ? 0 : 1,
    );

  return getMedia(Number(result.lastInsertRowid))!;
}

export function updateMedia(id: number, input: MediaInput): MediaAssetDto | null {
  const db = getDatabase();
  if (!db.prepare('SELECT id FROM media_assets WHERE id = ?').get(id)) return null;

  db.prepare(
    `UPDATE media_assets SET title = ?, description = ?, alt_text = ?, theme_id = ?, kind = ?, tags = ?, credit = ?,
       is_active = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    input.title,
    input.description ?? null,
    input.altText ?? null,
    input.themeId ?? null,
    input.kind ?? 'featured',
    input.tags ?? null,
    input.credit ?? null,
    input.isActive === false ? 0 : 1,
    id,
  );

  return getMedia(id);
}

/** Returns the deleted asset so the route can unlink its file, or null when it did not exist. */
export function deleteMedia(id: number): MediaAssetDto | null {
  const asset = getMedia(id);
  if (!asset) return null;
  getDatabase().prepare('DELETE FROM media_assets WHERE id = ?').run(id);
  return asset;
}

/* ------------------------------------------------------- article linkage --- */

export interface ArticleMediaDto {
  id: number;
  articleId: number;
  mediaId: number;
  role: MediaRole;
  sectionKey: string | null;
  position: number;
  origin: 'manual' | 'suggested';
  asset: MediaAssetDto | null;
  createdAt: string;
}

export function listArticleMedia(articleId: number): ArticleMediaDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM article_media WHERE article_id = ? ORDER BY role, position, id')
    .all(articleId) as any[];

  return rows.map((row) => ({
    id: row.id,
    articleId: row.article_id,
    mediaId: row.media_id,
    role: row.role,
    sectionKey: row.section_key ?? null,
    position: row.position,
    origin: row.origin,
    asset: getMedia(row.media_id),
    createdAt: row.created_at,
  }));
}

export function getFeaturedImage(articleId: number): MediaAssetDto | null {
  const link = listArticleMedia(articleId).find((entry) => entry.role === 'featured');
  return link?.asset ?? null;
}

/**
 * Attaches an asset to an article.
 *
 * An article has at most one featured image, so attaching a second replaces
 * the first rather than silently producing two — the CMS can only carry one,
 * and a hidden duplicate would surface as a surprise at publish time.
 */
export function attachMedia(input: {
  articleId: number;
  mediaId: number;
  role?: MediaRole;
  sectionKey?: string | null;
  origin?: 'manual' | 'suggested';
}): ArticleMediaDto | { error: string } {
  const db = getDatabase();
  if (!db.prepare('SELECT id FROM articles WHERE id = ?').get(input.articleId)) return { error: 'Draft not found.' };
  if (!db.prepare('SELECT id FROM media_assets WHERE id = ?').get(input.mediaId)) return { error: 'Image not found.' };

  const role: MediaRole = input.role ?? 'featured';
  if (role === 'featured') {
    db.prepare("DELETE FROM article_media WHERE article_id = ? AND role = 'featured'").run(input.articleId);
  }

  db.prepare(
    `INSERT OR REPLACE INTO article_media (article_id, media_id, role, section_key, origin)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.articleId, input.mediaId, role, input.sectionKey ?? null, input.origin ?? 'manual');

  const attached = listArticleMedia(input.articleId).find(
    (entry) => entry.mediaId === input.mediaId && entry.role === role,
  );
  return attached ?? { error: 'The image could not be attached.' };
}

export function detachMedia(articleId: number, mediaId: number, role?: MediaRole): boolean {
  const db = getDatabase();
  const result = role
    ? db
        .prepare('DELETE FROM article_media WHERE article_id = ? AND media_id = ? AND role = ?')
        .run(articleId, mediaId, role)
    : db.prepare('DELETE FROM article_media WHERE article_id = ? AND media_id = ?').run(articleId, mediaId);
  return result.changes > 0;
}
