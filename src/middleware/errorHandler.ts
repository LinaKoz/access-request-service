import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { logger } from '../config/logger';

/**
 * Central error handler. Registers last in the middleware stack to catch all errors.
 * Maps AppError → statusCode + code, ZodError → 400 with details, others → 500.
 * Sends JSON response and does not call next().
 *
 * @param err - Error thrown from upstream middleware/handlers
 * @param _req - Express request
 * @param res - Express response (sends error JSON)
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    logger.warn({ statusCode: err.statusCode, code: err.code }, err.message);
    res.status(err.statusCode).json({
      error: { message: err.message, code: err.code },
    });
    return;
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    logger.warn({ details }, 'Validation error');
    res.status(400).json({
      error: { message: 'Validation error', code: 'VALIDATION_ERROR', details },
    });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
  });
}
