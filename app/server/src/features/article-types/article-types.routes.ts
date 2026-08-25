import { Router } from 'express';
import { listArticleTypes } from './article-types.repository.js';

export const articleTypesRouter = Router();

articleTypesRouter.get('/', (_req, res) => {
  res.json({ articleTypes: listArticleTypes() });
});
