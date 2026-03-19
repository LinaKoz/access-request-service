# Access Request Service

An internal service for managing application access requests. Employees submit requests for application access, and approvers approve or deny them.

## Features

- Access request submission workflow
- Role-based approval system (REQUESTER / APPROVER)
- Idempotent request creation
- Cursor-based pagination
- Structured logging
- AI-powered operational queries with LLM resilience (retry + circuit breaker)
- Rate limiting on the agent endpoint
- GraphQL API alongside REST
- OpenAPI / Swagger UI at `/api-docs`

## Architecture

```
┌──────────┐     ┌────────────────────────────────────────────────┐
│  Client   │────▶│  Express Server                                │
└──────────┘     │                                                │
                 │  ┌─────────────────────────────────────────┐   │
                 │  │  Middleware Stack                        │   │
                 │  │  requestLogger
                        → auth
                        → roleCheck
                        → errorHandler│
                 │  └─────────────────────────────────────────┘   │
                 │                    │                            │
                 │  ┌─────────┬──────┴──────┬──────────┐         │
                 │  │  Auth   │  Requests   │  Agent   │         │
                 │  │ Module  │   Module    │  Module  │         │
                 │  └────┬────┴──────┬──────┴────┬─────┘         │
                 │       │           │           │                │
                 │  ┌────┴───────────┴───────────┴────┐          │
                 │  │  Routes → Controller → Service   │          │
                 │  │            → Repository          │          │
                 │  └──────────────┬───────────────────┘          │
                 │                 │                               │
                 │  ┌──────────────┴───────────────────┐          │
                 │  │  Prisma Client → SQLite           │          │
                 │  └──────────────────────────────────┘          │
                 └────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Responsibility |
|---|---|
| **Routes** | HTTP method + path mapping, attach middleware |
| **Controller** | Validate input (Zod), call service, format response |
| **GraphQL** | Schema, resolvers, context — calls same service layer as REST |
| **Service** | Business logic, state transitions, duplicate checks |
| **Repository** | Data access via Prisma (no business logic) |
| **Middleware** | Auth, logging, role checks, error handling |

## Tech Stack

- **Runtime:** Node.js 18+ / TypeScript
- **Framework:** Express 5
- **GraphQL:** graphql-yoga
- **ORM:** Prisma
- **Database:** SQLite
- **Validation:** Zod
- **Logging:** Pino (structured JSON)
- **Testing:** Vitest + Supertest
- **Auth:** Mocked JWT
- **Rate Limiting:** express-rate-limit
- **API Docs:** swagger-ui-express (OpenAPI 3.0)

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Clone and install
git clone https://github.com/LinaKoz/access-request-service.git
cd access-request-service
npm install

# Set up environment
cp .env.example .env

# Generate Prisma client and run migrations
npx prisma generate
npx prisma migrate dev

# Seed the database with sample data
npm run db:seed

# Start the dev server
npm run dev
```

### Docker

```bash
docker build -f docker/Dockerfile -t access-request-service .
docker run -p 3000:3000 access-request-service
```

### Run Tests

```bash
npm test
```

## Deployment

### AWS ECS (Fargate)

- Build the Docker image and push it to Amazon ECR (`docker build -f docker/Dockerfile -t <account>.dkr.ecr.<region>.amazonaws.com/access-request-service .`).
- Create an ECS Fargate task definition pointing to the ECR image. Set `JWT_SECRET`, `DATABASE_URL`, and `OPENAI_API_KEY` as environment variables sourced from AWS Secrets Manager.
- Create an ECS service and place it behind an Application Load Balancer for TLS termination and health checking.
- **Note:** SQLite is not suitable for multi-instance deployments. Replace it with Amazon RDS (PostgreSQL) and update the `DATABASE_URL` and Prisma provider accordingly.

### GCP Cloud Run

- Build the Docker image and push it to Google Artifact Registry.
- Deploy with `gcloud run deploy access-request-service --image <image-url> --set-secrets JWT_SECRET=jwt-secret:latest,DATABASE_URL=db-url:latest,OPENAI_API_KEY=openai-key:latest`.
- **Note:** Cloud Run is stateless — SQLite should be replaced with Cloud SQL (PostgreSQL) for persistence across instances.
- Cloud Run auto-scales to zero when idle, making it cost-efficient for internal tooling with intermittent traffic.

## Observability

### Metrics

- The service already emits structured JSON logs via Pino. In production, ship logs to Datadog or CloudWatch using a sidecar or log driver.
- Recommended metrics to track: request rate and latency (from `requestLogger`), agent query volume and cache hit rate, error rate by status code, and LLM response time when using real OpenAI.
- To expose a `/metrics` endpoint, add `prom-client` and instrument the agent cache hit/miss counter and HTTP duration histograms.

### Tracing

- Add OpenTelemetry (`@opentelemetry/sdk-node`) with auto-instrumentation for Express and Prisma.
- Export traces to Datadog APM or Google Cloud Trace to get end-to-end visibility from HTTP request → service → DB query.

### Alerts

- Recommended alerts:
  - Error rate > 1% over 5 minutes
  - p99 latency > 2 seconds
  - Agent evaluation score average dropping below 50 (signals LLM degradation)
  - Any 5xx spike

## API Reference

### Authentication

All endpoints (except auth and health) require a Bearer token in the `Authorization` header.

#### Get a Token

```bash
# Get a token for a mock user
curl -X POST http://localhost:3000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"userId": "employee-1"}'

# List available mock users
curl http://localhost:3000/api/auth/users
```

**Available mock users:**

| userId | Name | Role |
|---|---|---|
| employee-1 | Alice | REQUESTER |
| employee-2 | Bob | REQUESTER |
| approver-1 | Carol | APPROVER |
| approver-2 | Dave | APPROVER |

### Access Requests

#### Create a Request (REQUESTER only)

```bash
curl -X POST http://localhost:3000/api/requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -H "Idempotency-Key: <unique-key>" \
  -d '{"application": "Jira", "reason": "Need project tracking"}'
```

**Response (201):**
```json
{
  "data": {
    "id": "uuid",
    "employeeId": "employee-1",
    "employeeName": "Alice",
    "application": "Jira",
    "reason": "Need project tracking",
    "status": "PENDING",
    "createdBy": "employee-1",
    "createdAt": "2026-03-08T...",
    "updatedAt": "2026-03-08T...",
    "decisionBy": null,
    "decisionAt": null,
    "decisionNote": null
  }
}
```

#### List Requests

REQUESTER sees only their own requests. APPROVER can see all requests and filter by `userId` and `status`.

```bash
# REQUESTER — returns own requests only
curl http://localhost:3000/api/requests \
  -H "Authorization: Bearer <token>"

# APPROVER — filter by status
curl "http://localhost:3000/api/requests?status=PENDING" \
  -H "Authorization: Bearer <token>"

# APPROVER — filter by user
curl "http://localhost:3000/api/requests?userId=employee-1" \
  -H "Authorization: Bearer <token>"
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "employeeId": "employee-1",
      "employeeName": "Alice",
      "application": "Jira",
      "reason": "Need project tracking",
      "status": "PENDING",
      "createdAt": "2026-03-08T...",
      "..."
    }
  ],
  "page": {
    "nextCursor": "opaqueCursorStringOrNull",
    "limit": 20
  }
}
```

#### Pagination

Results are cursor-based and ordered by `createdAt DESC, id DESC` for stable ordering. Each response includes a `page` object with `nextCursor` and `limit`. To fetch the next page, pass the `nextCursor` value as the `cursor` query parameter.

```bash
# First page
curl "http://localhost:3000/api/requests?limit=20" \
  -H "Authorization: Bearer <token>"

# Next page using cursor from the previous response
curl "http://localhost:3000/api/requests?limit=20&cursor=<opaqueCursor>" \
  -H "Authorization: Bearer <token>"
```

When there are no more results, `nextCursor` is `null`.

**Query parameters:**

| Param | Description |
|---|---|
| `status` | Filter by `PENDING`, `APPROVED`, or `DENIED` |
| `userId` | Filter by employee ID (APPROVER only) |
| `limit` | Results per page (default 20, max 100) |
| `cursor` | Opaque cursor from a previous `page.nextCursor` |

#### Get a Single Request

REQUESTER can only view their own requests. APPROVER can view any request.

```bash
curl http://localhost:3000/api/requests/<id> \
  -H "Authorization: Bearer <token>"
```

#### Make a Decision (APPROVER only)

```bash
curl -X PATCH http://localhost:3000/api/requests/<id>/decision \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"decision": "APPROVED", "note": "Approved for engineering team"}'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `decision` | `"APPROVED"` or `"DENIED"` | Yes |
| `note` | string | No |

**Response (200):**
```json
{
  "data": {
    "id": "uuid",
    "status": "APPROVED",
    "decisionBy": "approver-1",
    "decisionAt": "2026-03-08T...",
    "decisionNote": "Approved for engineering team",
    "..."
  }
}
```

### Status Codes

| Code | Meaning |
|------|---------|
| 200 | Successful read or decision |
| 201 | Resource created |
| 400 | Validation error |
| 401 | Missing or invalid token |
| 403 | Forbidden (role or ownership violation) |
| 404 | Resource not found |
| 409 | Conflict (duplicate pending request, idempotency mismatch, invalid state transition) |

### AI Agent

#### Ask the Agent

```bash
curl -X POST http://localhost:3000/api/agent/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"query": "Summarize current request activity"}'
```

**Supported queries:**

- Count requests by status
- Filter and list requests by application or status
- Lookup a single request by ID
- Summarize request activity for the last 7 days

**Response (200) — normal:**
```json
{
  "data": {
    "answer": "Here is a summary of the current access request activity.\n\nData:\nTotal requests: 3\n...",
    "provider": "mock",
    "evaluation": {
      "queryUnderstood": true,
      "hadRelevantData": true,
      "score": 100
    }
  }
}
```

**Response (200) — degraded (OpenAI unavailable):**
```json
{
  "data": {
    "answer": "Here is a summary...",
    "provider": "mock",
    "degraded": true,
    "degradedReason": "circuit_open",
    "evaluation": {
      "queryUnderstood": true,
      "hadRelevantData": true,
      "score": 100
    }
  }
}
```

### Health Check

```bash
curl http://localhost:3000/health
```

### Swagger UI

Interactive API documentation is available at `http://localhost:3000/api-docs` when the server is running.

### GraphQL API

A GraphQL endpoint is available at `/graphql` alongside the REST API. Both interfaces share the same service layer — no business logic is duplicated.

**GraphiQL Playground:** Open `http://localhost:3000/graphql` in a browser.

**Authentication:** Pass the same Bearer token used for REST in the `Authorization` header.

#### Example: List requests

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"query": "{ requests(limit: 5) { data { id application status employeeName } page { nextCursor limit } } }"}'
```

#### Example: Create a request

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"query": "mutation { createRequest(application: \"Jira\", reason: \"Need access\", idempotencyKey: \"unique-key-1\") { id status } }"}'
```

#### Example: Approve a request

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"query": "mutation { decideRequest(id: \"<request-id>\", decision: \"APPROVED\", note: \"Approved\") { id status decisionBy } }"}'
```

#### Available operations

| Type | Operation | Description |
|------|-----------|-------------|
| Query | `requests` | List requests with filters and pagination |
| Query | `request(id)` | Get a single request by ID |
| Query | `agentQuery(query)` | Ask the AI agent |
| Mutation | `createRequest` | Create an access request (REQUESTER) |
| Mutation | `decideRequest` | Approve or deny a request (APPROVER) |

## Key Design Decisions

### 1. Module-Based Structure
Each domain concept (auth, requests, agent) lives in its own folder with co-located routes/controller/service/repository. This is more navigable than flat layer folders.

### 2. Idempotency
POST `/api/requests` requires an `Idempotency-Key` header. Repeat calls with the same key return the previously created request instead of creating a new one. If the same key is reused with a different payload, the server returns `409 Conflict`. This prevents accidental duplicate submissions from retries or network issues.

### 3. Duplicate Prevention
The service layer checks for existing PENDING requests before creating a new one. A user cannot have two pending requests for the same application.

### 4. Terminal State Machine
Request status follows `PENDING → APPROVED | DENIED`. Once a decision is made, the request cannot be changed. This is enforced at the service layer.

### 5. Cursor-Based Pagination
List endpoints use opaque cursor-based pagination instead of offset pagination. Results are ordered by `createdAt DESC, id DESC` for stable ordering. The cursor is an encoded composite of `createdAt` and `id`, which guarantees stable pagination even if new rows are inserted while the client is paging through results. The cursor is not a raw database identifier.

### 6. AI Agent Separation
The agent module (`src/agent/`) is separate from business modules. It reuses the same repository layer (no duplicate data access logic). The LLM client is behind an abstraction (`llm.client.ts`) making it easy to swap from the mocked implementation to a real OpenAI integration.

### 7. Evaluation Signal
The agent includes a basic evaluator that scores responses on two dimensions: whether the query was understood, and whether relevant data was available. Results are logged for operational insight.

### 8. Dual API (REST + GraphQL)
Both REST and GraphQL endpoints are available simultaneously. GraphQL resolvers call the same service layer as REST controllers, ensuring consistent business logic with zero duplication. Authentication uses the same JWT mechanism via the `Authorization` header.

### 9. Error Handling
All errors flow through a centralized `errorHandler` middleware. Custom `AppError` classes carry HTTP status codes and error codes. Zod validation errors are automatically formatted.

**Error response format:**
```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

### 10. LLM Resilience — Retry + Circuit Breaker
The LLM client uses two generic utilities from `src/utils/` to handle OpenAI instability:

**Retry (`src/utils/retry.ts`)**
- Retries transient failures (429, 5xx, network errors) up to 2 times with exponential backoff (300 ms, 600 ms) and jitter (50–100% of delay) to avoid thundering-herd retries.
- Honours `Retry-After` headers returned by the upstream API — when present, the server-suggested delay is used instead of fixed backoff, capped at 60 seconds to prevent excessive waits.
- Non-retryable errors (400, 401, 403) fail immediately — retrying would not help.
- Errors are classified via a typed `UpstreamError` class (carrying `statusCode` and optional `retryAfterMs`) instead of regex-parsing error messages.
- Generic: not coupled to OpenAI. Any future external API client can use `withRetry` with its own `isRetryable` and `getRetryDelay` logic.

**Circuit Breaker (`src/utils/circuitBreaker.ts`)**

| State | Behavior |
|---|---|
| CLOSED | Normal — calls OpenAI |
| OPEN | OpenAI is down — skips the call entirely, returns mock immediately |
| HALF_OPEN | Cooldown expired — tries one call to check recovery |

Opens after 3 consecutive failures, resets after 30 seconds. Generic: the `CircuitBreaker` class is not coupled to OpenAI and can wrap any external call.

**Transparency**

When a response is degraded the API includes:
```json
{
  "provider": "mock",
  "degraded": true,
  "degradedReason": "circuit_open"
}
```
This allows clients and monitoring systems to distinguish real LLM responses from fallbacks.

## Project Structure

```
access-request-service/
├── prisma/
│   ├── schema.prisma        # Data model
│   ├── seed.ts               # Seed data
│   └── migrations/           # SQLite migrations
├── src/
│   ├── config/               # Env config + logger
│   ├── middleware/            # Auth, error handler, logging
│   ├── errors/               # Custom error classes
│   ├── prisma/               # Singleton Prisma client
│   ├── modules/
│   │   ├── auth/             # Mock JWT auth
│   │   └── requests/         # Access request CRUD + business rules
│   ├── agent/                # AI agent
│   ├── utils/                # Generic utilities (retry, circuit breaker)
│   ├── graphql/              # GraphQL schema, resolvers, context
│   ├── app.ts                # Express setup
│   └── server.ts             # Entry point
├── tests/
│   ├── unit/                 # Service layer unit tests
│   └── integration/          # API endpoint tests
└── docker/
    └── Dockerfile
```

## Future Improvements

- Replace SQLite with PostgreSQL for stronger concurrency guarantees
- Add a partial unique index for enforcing one PENDING request per user per application at the database level
- Add request metrics via `prom-client`

### LLM Resilience

For a production-grade version, the following improvements would be valuable:

- **Add proactive rate limiting**
  Introduce an outbound rate limiter (for example, token bucket or sliding window) to reduce the chance of hitting `429 Too Many Requests` in the first place.

- **Persist query and evaluation metadata**
  Store queries, responses, retry outcomes, and evaluation scores for observability, debugging, and analytics.

- **Tune retry strategy per error type**
  Different transient errors may benefit from different retry windows, limits, and fallback behavior.
