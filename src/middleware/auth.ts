import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from '../errors/AppError';

export interface AuthUser {
  userId: string;
  userName: string;
  role: 'REQUESTER' | 'APPROVER';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Validates Bearer JWT and populates req.user.
 * Must run before routes that require authentication.
 *
 * @throws {AppError} 401 - Missing/invalid Authorization header or invalid/expired token
 * @sideEffect Sets req.user with userId, userName, role
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing or invalid Authorization header');
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser;
    req.user = {
      userId: payload.userId,
      userName: payload.userName,
      role: payload.role,
    };
    next();
  } catch {
    throw AppError.unauthorized('Invalid or expired token');
  }
}

/**
 * Factory that returns middleware enforcing req.user.role is one of the allowed roles.
 * Requires authenticate to run first so req.user is set.
 *
 * @param roles - Allowed roles (e.g. 'REQUESTER', 'APPROVER')
 * @returns Middleware
 * @throws {AppError} 403 - req.user missing or role not in allowed list
 */
export function requireRole(...roles: AuthUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw AppError.forbidden('Insufficient permissions');
    }
    next();
  };
}
