import { GraphQLError } from 'graphql';
import { ZodError } from 'zod';
import { GraphQLContext } from './context';
import { AppError } from '../errors/AppError';
import * as requestService from '../modules/requests/request.service';
import * as agentService from '../agent/agent.service';
import { AuthUser } from '../middleware/auth';

function requireAuth(ctx: GraphQLContext): AuthUser {
  if (!ctx.user) {
    throw new GraphQLError('Missing or invalid Authorization header', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  return ctx.user;
}

function requireRole(user: AuthUser, ...roles: AuthUser['role'][]) {
  if (!roles.includes(user.role)) {
    throw new GraphQLError('Insufficient permissions', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

/** Maps AppError / ZodError to GraphQLError with the appropriate extension code. */
function mapAppError(err: unknown): never {
  if (err instanceof GraphQLError) throw err;

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new GraphQLError('Validation error', {
      extensions: { code: 'BAD_USER_INPUT', details },
    });
  }

  if (err instanceof AppError) {
    const codeMap: Record<number, string> = {
      400: 'BAD_USER_INPUT',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
    };
    throw new GraphQLError(err.message, {
      extensions: { code: codeMap[err.statusCode] ?? 'INTERNAL_SERVER_ERROR' },
    });
  }

  throw new GraphQLError('Internal server error', {
    extensions: { code: 'INTERNAL_SERVER_ERROR' },
  });
}

interface RequestsArgs {
  status?: string;
  userId?: string;
  limit?: number;
  cursor?: string;
}

interface CreateRequestArgs {
  application: string;
  reason: string;
  idempotencyKey: string;
}

interface DecideRequestArgs {
  id: string;
  decision: 'APPROVED' | 'DENIED';
  note?: string;
}

export const resolvers = {
  Query: {
    requests: async (_: unknown, args: RequestsArgs, ctx: GraphQLContext) => {
      const user = requireAuth(ctx);
      try {
        return await requestService.listRequests(
          {
            status: args.status as any,
            userId: args.userId,
            limit: args.limit ?? 20,
            cursor: args.cursor,
          },
          user,
        );
      } catch (err) {
        mapAppError(err);
      }
    },

    request: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      const user = requireAuth(ctx);
      try {
        return await requestService.getRequestById(args.id, user);
      } catch (err) {
        mapAppError(err);
      }
    },

    agentQuery: async (_: unknown, args: { query: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      try {
        return await agentService.handleQuery(args.query);
      } catch (err) {
        mapAppError(err);
      }
    },
  },

  Mutation: {
    createRequest: async (_: unknown, args: CreateRequestArgs, ctx: GraphQLContext) => {
      const user = requireAuth(ctx);
      requireRole(user, 'REQUESTER');
      try {
        const result = await requestService.createAccessRequest(
          { application: args.application, reason: args.reason },
          user,
          args.idempotencyKey,
        );
        return result.data;
      } catch (err) {
        mapAppError(err);
      }
    },

    decideRequest: async (_: unknown, args: DecideRequestArgs, ctx: GraphQLContext) => {
      const user = requireAuth(ctx);
      requireRole(user, 'APPROVER');
      try {
        return await requestService.decideRequest(
          args.id,
          { decision: args.decision, note: args.note },
          user,
        );
      } catch (err) {
        mapAppError(err);
      }
    },
  },
};
