export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Access Request Service',
    version: '1.0.0',
    description:
      'Internal service for managing application access requests. Employees submit requests and approvers approve or deny them.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http' as const,
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      AccessRequest: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', format: 'uuid' },
          employeeId: { type: 'string' },
          employeeName: { type: 'string' },
          application: { type: 'string' },
          reason: { type: 'string' },
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'DENIED'] },
          createdBy: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          decisionBy: { type: 'string', nullable: true },
          decisionAt: { type: 'string', format: 'date-time', nullable: true },
          decisionNote: { type: 'string', nullable: true },
        },
      },
      Page: {
        type: 'object' as const,
        properties: {
          nextCursor: { type: 'string', nullable: true },
          limit: { type: 'integer' },
        },
      },
      ErrorResponse: {
        type: 'object' as const,
        properties: {
          error: {
            type: 'object' as const,
            properties: {
              message: { type: 'string' },
              code: { type: 'string' },
              details: { type: 'array', items: { type: 'object' } },
            },
            required: ['message'],
          },
        },
      },
      MockUser: {
        type: 'object' as const,
        properties: {
          userId: { type: 'string' },
          userName: { type: 'string' },
          role: { type: 'string', enum: ['REQUESTER', 'APPROVER'] },
        },
      },
      AgentEvaluation: {
        type: 'object' as const,
        properties: {
          queryUnderstood: { type: 'boolean' },
          hadRelevantData: { type: 'boolean' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
      AgentResponse: {
        type: 'object' as const,
        properties: {
          answer: { type: 'string' },
          provider: { type: 'string', enum: ['openai', 'mock'] },
          evaluation: { $ref: '#/components/schemas/AgentEvaluation' },
          cached: { type: 'boolean' },
        },
      },
    },
  },
  paths: {
    '/api/auth/token': {
      post: {
        tags: ['Auth'],
        summary: 'Get a JWT token for a mock user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                required: ['userId'],
                properties: {
                  userId: { type: 'string', example: 'employee-1' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Token generated',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    token: { type: 'string' },
                    expiresIn: { type: 'string', example: '24h' },
                    usage: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid or unknown userId',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/auth/users': {
      get: {
        tags: ['Auth'],
        summary: 'List available mock users',
        responses: {
          '200': {
            description: 'List of mock users',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    users: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/MockUser' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/requests': {
      post: {
        tags: ['Requests'],
        summary: 'Create an access request (REQUESTER only)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            in: 'header' as const,
            name: 'Idempotency-Key',
            required: true,
            schema: { type: 'string' },
            description: 'Unique key for idempotent request creation',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                required: ['application', 'reason'],
                properties: {
                  application: { type: 'string', example: 'Jira' },
                  reason: {
                    type: 'string',
                    example: 'Need project tracking',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Request created',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    data: { $ref: '#/components/schemas/AccessRequest' },
                  },
                },
              },
            },
          },
          '200': {
            description: 'Idempotent retry — existing request returned',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    data: { $ref: '#/components/schemas/AccessRequest' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '409': {
            description: 'Duplicate pending request or idempotency key conflict',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      get: {
        tags: ['Requests'],
        summary:
          'List access requests (REQUESTER sees own; APPROVER can filter)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            in: 'query' as const,
            name: 'status',
            schema: {
              type: 'string',
              enum: ['PENDING', 'APPROVED', 'DENIED'],
            },
          },
          {
            in: 'query' as const,
            name: 'userId',
            schema: { type: 'string' },
            description: 'APPROVER only — filter by employee ID',
          },
          {
            in: 'query' as const,
            name: 'limit',
            schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          },
          {
            in: 'query' as const,
            name: 'cursor',
            schema: { type: 'string' },
            description: 'Opaque cursor from previous page',
          },
        ],
        responses: {
          '200': {
            description: 'Paginated list of requests',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/AccessRequest' },
                    },
                    page: { $ref: '#/components/schemas/Page' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'REQUESTER tried to use userId filter',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/requests/{id}': {
      get: {
        tags: ['Requests'],
        summary: 'Get a single access request by ID',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            in: 'path' as const,
            name: 'id',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Request details',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    data: { $ref: '#/components/schemas/AccessRequest' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid UUID',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: "REQUESTER accessing another user's request",
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Request not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/requests/{id}/decision': {
      patch: {
        tags: ['Requests'],
        summary: 'Approve or deny a pending request (APPROVER only)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            in: 'path' as const,
            name: 'id',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                required: ['decision'],
                properties: {
                  decision: {
                    type: 'string',
                    enum: ['APPROVED', 'DENIED'],
                  },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Decision recorded',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    data: { $ref: '#/components/schemas/AccessRequest' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Request not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '409': {
            description: 'Request already decided',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/agent/query': {
      post: {
        tags: ['Agent'],
        summary: 'Ask the AI agent a question about access requests',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                required: ['query'],
                properties: {
                  query: {
                    type: 'string',
                    example: 'Summarize current request activity',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Agent response',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    data: { $ref: '#/components/schemas/AgentResponse' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '429': {
            description: 'Rate limit exceeded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
