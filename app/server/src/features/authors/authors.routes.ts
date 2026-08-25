import { Router } from 'express';
import * as repo from './authors.repository.js';
import { validateAuthorInput, validateSampleInput } from './authors.validation.js';

export const authorsRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

authorsRouter.get('/', (req, res) => {
  const { search, category, status } = req.query;
  const authors = repo.listAuthors({
    search: typeof search === 'string' ? search : undefined,
    category: typeof category === 'string' ? category : undefined,
    status: status === 'active' || status === 'inactive' ? status : undefined,
  });
  res.json({ authors });
});

authorsRouter.get('/meta/categories', (_req, res) => {
  res.json({ categories: repo.listDistinctCategories() });
});

authorsRouter.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid author id.'] });

  const author = repo.getAuthorById(id);
  if (!author) return res.status(404).json({ errors: ['Author not found.'] });

  res.json({ author });
});

authorsRouter.post('/', (req, res) => {
  const { errors, value } = validateAuthorInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const author = repo.createAuthor(value!);
  res.status(201).json({ author });
});

authorsRouter.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid author id.'] });

  const { errors, value } = validateAuthorInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const author = repo.updateAuthor(id, value!);
  if (!author) return res.status(404).json({ errors: ['Author not found.'] });

  res.json({ author });
});

authorsRouter.patch('/:id/status', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid author id.'] });

  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({ errors: ['isActive must be true or false.'] });
  }

  const author = repo.setAuthorActiveStatus(id, req.body.isActive);
  if (!author) return res.status(404).json({ errors: ['Author not found.'] });

  res.json({ author });
});

authorsRouter.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid author id.'] });

  const deleted = repo.deleteAuthor(id);
  if (!deleted) return res.status(404).json({ errors: ['Author not found.'] });

  res.status(204).send();
});

authorsRouter.post('/:id/samples', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid author id.'] });

  const { errors, value } = validateSampleInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const sample = repo.addWritingSample(id, value!);
  if (!sample) return res.status(404).json({ errors: ['Author not found.'] });

  res.status(201).json({ sample });
});

authorsRouter.put('/:id/samples/:sampleId', (req, res) => {
  const id = parseId(req.params.id);
  const sampleId = parseId(req.params.sampleId);
  if (id === null || sampleId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  const { errors, value } = validateSampleInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const sample = repo.updateWritingSample(id, sampleId, value!);
  if (!sample) return res.status(404).json({ errors: ['Writing sample not found.'] });

  res.json({ sample });
});

authorsRouter.delete('/:id/samples/:sampleId', (req, res) => {
  const id = parseId(req.params.id);
  const sampleId = parseId(req.params.sampleId);
  if (id === null || sampleId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  const deleted = repo.deleteWritingSample(id, sampleId);
  if (!deleted) return res.status(404).json({ errors: ['Writing sample not found.'] });

  res.status(204).send();
});
