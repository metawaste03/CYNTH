import type { NextFunction, Request, Response } from 'express';

/** Generic last-resort error handler. No logging/reporting integration yet — foundation only. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
