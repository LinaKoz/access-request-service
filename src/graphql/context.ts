import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser } from '../middleware/auth';

export interface GraphQLContext {
  user: AuthUser | null;
}

/**
 * Extracts and verifies the Bearer JWT from the Authorization header.
 * Returns { user } for authenticated requests, { user: null } otherwise.
 * Resolvers enforce auth requirements individually.
 */
export function buildContext(request: Request): GraphQLContext {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return { user: null };
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser;
    return {
      user: {
        userId: payload.userId,
        userName: payload.userName,
        role: payload.role,
      },
    };
  } catch {
    return { user: null };
  }
}
