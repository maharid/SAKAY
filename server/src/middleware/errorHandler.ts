import type { ErrorRequestHandler, RequestHandler } from 'express';
import { CorsDeniedError, isProduction } from './security';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
};

/**
 * Last-resort error handler. The full error goes to the server log; the client gets a generic message in production
 * (a message from a library or the database must not reach a browser).
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) { next(err); return; }
  const e = err as { type?: string; status?: number; statusCode?: number; message?: string; stack?: string };

  if (err instanceof CorsDeniedError) {
    res.status(403).json({ success: false, error: 'This origin is not allowed.' });
    return;
  }
  if (e.type === 'entity.too.large') {
    res.status(413).json({ success: false, error: 'The request is too large.' });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ success: false, error: 'The request body is not valid JSON.' });
    return;
  }
  if (e.type === 'entity.parse.failed' || e.type === 'encoding.unsupported' || e.type === 'charset.unsupported') {
    res.status(400).json({ success: false, error: 'The request body could not be read.' });
    return;
  }

  console.error('[Server Error]:', e.stack ?? e.message ?? err);
  res.status(500).json({
    success: false,
    error: isProduction() ? 'Internal Server Error' : e.message || 'Internal Server Error',
  });
};
