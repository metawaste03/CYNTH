import { Router } from 'express';
import * as repo from './aiProviders.repository.js';
import {
  discoverModels,
  findCatalogModel,
  invalidateCatalogCache,
  isValidCatalogFilter,
  refreshProviderModels,
} from './modelCatalog.service.js';
import { isGenerationError } from '../generation/generation.errors.js';
import { validateProviderInput, validateModelInput, validateCatalogModelInput } from './aiProviders.validation.js';
import { SUPPORTED_PROVIDER_TYPES, MODEL_PURPOSES } from './aiProviders.constants.js';

export const aiProvidersRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Turns anything the catalogue layer throws into a response, without leaking provider internals. */
function respondToCatalogError(res: import('express').Response, error: unknown, fallback: string): void {
  if (isGenerationError(error)) {
    res.status(error.httpStatus).json({ errors: [error.message], code: error.code });
    return;
  }
  console.error(`${fallback}:`, error);
  res.status(502).json({ errors: [fallback] });
}

aiProvidersRouter.get('/meta', (_req, res) => {
  res.json({ providerTypes: SUPPORTED_PROVIDER_TYPES, purposes: MODEL_PURPOSES });
});

aiProvidersRouter.get('/', (_req, res) => {
  res.json({ providers: repo.listProviders() });
});

/**
 * Every model that could serve a generation task, across all active
 * providers, with its provider and cost class.
 *
 * This is what the New Article workflow's model picker reads. It exposes no
 * credential — only whether one is stored, so a model that cannot run can say
 * why.
 */
aiProvidersRouter.get('/selectable-models', (_req, res) => {
  res.json({ models: repo.listSelectableModels() });
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

  // The base URL or the key may have changed, so anything cached under the
  // old ones is no longer trustworthy.
  invalidateCatalogCache(id);
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

  invalidateCatalogCache(id);
  res.status(204).send();
});

/**
 * Verifies Cynth can actually reach and authenticate with the provider, by
 * reading its model catalogue.
 *
 * A metadata read: it generates nothing and costs nothing. Deliberately not a
 * tiny test generation — that would be a real, billable request, and a
 * "connection test" must never be able to charge anyone.
 */
aiProvidersRouter.post('/:id/test-connection', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  const provider = repo.getProviderById(id);
  if (!provider) return res.status(404).json({ errors: ['Provider not found.'] });

  try {
    const result = await discoverModels(id, { refresh: true, limit: 1 });
    res.json({
      ok: true,
      message:
        `Connected to ${provider.name}. Its catalogue lists ${result.total} model(s): ` +
        `${result.counts.free} free, ${result.counts.paid} paid, ${result.counts.unknown} with no published pricing.`,
      catalogSize: result.total,
      counts: result.counts,
    });
  } catch (error) {
    if (isGenerationError(error)) {
      return res.status(error.httpStatus).json({ ok: false, errors: [error.message], code: error.code });
    }
    console.error('Provider connection test failed:', error);
    res.status(502).json({ ok: false, errors: ['Could not reach the provider.'] });
  }
});

/* ------------------------------------------------------- model discovery --- */

/**
 * MODEL DISCOVERY — the provider's live catalogue.
 *
 * GET /api/ai-providers/:id/catalog?filter=free&search=claude&refresh=true
 *
 * `filter` is free / paid / unknown / all, decided from published pricing and
 * never from a model's name. Cynth holds no hardcoded model list; everything
 * this returns came from the provider a moment ago.
 */
aiProvidersRouter.get('/:id/catalog', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  const filter = req.query.filter ?? 'all';
  if (!isValidCatalogFilter(filter)) {
    return res.status(400).json({ errors: ['filter must be one of: all, free, paid, unknown.'] });
  }

  const limit = Number(req.query.limit);
  const offset = Number(req.query.offset);

  try {
    const result = await discoverModels(id, {
      filter,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      refresh: req.query.refresh === 'true',
      limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
      offset: Number.isInteger(offset) && offset >= 0 ? offset : undefined,
    });
    res.json(result);
  } catch (error) {
    respondToCatalogError(res, error, 'Could not read the provider model catalogue.');
  }
});

/**
 * One catalogue entry in full — the "inspect" step between discovering a
 * model and adding it.
 *
 * The model id arrives as a query parameter rather than a path segment
 * because catalogue ids contain slashes (`anthropic/claude-sonnet-4.5`), and
 * a path segment would have to be double-encoded to survive the router.
 */
aiProvidersRouter.get('/:id/catalog-entry', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  const modelId = typeof req.query.modelId === 'string' ? req.query.modelId.trim() : '';
  if (!modelId) return res.status(400).json({ errors: ['modelId is required.'] });

  try {
    const model = await findCatalogModel(id, modelId);
    if (!model) return res.status(404).json({ errors: ['The provider’s catalogue no longer lists that model.'] });
    res.json({ model });
  } catch (error) {
    respondToCatalogError(res, error, 'Could not read the provider model catalogue.');
  }
});

/**
 * CATALOGUE REFRESH.
 *
 * Re-reads the catalogue and updates the provider-published metadata on every
 * registered model — pricing above all. User configuration (purpose, enabled
 * state, default-for-purpose) is preserved untouched.
 */
aiProvidersRouter.post('/:id/sync-models', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  try {
    const result = await refreshProviderModels(id);
    res.json(result);
  } catch (error) {
    respondToCatalogError(res, error, 'Could not read the provider model catalogue.');
  }
});

/**
 * ADD MODEL — saves a catalogue entry into Cynth's model registry.
 *
 * The pricing and capability metadata are taken from the provider's own
 * catalogue at this moment, never from the request body: the client names a
 * model, it does not get to assert what that model costs.
 *
 * Re-adding a model already in the registry refreshes it in place rather than
 * creating a duplicate.
 */
aiProvidersRouter.post('/:id/models/from-catalog', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });

  const { errors, value } = validateCatalogModelInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  try {
    const entry = await findCatalogModel(id, value!.modelName);
    if (!entry) {
      return res.status(404).json({
        errors: [
          `The provider’s catalogue does not list "${value!.modelName}". Refresh the catalogue, or add the model by hand if you know it is valid.`,
        ],
      });
    }

    const result = repo.addModelFromCatalog(id, entry, value!);
    if (!result) return res.status(404).json({ errors: ['Provider not found.'] });

    res.status(result.created ? 201 : 200).json({
      model: result.model,
      created: result.created,
      message: result.created
        ? `${result.model.displayName || result.model.modelName} was added to the model registry.`
        : `${result.model.displayName || result.model.modelName} was already registered — its provider metadata was refreshed instead of adding a duplicate.`,
    });
  } catch (error) {
    respondToCatalogError(res, error, 'Could not read the provider model catalogue.');
  }
});

/* ------------------------------------------------------------ model CRUD --- */

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
