import { Router } from 'express';
import { isGenerationError } from '../generation/generation.errors.js';
import { getProductById } from '../products/products.repository.js';
import { listResearchForProduct } from './productResearch.repository.js';
import { parseProductUrl, preflightUrl, ProductRetrievalError, retrieveProduct } from './productRetrieval.service.js';
import { getProductResearchPreflight, researchProduct } from './productUnderstanding.service.js';
import { getPlacementReviewPreflight, reviewProductPlacements } from '../seo/productPlacementReview.service.js';
import {
  attachProduct,
  detachProduct,
  listArticleProducts,
} from '../articles/articleProducts.repository.js';

/**
 * PRODUCT RESEARCH — HTTP surface (Milestone 17).
 *
 * Three groups of endpoint, in the order the workflow uses them:
 *
 *   1. /check and /retrieve — is this URL readable, and read it.
 *   2. /:id/research — work out what the product is for. The only one that
 *      can cost money, and it goes through the same preflight/confirm pair
 *      that article generation and SEO analysis use.
 *   3. /articles/:articleId/products — which products an article carries.
 *
 * No endpoint here writes an article, and none modifies an affiliate link.
 */
export const productResearchRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Translates the two error vocabularies this feature can raise into one HTTP shape. */
function sendError(res: Parameters<Parameters<typeof productResearchRouter.get>[1]>[1], error: unknown): void {
  if (error instanceof ProductRetrievalError) {
    res.status(400).json({
      errors: [error.message],
      code: error.code,
      remedy: error.remedy,
      retryable: error.code === 'retrieval_failed',
    });
    return;
  }
  if (isGenerationError(error)) {
    res.status(400).json({ errors: [error.message], code: error.code, retryable: error.retryable });
    return;
  }
  res.status(500).json({ errors: [error instanceof Error ? error.message : 'Unexpected error.'] });
}

/* ------------------------------------------------------------ retrieval --- */

/**
 * Whether Cynth may read a URL, answered before anything is fetched from the
 * page itself. Free, and the honest place to discover that a domain is not
 * authorised.
 */
productResearchRouter.post('/check', async (req, res) => {
  try {
    const url = parseProductUrl(req.body?.url, 'The product URL');
    res.json({ preflight: await preflightUrl(url) });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Reads one product page and creates or updates a product from the metadata
 * it publishes. Calls no model and costs nothing.
 */
productResearchRouter.post('/retrieve', async (req, res) => {
  try {
    const url = parseProductUrl(req.body?.url, 'The product URL');
    const productId = req.body?.productId === undefined || req.body?.productId === null
      ? null
      : parseId(String(req.body.productId));

    if (req.body?.productId !== undefined && req.body?.productId !== null && productId === null) {
      return res.status(400).json({ errors: ['productId must be a positive whole number.'] });
    }

    const result = await retrieveProduct({
      url,
      // The user's link. Passed straight through; nothing between here and
      // storage alters it.
      affiliateUrl: typeof req.body?.affiliateUrl === 'string' ? req.body.affiliateUrl : null,
      productId,
      editorialNote: typeof req.body?.editorialNote === 'string' ? req.body.editorialNote : null,
    });

    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    sendError(res, error);
  }
});

/* --------------------------------------------------------- understanding --- */

productResearchRouter.get('/:id/research/preflight', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid product id.'] });

  const modelIdRaw = req.query.modelId;
  const modelId = typeof modelIdRaw === 'string' && modelIdRaw ? Number(modelIdRaw) : null;
  res.json({ preflight: getProductResearchPreflight(id, Number.isInteger(modelId) ? modelId : null) });
});

/**
 * Works out what a product is for.
 *
 * `confirmedCost` is read from the body and never defaulted to true — the
 * same rule article generation and SEO analysis follow.
 */
productResearchRouter.post('/:id/research', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid product id.'] });

  try {
    const outcome = await researchProduct(id, {
      confirmedCost: req.body?.confirmedCost === true,
      modelId: Number.isInteger(Number(req.body?.modelId)) && Number(req.body.modelId) > 0 ? Number(req.body.modelId) : null,
    });
    res.json({ ...outcome, product: getProductById(id) });
  } catch (error) {
    sendError(res, error);
  }
});

/** The audit trail: every research pass over one product, newest first. */
productResearchRouter.get('/:id/research', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ errors: ['Invalid product id.'] });

  const product = getProductById(id);
  if (!product) return res.status(404).json({ errors: ['Product not found.'] });

  res.json({ product, research: listResearchForProduct(id) });
});

/* ------------------------------------------------------ placement review --- */

productResearchRouter.get('/articles/:articleId/placement-review/preflight', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const modelIdRaw = req.query.modelId;
  const modelId = typeof modelIdRaw === 'string' && modelIdRaw ? Number(modelIdRaw) : null;
  res.json({ preflight: getPlacementReviewPreflight(articleId, Number.isInteger(modelId) ? modelId : null) });
});

/**
 * Reviews where the products in this article ended up.
 *
 * A review, not an edit: it writes verdicts and suggestions, and never moves
 * a product or touches the article body. `confirmedCost` is never defaulted
 * to true.
 */
productResearchRouter.post('/articles/:articleId/placement-review', async (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  try {
    const outcome = await reviewProductPlacements(articleId, {
      confirmedCost: req.body?.confirmedCost === true,
      modelId:
        Number.isInteger(Number(req.body?.modelId)) && Number(req.body.modelId) > 0 ? Number(req.body.modelId) : null,
    });
    res.json(outcome);
  } catch (error) {
    sendError(res, error);
  }
});

/* ----------------------------------------------------- article products --- */

productResearchRouter.get('/articles/:articleId/products', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const attached = listArticleProducts(articleId).map((row) => ({
    ...row,
    product: getProductById(row.productId),
  }));
  res.json({ products: attached });
});

productResearchRouter.post('/articles/:articleId/products', (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId === null) return res.status(400).json({ errors: ['Invalid draft id.'] });

  const productId = parseId(String(req.body?.productId));
  if (productId === null) return res.status(400).json({ errors: ['productId is required.'] });

  const result = attachProduct(articleId, {
    productId,
    editorialNote: typeof req.body?.editorialNote === 'string' ? req.body.editorialNote : null,
  });
  if ('error' in result) return res.status(400).json({ errors: [result.error] });

  res.status(201).json({ attached: result, product: getProductById(productId) });
});

productResearchRouter.delete('/articles/:articleId/products/:productId', (req, res) => {
  const articleId = parseId(req.params.articleId);
  const productId = parseId(req.params.productId);
  if (articleId === null || productId === null) return res.status(400).json({ errors: ['Invalid id.'] });

  if (!detachProduct(articleId, productId)) {
    return res.status(404).json({ errors: ['That product is not attached to this draft.'] });
  }
  res.status(204).end();
});
