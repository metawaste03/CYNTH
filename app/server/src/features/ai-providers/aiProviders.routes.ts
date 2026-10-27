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
import { SUPPORTED_PROVIDER_TYPES, MODEL_PURPOSES, isValidPurpose, listPurposes } from './aiProviders.constants.js';
import { estimateProbeCost, validateModel } from './modelValidation.service.js';
import { addCapability, removeCapability } from './modelCapabilities.repository.js';

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

/**
 * What the settings UI may offer.
 *
 * `capabilities` carries a label and a description with each value, and says
 * whether any Cynth workflow actually routes to it yet — so the form can
 * offer a capability honestly rather than implying a pipeline that does not
 * exist. `purposes` is the bare value list, kept for older clients.
 */
aiProvidersRouter.get('/meta', (_req, res) => {
  res.json({
    providerTypes: SUPPORTED_PROVIDER_TYPES,
    purposes: MODEL_PURPOSES,
    capabilities: listPurposes(),
  });
});

aiProvidersRouter.get('/', (_req, res) => {
  res.json({ providers: repo.listProviders() });
});

/**
 * The models that may serve a task, across all active providers, with their
 * provider, cost class and capability set.
 *
 * PURPOSE FILTERING (Milestone 15). `?purpose=article_generation` returns
 * only the models registered to write articles; `?purpose=seo_review` returns
 * only the SEO reviewers. That separation is the point — the best article
 * model is not automatically the best SEO model, and offering every
 * registered model for every task hides that.
 *
 * Omitting the parameter returns everything, for screens whose job is to show
 * the whole registry.
 *
 * Exposes no credential — only whether one is stored, so a model that cannot
 * run can say why.
 */
aiProvidersRouter.get('/selectable-models', (req, res) => {
  const raw = req.query.purpose;
  if (raw !== undefined && raw !== '' && !isValidPurpose(raw)) {
    return res.status(400).json({ errors: [`purpose must be one of: ${MODEL_PURPOSES.join(', ')}.`] });
  }

  const purpose = typeof raw === 'string' && raw ? raw : null;
  res.json({ purpose, models: repo.listSelectableModels(purpose) });
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
    /**
     * VALIDATE, THEN SAVE — never the other way round.
     *
     * The registry's job is to hold configurations that work. A row written
     * before anything checked it is a promise Cynth has not kept, and the
     * cost of finding out is paid later, mid-article. So the pipeline runs
     * first and its result decides whether anything is written at all.
     */
    const validation = await validateModel({
      providerId: id,
      modelName: value!.modelName,
      allowLiveProbe: value!.confirmLiveTest,
    });

    if (!validation.ok) {
      return res.status(422).json({
        errors: [validation.message],
        code: validation.code,
        failedStage: validation.failedStage,
        stages: validation.stages,
        saved: false,
      });
    }

    const entry = validation.catalogEntry;
    if (!entry) {
      return res.status(404).json({
        errors: [
          `The provider’s catalogue does not list "${value!.modelName}". Refresh the catalogue, or add the model by hand if you know it is valid.`,
        ],
        saved: false,
      });
    }

    const result = repo.addModelFromCatalog(id, entry, {
      modelName: value!.modelName,
      displayName: value!.displayName,
      purposes: value!.purposes,
      isEnabled: value!.isEnabled,
      validation: { status: 'valid', code: null, message: validation.message },
    });
    if (!result) return res.status(404).json({ errors: ['Provider not found.'] });

    res.status(result.created ? 201 : 200).json({
      model: result.model,
      created: result.created,
      validation,
      message: result.created
        ? `${result.model.displayName || result.model.modelName} was validated and added to the model registry.`
        : `${result.model.displayName || result.model.modelName} was already registered — it was re-validated and its provider metadata refreshed, rather than added a second time.`,
    });
  } catch (error) {
    respondToCatalogError(res, error, 'Could not read the provider model catalogue.');
  }
});

/**
 * VALIDATE WITHOUT SAVING.
 *
 * The Add Model form calls this to check a configuration before committing to
 * it, and the model detail screen calls it to re-check one already saved.
 * Writes nothing either way.
 *
 * A validation failure is a 200 carrying ok:false, not an HTTP error: a
 * successful diagnosis of a broken configuration is not a failed request, and
 * the UI needs every stage regardless of the verdict.
 */
aiProvidersRouter.post('/:id/validate-model', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid provider id.'] });
  if (!repo.getProviderById(id)) return res.status(404).json({ errors: ['Provider not found.'] });

  const modelName = typeof req.body?.modelName === 'string' ? req.body.modelName.trim() : '';
  if (!modelName) return res.status(400).json({ errors: ['modelName is required.'] });

  try {
    const validation = await validateModel({
      providerId: id,
      modelName,
      allowLiveProbe: req.body?.confirmLiveTest === true,
    });
    res.json({ ...validation, estimatedProbeCost: estimateProbeCost(validation.catalogEntry) });
  } catch (error) {
    respondToCatalogError(res, error, 'Could not validate the model.');
  }
});

/**
 * TEST MODEL.
 *
 * Answers one question — does this model actually work right now? — and
 * deliberately does NOT write an article: the prompt is four words, the
 * output is capped at a handful of tokens, and the response text is thrown
 * away. What is kept is that the endpoint answered, the key authenticated,
 * the model ran, and the response parsed.
 *
 * COST. A free model is tested outright, because it cannot charge anything. A
 * paid or unpriced one requires `confirmLiveTest: true` in the body, and
 * without it this returns 402 with the estimated cost so the UI can warn
 * before asking again. Cynth never sends a chargeable request on its own
 * initiative.
 */
aiProvidersRouter.post('/:id/models/:modelId/test', async (req, res) => {
  const id = parseId(req.params.id);
  const modelId = parseId(req.params.modelId);
  if (id === null || modelId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  const model = repo.getModel(id, modelId);
  if (!model) return res.status(404).json({ errors: ['Model not found.'] });

  const confirmed = req.body?.confirmLiveTest === true;

  try {
    const validation = await validateModel({
      providerId: id,
      modelName: model.modelName,
      allowLiveProbe: confirmed,
    });

    // A paid model with no permission: report the cost and stop, rather than
    // recording a "test" that never contacted the model.
    if (validation.ok && !validation.liveProbeRan && !confirmed) {
      return res.status(402).json({
        ok: false,
        code: 'cost_confirmation_required',
        errors: [
          `${model.modelName} is a ${validation.costClass} model, so testing it sends a chargeable request. ` +
            `Confirm to run the test.`,
        ],
        costClass: validation.costClass,
        estimatedProbeCost: estimateProbeCost(validation.catalogEntry),
        stages: validation.stages,
        tested: false,
      });
    }

    const updated = repo.recordTestState(
      modelId,
      {
        status: validation.ok ? 'passed' : 'failed',
        mode: validation.liveProbeRan ? 'live' : 'catalog',
        message: validation.message,
      },
      validation.code,
    );

    res.json({
      ok: validation.ok,
      tested: true,
      model: updated,
      validation,
      estimatedProbeCost: estimateProbeCost(validation.catalogEntry),
    });
  } catch (error) {
    respondToCatalogError(res, error, 'Could not test the model.');
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

/**
 * Makes a model the system default for ONE of its capabilities.
 *
 * The purpose is required. A model that can write articles AND review SEO has
 * two independent default questions, and picking one on the user's behalf
 * would silently reassign a default they never touched.
 */
aiProvidersRouter.patch('/:id/models/:modelId/default', (req, res) => {
  const id = parseId(req.params.id);
  const modelId = parseId(req.params.modelId);
  if (id === null || modelId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  const purpose = req.body?.purpose;
  if (!isValidPurpose(purpose)) {
    return res.status(400).json({ errors: [`purpose must be one of: ${MODEL_PURPOSES.join(', ')}.`] });
  }

  const result = repo.setModelDefaultForPurpose(id, modelId, purpose);
  if (result.errors.length) {
    const status = result.errors[0] === 'Model not found.' ? 404 : 400;
    return res.status(status).json({ errors: result.errors });
  }

  res.json({ model: result.model });
});

/* --------------------------------------------------------- capabilities --- */

/** Adds one capability to a model without disturbing the others it holds. */
aiProvidersRouter.post('/:id/models/:modelId/capabilities', (req, res) => {
  const id = parseId(req.params.id);
  const modelId = parseId(req.params.modelId);
  if (id === null || modelId === null) return res.status(400).json({ errors: ['Invalid id.'] });
  if (!repo.getModel(id, modelId)) return res.status(404).json({ errors: ['Model not found.'] });

  const purpose = req.body?.purpose;
  if (!isValidPurpose(purpose)) {
    return res.status(400).json({ errors: [`purpose must be one of: ${MODEL_PURPOSES.join(', ')}.`] });
  }

  const result = addCapability(modelId, purpose);
  if (result.errors.length) return res.status(400).json({ errors: result.errors });

  res.json({ model: repo.getModel(id, modelId) });
});

/**
 * Removes one capability.
 *
 * If it was the system default for that purpose, the purpose is left with NO
 * default rather than having another model promoted into the role — Cynth
 * does not choose a model on the user's behalf.
 */
aiProvidersRouter.delete('/:id/models/:modelId/capabilities/:purpose', (req, res) => {
  const id = parseId(req.params.id);
  const modelId = parseId(req.params.modelId);
  if (id === null || modelId === null) return res.status(400).json({ errors: ['Invalid id.'] });
  if (!repo.getModel(id, modelId)) return res.status(404).json({ errors: ['Model not found.'] });

  if (!isValidPurpose(req.params.purpose)) {
    return res.status(400).json({ errors: [`purpose must be one of: ${MODEL_PURPOSES.join(', ')}.`] });
  }

  removeCapability(modelId, req.params.purpose);
  res.json({ model: repo.getModel(id, modelId) });
});

aiProvidersRouter.delete('/:id/models/:modelId', (req, res) => {
  const id = parseId(req.params.id);
  const modelId = parseId(req.params.modelId);
  if (id === null || modelId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  const deleted = repo.deleteModel(id, modelId);
  if (!deleted) return res.status(404).json({ errors: ['Model not found.'] });

  res.status(204).send();
});
