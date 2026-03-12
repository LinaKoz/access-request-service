import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

/**
 * Logs each request after the response is sent.
 * Records method, path, status code, duration, and userId (if authenticated).
 *
 * @param req - Express request
 * @param res - Express response (attaches 'finish' listener)
 * @param next - Calls next middleware immediately; logging occurs on res.finish
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    logger.info({
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      userId: req.user?.userId,
    });
  });

  next();
}
