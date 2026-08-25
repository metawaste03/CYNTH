import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { DATABASE_DIR } from '../../shared/database/index.js';

// Local file storage for product images, alongside the SQLite database —
// see database/README.md. Only the relative path (below) is ever stored in
// SQLite, per Milestone 4's constraints.
export const UPLOADS_ROOT = path.join(DATABASE_DIR, 'uploads');
export const PRODUCT_IMAGES_DIR = path.join(UPLOADS_ROOT, 'products');

export function ensureProductUploadsDir(): void {
  fs.mkdirSync(PRODUCT_IMAGES_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PRODUCT_IMAGES_DIR),
  filename: (_req, file, cb) => {
    // Never trust the original filename for the stored name — generate our
    // own to avoid collisions and path-traversal issues. The original name
    // is kept in the database for display purposes only.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

/** Express middleware (single-file, field name "file"). Rejects non-image types and oversized files. */
export const productImageUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Unsupported image type. Allowed types: JPEG, PNG, WEBP, GIF.'));
      return;
    }
    cb(null, true);
  },
}).single('file');

/** Relative path (as stored in SQLite / served under /uploads) for a just-uploaded file. */
export function relativeUploadPath(filename: string): string {
  return path.posix.join('uploads', 'products', filename);
}
