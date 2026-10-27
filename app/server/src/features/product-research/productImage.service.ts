import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { addProductImage } from '../products/products.repository.js';
import { ensureProductUploadsDir, PRODUCT_IMAGES_DIR, relativeUploadPath } from '../products/products.upload.js';

/**
 * A DURABLE LOCAL COPY of a product image (Milestone 18).
 *
 * A retailer's CDN URL is not a permanent asset. It changes when a listing is
 * updated, disappears when a listing is removed, and may be hotlink-blocked in
 * a published post. So an image found during research is downloaded once and
 * stored beside every other product image Cynth holds.
 *
 * It reuses the storage that already existed for uploads — the same folder,
 * the same UUID filenames, the same `product_images` rows, the same
 * `/uploads/...` serving path. There is no second image system: an image
 * fetched from a page and an image the editor dragged in are the same kind of
 * thing once stored, and the product card cannot tell them apart.
 *
 * Nothing here is vendor-specific.
 */

/** Matches the upload limit in products.upload.ts. A product image larger than this is a mistake, whatever its source. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 15_000;

/** The same set the multipart upload accepts, so both paths store the same kinds of file. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export interface StoredImageResult {
  /** The path served under /uploads, once stored. */
  url?: string;
  imageId?: number;
  /** Set when the image could not be stored. Never throws — the research it accompanies is still valid. */
  error?: string;
}

/**
 * Downloads one image and attaches it to a product.
 *
 * Deliberately conservative about what it will store: only http(s), only the
 * four image types the upload path already accepts, and only within the same
 * size ceiling. A response that is not an image is discarded rather than
 * written to disk with an image extension.
 */
export async function storeRemoteProductImage(productId: number, imageUrl: string): Promise<StoredImageResult> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return { error: 'the image address is not a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'only http and https image addresses can be stored' };
  }

  let response: Response;
  try {
    response = await fetch(imageUrl, {
      headers: { 'user-agent': 'CynthBot/1.0 (+editorial research)', accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'the request failed' };
  }

  if (!response.ok) return { error: `the image address answered HTTP ${response.status}` };

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const extension = EXTENSION_BY_MIME[contentType];
  if (!extension) {
    return { error: `unsupported image type "${contentType || 'unknown'}" (JPEG, PNG, WEBP and GIF are accepted)` };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) return { error: 'the image was empty' };
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return { error: `the image is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB` };
  }

  // Created if it does not exist, per the same helper the server calls at
  // startup — so a fresh install or a deleted folder both recover here.
  ensureProductUploadsDir();

  // Cynth's own filename, never one derived from the remote URL: a name taken
  // from a URL is a path-traversal surface and a collision risk.
  const filename = `${randomUUID()}${extension}`;
  try {
    fs.writeFileSync(path.join(PRODUCT_IMAGES_DIR, filename), buffer);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'the file could not be written' };
  }

  const image = addProductImage(productId, {
    filePath: relativeUploadPath(filename),
    // Recorded so a stored image can always be traced to where it came from.
    originalFilename: imageUrl.slice(0, 500),
    // Primary only when the product has none yet — an editor's own choice of
    // primary image is never displaced by a downloaded one.
    isPrimary: true,
  });

  if (!image) {
    // The product vanished between the fetch and the insert. Do not leave the
    // file behind with nothing pointing at it.
    fs.rmSync(path.join(PRODUCT_IMAGES_DIR, filename), { force: true });
    return { error: 'the product no longer exists' };
  }

  return { url: image.url, imageId: image.id };
}
