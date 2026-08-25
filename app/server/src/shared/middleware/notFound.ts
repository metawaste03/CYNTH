import type { Request, Response } from 'express';

/** Catch-all for unmatched routes. No business logic — just a clean 404 shape. */
export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
}
