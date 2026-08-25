import { Router } from 'express';
import * as repo from './aiProviders.repository.js';
import { validateProviderInput, validateModelInput } from './aiProviders.validation.js';
import { SUPPORTED_PROVIDER_TYPES, MODEL_PURPOSES } from './aiProviders.constants.js';

export const aiProvidersRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

aiProvidersRouter.get('/meta', (_req, res) => {
  res.json({ providerTypes: SUPPORTED_PROVIDER_TYPES, purposes: MODEL_PURPOSES });
});

aiProvidersRouter.get('/', (_req, res) => {
  res.json({ providers: repo.listProviders() });
});

aiProvidersRouter.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  const provider = repo.getProviderById(id);
  if (!provider) return res.status(404).json({ errors: ['Provider not found.'] });

  res.json({ provider });
});

aiProvidersRouter.post('/', (req, res) => {
  const { errors, value } = validateProviderInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const provider = repo.createProvider(value!);
  res.status(201).json({ provider });
});

aiProvidersRouter.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  const { errors, value } = validateProviderInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const provider = repo.updateProvider(id, value!);
  if (!provider) return res.status(404).json({ errors: ['Provider not found.'] });

  res.json({ provider });
});

aiProvidersRouter.patch('/:id/status', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });
  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({ errors: ['isActive must be true or false.'] });
  }

  const provider = repo.setProviderActiveStatus(id, req.body.isActive);
  if (!provider) return res.status(404).json({ errors: ['Provider not found.'] });

  res.json({ provider });
});

aiProvidersRouter.patch('/:id/default', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  const provider = repo.setDefaultProvider(id);
  if (!provider) return res.status(404).json({ errors: ['Provider not found.'] });

  res.json({ provider });
});

aiProvidersRouter.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  const deleted = repo.deleteProvider(id);
  if (!deleted) return res.status(404).json({ errors: ['Provider not found.'] });

  res.status(204).send();
});

/** Per Milestone 8: no external call — just the placeholder message. */
aiProvidersRouter.post('/:id/test-connection', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  const provider = repo.getProviderById(id);
  if (!provider) return res.status(404).json({ errors: ['Provider not found.'] });

  res.json({ message: 'Connection testing will be implemented in a future milestone.' });
});

aiProvidersRouter.post('/:id/models', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  const { errors, value } = validateModelInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const model = repo.addModel(id, value!);
  if (!model) return res.status(404).json({ errors: ['Provider not found.'] });

  res.status(201).json({ model });
});

aiProvidersRouter.put('/:id/models/:modelId', (req, res) => {
  const id = parseId(req.params.id);
  const modelId = parseId(req.params.modelId);
  if (id === null || modelId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  const { errors, value } = validateModelInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const model = repo.updateModel(id, modelId, value!);
  if (!model) return res.status(404).json({ errors: ['Model not found.'] });

  res.json({ model });
});

aiProvidersRouter.patch('/:id/models/:modelId/status', (req, res) => {
  const id = parseId(req.params.id);
  const modelId = parseId(req.params.modelId);
  if (id === null || modelId === null) return res.status(400).json({ errors: ['Invalid id.'] });
  if (typeof req.body?.isEnabled !== 'boolean') {
    return res.status(400).json({ errors: ['isEnabled must be true or false.'] });
  }

  const model = repo.setModelEnabled(id, modelId, req.body.isEnabled);
  if (!model) return res.status(404).json({ errors: ['Model not found.'] });

  res.json({ model });
});

aiProvidersRouter.patch('/:id/models/:modelId/default', (req, res) => {
  const id = parseId(req.params.id);
  const modelId = parseId(req.params.modelId);
  if (id === null || modelId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  const result = repo.setModelDefaultForPurpose(id, modelId);
  if (result.errors.length) {
    const status = result.errors[0] === 'Model not found.' ? 404 : 400;
    return res.status(status).json({ errors: result.errors });
  }

  res.json({ model: result.model });
});

aiProvidersRouter.delete('/:id/models/:modelId', (req, res) => {
  const id = parseId(req.params.id);
  const modelId = parseId(req.params.modelId);
  if (id === null || modelId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  const deleted = repo.deleteModel(id, modelId);
  if (!deleted) return res.status(404).json({ errors: ['Model not found.'] });

  res.status(204).send();
});
