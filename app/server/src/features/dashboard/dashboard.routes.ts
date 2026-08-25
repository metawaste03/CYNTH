import { Router } from 'express';
import { getDashboardSummary } from './dashboard.repository.js';

export const dashboardRouter = Router();

dashboardRouter.get('/summary', (_req, res) => {
  res.json(getDashboardSummary());
});
