import { Router } from 'express';
import { routeForPurpose } from './modelRouter.service.js';

export const modelRouterRouter = Router();

/** GET /api/model-router?purpose=article_generation — returns configuration only, contacts nothing. */
modelRouterRouter.get('/', (req, res) => {
  const purpose = typeof req.query.purpose === 'string' ? req.query.purpose : '';
  const result = routeForPurpose(purpose);

  if ('errors' in result) {
    return res.status(400).json({ errors: result.errors });
  }

  res.json(result);
});
