import type { Request, Response } from 'express';

/**
 * Catch-all for unmatched routes.
 *
 * Answers with the same `errors: string[]` shape every other endpoint uses,
 * so the client's ApiError reports a real message instead of falling back to
 * a generic one. This matters most once Express also serves the built client
 * (Milestone 13): a mistyped API path must come back as JSON saying so, never
 * as the app's HTML shell, which a fetch() would then fail to parse with an
 * error that has nothing to do with the actual problem.
 *
 * `error` and `path` are kept alongside it for anything already reading them.
 */
export function notFound(req: Request, res: Response) {
  res.status(404).json({
    errors: [`No such endpoint: ${req.method} ${req.originalUrl}`],
    error: 'Not found',
    path: req.originalUrl,
  });
}
