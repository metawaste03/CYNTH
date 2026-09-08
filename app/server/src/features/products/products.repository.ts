import { getDatabase } from '../../shared/database/index.js';
import type { ProductRow, ProductImageRow } from '../../shared/database/types.js';
import type { ProductInput } from './products.validation.js';

export interface ProductListFilters {
  search?: string;
  category?: string;
  status?: 'active' | 'inactive';
  /** Filter to one thematic area (Milestone 18). 'none' lists products with no area chosen. */
  themeId?: number | 'none';
}

/** Resolves theme names for a set of products in one query, rather than one per row. */
function themeNamesFor(themeIds: (number | null)[]): Map<number, string> {
  const distinct = [...new Set(themeIds.filter((id): id is number => id !== null))];
  if (!distinct.length) return new Map();

  const db = getDatabase();
  const rows = db
    .prepare(`SELECT id, name FROM themes WHERE id IN (${distinct.map(() => '?').join(', ')})`)
    .all(...distinct) as unknown as { id: number; name: string }[];
  return new Map(rows.map((row) => [row.id, row.name]));
}

export interface ProductImageDto {
  id: number;
  url: string;
  originalFilename: string | null;
  isPrimary: boolean;
  position: number;
  createdAt: string;
}

export interface ProductDto {
  id: number;
  title: string;
  brand: string | null;
  category: string | null;
  shortDescription: string | null;
  description: string | null;
  /** THE USER'S LINK. Supplied by them, stored verbatim, never rewritten by research. */
  affiliateLink: string | null;
  editorialFit: string | null;
  notes: string | null;
  isActive: boolean;
  /* --- Product research (Milestone 17). Null until a product has been researched. --- */
  /** The page that was read for research. Never used as a link in an article — that is affiliateLink's job. */
  sourceUrl: string | null;
  vendor: string | null;
  /** The image the source page published about itself. An uploaded image always wins over it. */
  sourceImageUrl: string | null;
  useCase: string | null;
  problemSolved: string | null;
  bestFor: string | null;
  keyFeatures: string[];
  researchStatus: 'none' | 'retrieved' | 'researched' | 'failed';
  researchedAt: string | null;
  /** The thematic area this product belongs to (Milestone 18). Null means none chosen. */
  themeId: number | null;
  /** Resolved for display, so a list does not need a second query per row. */
  themeName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListItemDto extends ProductDto {
  primaryImage: ProductImageDto | null;
}

export interface ProductDetailDto extends ProductDto {
  images: ProductImageDto[];
}

export interface NewImageInput {
  filePath: string;
  originalFilename?: string;
  isPrimary?: boolean;
}

function mapProduct(row: ProductRow): ProductDto {
  return {
    id: row.id,
    title: row.title,
    brand: row.brand,
    category: row.category,
    shortDescription: row.short_description,
    description: row.description,
    affiliateLink: row.affiliate_link,
    editorialFit: row.editorial_fit,
    notes: row.notes,
    isActive: row.is_active === 1,
    sourceUrl: row.source_url ?? null,
    vendor: row.vendor ?? null,
    sourceImageUrl: row.source_image_url ?? null,
    useCase: row.use_case ?? null,
    problemSolved: row.problem_solved ?? null,
    bestFor: row.best_for ?? null,
    keyFeatures: parseFeatures(row.key_features),
    researchStatus: readResearchStatus(row.research_status),
    researchedAt: row.researched_at ?? null,
    themeId: row.theme_id ?? null,
    themeName: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Stored as JSON. A malformed value reads as "no features" rather than failing the whole product. */
function parseFeatures(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function readResearchStatus(raw: string | null | undefined): ProductDto['researchStatus'] {
  return raw === 'retrieved' || raw === 'researched' || raw === 'failed' ? raw : 'none';
}

function mapImage(row: ProductImageRow): ProductImageDto {
  return {
    id: row.id,
    url: `/${row.file_path}`,
    originalFilename: row.original_filename,
    isPrimary: row.is_primary === 1,
    position: row.position,
    createdAt: row.created_at,
  };
}

function getImagesForProduct(productId: number): ProductImageDto[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY position ASC, id ASC')
    .all(productId) as unknown as ProductImageRow[];
  return rows.map(mapImage);
}

export function listProducts(filters: ProductListFilters): ProductListItemDto[] {
  const db = getDatabase();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.search) {
    clauses.push('(title LIKE ? OR brand LIKE ? OR category LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like);
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
  if (filters.themeId === 'none') {
    clauses.push('theme_id IS NULL');
  } else if (typeof filters.themeId === 'number') {
    clauses.push('theme_id = ?');
    params.push(filters.themeId);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM products ${where} ORDER BY updated_at DESC`)
    .all(...params) as unknown as ProductRow[];

  const primaryImages = db
    .prepare('SELECT * FROM product_images WHERE is_primary = 1')
    .all() as unknown as ProductImageRow[];
  const primaryByProductId = new Map(primaryImages.map((row) => [row.product_id, mapImage(row)]));
  const themeNames = themeNamesFor(rows.map((row) => row.theme_id ?? null));

  return rows.map((row) => ({
    ...mapProduct(row),
    themeName: row.theme_id === null ? null : themeNames.get(row.theme_id) ?? null,
    primaryImage: primaryByProductId.get(row.id) ?? null,
  }));
}

export function listDistinctCategories(): string[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != '' ORDER BY category")
    .all() as unknown as { category: string }[];
  return rows.map((row) => row.category);
}

export function getProductById(id: number): ProductDetailDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as unknown as ProductRow | undefined;
  if (!row) return null;
  return {
    ...mapProduct(row),
    themeName: row.theme_id === null ? null : themeNamesFor([row.theme_id]).get(row.theme_id) ?? null,
    images: getImagesForProduct(id),
  };
}

/**
 * Sets or clears a product's thematic area.
 *
 * Its own operation, like author/theme assignment, because it is a
 * relationship rather than a field on a form — and because clearing it must be
 * expressible without submitting the whole product.
 */
export function setProductTheme(id: number, themeId: number | null): ProductDetailDto | { error: string } | null {
  const db = getDatabase();
  if (!db.prepare('SELECT id FROM products WHERE id = ?').get(id)) return null;

  if (themeId !== null && !db.prepare('SELECT id FROM themes WHERE id = ?').get(themeId)) {
    return { error: 'Thematic area not found.' };
  }

  db.prepare(`UPDATE products SET theme_id = ?, updated_at = datetime('now') WHERE id = ?`).run(themeId, id);
  return getProductById(id);
}

export function createProduct(input: ProductInput): ProductDetailDto {
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT INTO products (
      title, brand, category, short_description, description, affiliate_link, editorial_fit, notes, is_active, theme_id,
      use_case, problem_solved, best_for, key_features
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(
    input.title,
    input.brand ?? null,
    input.category ?? null,
    input.shortDescription ?? null,
    input.description ?? null,
    input.affiliateLink ?? null,
    input.editorialFit ?? null,
    input.notes ?? null,
    input.isActive === false ? 0 : 1,
    input.themeId ?? null,
    input.useCase ?? null,
    input.problemSolved ?? null,
    input.bestFor ?? null,
    input.keyFeatures?.length ? JSON.stringify(input.keyFeatures) : null,
  );
  return getProductById(Number(result.lastInsertRowid))!;
}

export function updateProduct(id: number, input: ProductInput): ProductDetailDto | null {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!existing) return null;

  db.prepare(`
    UPDATE products SET
      title = ?, brand = ?, category = ?, short_description = ?, description = ?,
      affiliate_link = ?, editorial_fit = ?, notes = ?, theme_id = ?,
      -- Undefined leaves what is there alone, so saving the form does not wipe
      -- fields that product research wrote and the form did not send.
      use_case = COALESCE(?, use_case),
      problem_solved = COALESCE(?, problem_solved),
      best_for = COALESCE(?, best_for),
      key_features = COALESCE(?, key_features),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.title,
    input.brand ?? null,
    input.category ?? null,
    input.shortDescription ?? null,
    input.description ?? null,
    input.affiliateLink ?? null,
    input.editorialFit ?? null,
    input.notes ?? null,
    input.themeId ?? null,
    // undefined -> NULL -> COALESCE keeps the stored value. An empty string is
    // a deliberate clear and is written as one.
    input.useCase ?? null,
    input.problemSolved ?? null,
    input.bestFor ?? null,
    input.keyFeatures === undefined ? null : JSON.stringify(input.keyFeatures),
    id,
  );

  return getProductById(id);
}

export function setProductActiveStatus(id: number, isActive: boolean): ProductDetailDto | null {
  const db = getDatabase();
  const result = db
    .prepare(`UPDATE products SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(isActive ? 1 : 0, id);
  if (result.changes === 0) return null;
  return getProductById(id);
}

/** Deletes the product and returns its images (so the route handler can unlink the files) or null if not found. */
export function deleteProduct(id: number): ProductImageDto[] | null {
  const db = getDatabase();
  const product = getProductById(id);
  if (!product) return null;
  db.prepare('DELETE FROM products WHERE id = ?').run(id); // cascades product_images rows
  return product.images;
}

export function addProductImage(productId: number, input: NewImageInput): ProductImageDto | null {
  const db = getDatabase();
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) return null;

  const existingCount = (
    db.prepare('SELECT COUNT(*) AS count FROM product_images WHERE product_id = ?').get(productId) as {
      count: number;
    }
  ).count;
  const makePrimary = Boolean(input.isPrimary) || existingCount === 0;

  if (makePrimary) {
    db.prepare('UPDATE product_images SET is_primary = 0 WHERE product_id = ?').run(productId);
  }

  const result = db
    .prepare(
      'INSERT INTO product_images (product_id, file_path, original_filename, is_primary, position) VALUES (?, ?, ?, ?, ?)',
    )
    .run(productId, input.filePath, input.originalFilename ?? null, makePrimary ? 1 : 0, existingCount);

  const row = db
    .prepare('SELECT * FROM product_images WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as unknown as ProductImageRow;
  return mapImage(row);
}

export function setPrimaryImage(productId: number, imageId: number): ProductImageDto | null {
  const db = getDatabase();
  const image = db.prepare('SELECT id FROM product_images WHERE id = ? AND product_id = ?').get(imageId, productId);
  if (!image) return null;

  db.prepare('UPDATE product_images SET is_primary = 0 WHERE product_id = ?').run(productId);
  db.prepare('UPDATE product_images SET is_primary = 1 WHERE id = ?').run(imageId);

  const row = db.prepare('SELECT * FROM product_images WHERE id = ?').get(imageId) as unknown as ProductImageRow;
  return mapImage(row);
}

/** Deletes the image row and, if it was primary, promotes the next one. Returns the deleted row's info (for file cleanup) or null if not found. */
export function deleteProductImage(productId: number, imageId: number): ProductImageDto | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?')
    .get(imageId, productId) as unknown as ProductImageRow | undefined;
  if (!row) return null;

  db.prepare('DELETE FROM product_images WHERE id = ?').run(imageId);

  if (row.is_primary === 1) {
    const next = db
      .prepare('SELECT id FROM product_images WHERE product_id = ? ORDER BY position ASC, id ASC LIMIT 1')
      .get(productId) as unknown as { id: number } | undefined;
    if (next) {
      db.prepare('UPDATE product_images SET is_primary = 1 WHERE id = ?').run(next.id);
    }
  }

  return mapImage(row);
}
