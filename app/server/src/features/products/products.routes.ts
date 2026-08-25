import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import * as repo from './products.repository.js';
import { validateProductInput } from './products.validation.js';
import { productImageUpload, relativeUploadPath } from './products.upload.js';
import { DATABASE_DIR } from '../../shared/database/index.js';

export const productsRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function unlinkImageFile(relativePath: string): void {
  const absolutePath = path.join(DATABASE_DIR, relativePath);
  fs.unlink(absolutePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error(`Failed to remove image file at ${absolutePath}:`, err);
    }
  });
}

productsRouter.get('/', (req, res) => {
  const { search, category, status } = req.query;
  const products = repo.listProducts({
    search: typeof search === 'string' ? search : undefined,
    category: typeof category === 'string' ? category : undefined,
    status: status === 'active' || status === 'inactive' ? status : undefined,
  });
  res.json({ products });
});

productsRouter.get('/meta/categories', (_req, res) => {
  res.json({ categories: repo.listDistinctCategories() });
});

productsRouter.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid product id.'] });

  const product = repo.getProductById(id);
  if (!product) return res.status(404).json({ errors: ['Product not found.'] });

  res.json({ product });
});

productsRouter.post('/', (req, res) => {
  const { errors, value } = validateProductInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const product = repo.createProduct(value!);
  res.status(201).json({ product });
});

productsRouter.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid product id.'] });

  const { errors, value } = validateProductInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const product = repo.updateProduct(id, value!);
  if (!product) return res.status(404).json({ errors: ['Product not found.'] });

  res.json({ product });
});

productsRouter.patch('/:id/status', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid product id.'] });

  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({ errors: ['isActive must be true or false.'] });
  }

  const product = repo.setProductActiveStatus(id, req.body.isActive);
  if (!product) return res.status(404).json({ errors: ['Product not found.'] });

  res.json({ product });
});

productsRouter.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid product id.'] });

  const deletedImages = repo.deleteProduct(id);
  if (!deletedImages) return res.status(404).json({ errors: ['Product not found.'] });

  for (const image of deletedImages) {
    unlinkImageFile(image.url.replace(/^\//, ''));
  }

  res.status(204).send();
});

productsRouter.post('/:id/images', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid product id.'] });

  productImageUpload(req, res, (err) => {
    if (err instanceof multer.MulterError || err instanceof Error) {
      return res.status(400).json({ errors: [err.message || 'Image upload failed.'] });
    }
    if (!req.file) {
      return res.status(400).json({ errors: ['No image file provided.'] });
    }

    const relativePath = relativeUploadPath(req.file.filename);
    const isPrimary = req.body?.isPrimary === 'true' || req.body?.isPrimary === true;

    const image = repo.addProductImage(id, {
      filePath: relativePath,
      originalFilename: req.file.originalname,
      isPrimary,
    });

    if (!image) {
      // Product didn't exist — clean up the orphaned file we just wrote.
      unlinkImageFile(relativePath);
      return res.status(404).json({ errors: ['Product not found.'] });
    }

    res.status(201).json({ image });
  });
});

productsRouter.patch('/:id/images/:imageId/primary', (req, res) => {
  const id = parseId(req.params.id);
  const imageId = parseId(req.params.imageId);
  if (id === null || imageId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  const image = repo.setPrimaryImage(id, imageId);
  if (!image) return res.status(404).json({ errors: ['Image not found.'] });

  res.json({ image });
});

productsRouter.delete('/:id/images/:imageId', (req, res) => {
  const id = parseId(req.params.id);
  const imageId = parseId(req.params.imageId);
  if (id === null || imageId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  const deleted = repo.deleteProductImage(id, imageId);
  if (!deleted) return res.status(404).json({ errors: ['Image not found.'] });

  unlinkImageFile(deleted.url.replace(/^\//, ''));
  res.status(204).send();
});
