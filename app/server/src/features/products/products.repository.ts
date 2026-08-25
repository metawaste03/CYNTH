import { getDatabase } from '../../shared/database/index.js';
import type { ProductRow, ProductImageRow } from '../../shared/database/types.js';
import type { ProductInput } from './products.validation.js';

export interface ProductListFilters {
  search?: string;
  category?: string;
  status?: 'active' | 'inactive';
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
  affiliateLink: string | null;
  editorialFit: string | null;
  notes: string | null;
  isActive: boolean;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM products ${where} ORDER BY updated_at DESC`)
    .all(...params) as unknown as ProductRow[];

  const primaryImages = db
    .prepare('SELECT * FROM product_images WHERE is_primary = 1')
    .all() as unknown as ProductImageRow[];
  const primaryByProductId = new Map(primaryImages.map((row) => [row.product_id, mapImage(row)]));

  return rows.map((row) => ({ ...mapProduct(row), primaryImage: primaryByProductId.get(row.id) ?? null }));
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
  return { ...mapProduct(row), images: getImagesForProduct(id) };
}

export function createProduct(input: ProductInput): ProductDetailDto {
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT INTO products (
      title, brand, category, short_description, description, affiliate_link, editorial_fit, notes, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      affiliate_link = ?, editorial_fit = ?, notes = ?, updated_at = datetime('now')
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
