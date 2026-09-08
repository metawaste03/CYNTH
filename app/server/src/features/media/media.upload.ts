import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { UPLOADS_ROOT } from '../products/products.upload.js';

/**
 * Local storage for media-library images.
 *
 * Sits beside the product images under the same uploads root and is served by
 * the same static handler, so there is one place on disk holding everything
 * Cynth stores and one backup story. Only the relative path is written to
 * SQLite.
 */
export const MEDIA_IMAGES_DIR = path.join(UPLOADS_ROOT, 'media');

export function ensureMediaUploadsDir(): void {
  fs.mkdirSync(MEDIA_IMAGES_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/** Larger than the product limit: a featured image is a hero asset, not a thumbnail. */
const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureMediaUploadsDir();
    cb(null, MEDIA_IMAGES_DIR);
  },
  filename: (_req, file, cb) => {
    // Cynth's own name, never the uploaded one: a filename from a browser is
    // a path-traversal surface and a collision risk. The original is kept in
    // the database for display only.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext || '.img'}`);
  },
});

export const mediaImageUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Unsupported image type. Allowed: JPEG, PNG, WEBP, GIF, AVIF.'));
      return;
    }
    cb(null, true);
  },
}).single('file');

/** Relative path as stored in SQLite and served under /uploads. */
export function relativeMediaPath(filename: string): string {
  return path.posix.join('uploads', 'media', filename);
}

/** Removes a stored file. Never throws: a missing file must not fail the delete of its record. */
export function removeMediaFile(relativePath: string): void {
  try {
    const filename = path.basename(relativePath);
    fs.rmSync(path.join(MEDIA_IMAGES_DIR, filename), { force: true });
  } catch {
    // The record is the thing that matters; an orphaned file is harmless.
  }
}
