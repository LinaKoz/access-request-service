import { createGraphQLError, createSchema, createYoga } from 'graphql-yoga';
import { resolvers } from './resolvers';
import { buildContext } from './context';

const typeDefs = /* GraphQL */ `
  enum RequestStatus {
    PENDING
    APPROVED
    DENIED
  }

  type AccessRequest {
    id: ID!
    employeeId: String!
    employeeName: String!
    application: String!
    reason: String!
    status: RequestStatus!
    createdBy: String!
    createdAt: String!
    updatedAt: String!
    decisionBy: String
    decisionAt: String
    decisionNote: String
  }

  type PageInfo {
    nextCursor: String
    limit: Int!
  }

  type RequestConnection {
    data: [AccessRequest!]!
    page: PageInfo!
  }

  type AgentEvaluation {
    queryUnderstood: Boolean!
    hadRelevantData: Boolean!
    score: Int!
  }

  type AgentResponse {
    answer: String!
    provider: String!
    evaluation: AgentEvaluation!
    degraded: Boolean
    degradedReason: String
  }

  type Query {
    requests(status: RequestStatus, userId: String, limit: Int, cursor: String): RequestConnection!
    request(id: ID!): AccessRequest!
    agentQuery(query: String!): AgentResponse!
  }

  enum DecisionInput {
    APPROVED
    DENIED
  }

  type Mutation {
    createRequest(application: String!, reason: String!, idempotencyKey: String!): AccessRequest!
    decideRequest(id: ID!, decision: DecisionInput!, note: String): AccessRequest!
  }
`;

const schema = createSchema({ typeDefs, resolvers });

// Application-level error codes set by mapAppError / requireAuth / requireRole.
// Errors carrying one of these codes are intentional and safe to expose.
const APP_ERROR_CODES = new Set([
  'BAD_USER_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
]);

export const yoga = createYoga({
  schema,
  context: ({ request }) => buildContext(request),
  graphqlEndpoint: '/graphql',
  // Mask unexpected errors by default; intentional GraphQLErrors (from
  // mapAppError, requireAuth, requireRole) pass through with their
  // message + extensions intact.
  maskedErrors: {
    maskError(error, message) {
      // Duck-type: check extensions.code directly (avoids ESM/CJS instanceof mismatch)
      const code = (error as any)?.extensions?.code as string | undefined;
      if (code && APP_ERROR_CODES.has(code)) return error as Error;

      return createGraphQLError(message, {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    },
  },
});
