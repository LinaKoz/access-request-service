import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/prisma/client';
import { tokens } from '../helpers';
import { v4 as uuid } from 'uuid';

beforeAll(async () => {
  await prisma.$connect();
  await prisma.accessRequest.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GraphQL API', () => {
  it('returns data for authenticated requests query', async () => {
    const res = await request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({
        query: `{ requests(limit: 5) { data { id application status employeeName } page { nextCursor limit } } }`,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.requests.data).toBeDefined();
    expect(res.body.data.requests.page.limit).toBe(5);
  });

  it('returns UNAUTHENTICATED error without token', async () => {
    const res = await request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .send({
        query: `{ requests { data { id } page { limit } } }`,
      });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
  });

  it('creates a request via mutation', async () => {
    const key = uuid();
    const res = await request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .send({
        query: `mutation CreateReq($app: String!, $reason: String!, $key: String!) {
          createRequest(application: $app, reason: $reason, idempotencyKey: $key) {
            id application status employeeName
          }
        }`,
        variables: { app: 'GraphQL-Test-App', reason: 'Testing GraphQL', key },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.createRequest.application).toBe('GraphQL-Test-App');
    expect(res.body.data.createRequest.status).toBe('PENDING');
  });

  it('returns FORBIDDEN when requester tries to decide', async () => {
    const res = await request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .send({
        query: `mutation { decideRequest(id: "fake-id", decision: APPROVED) { id } }`,
      });

    expect(res.status).toBe(200);
    expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
  });

  it('fetches a single request by id', async () => {
    const key = uuid();
    const createRes = await request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .send({
        query: `mutation CreateReq($app: String!, $reason: String!, $key: String!) {
          createRequest(application: $app, reason: $reason, idempotencyKey: $key) { id }
        }`,
        variables: { app: 'GQL-Lookup', reason: 'Lookup test', key },
      });

    const id = createRes.body.data.createRequest.id;

    const res = await request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .send({
        query: `query GetReq($id: ID!) { request(id: $id) { id application status } }`,
        variables: { id },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.request.id).toBe(id);
    expect(res.body.data.request.application).toBe('GQL-Lookup');
  });

  it('decides a request via mutation', async () => {
    const key = uuid();
    const createRes = await request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .send({
        query: `mutation CreateReq($app: String!, $reason: String!, $key: String!) {
          createRequest(application: $app, reason: $reason, idempotencyKey: $key) { id }
        }`,
        variables: { app: 'GQL-Decide', reason: 'Decision test', key },
      });

    const id = createRes.body.data.createRequest.id;

    const res = await request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({
        query: `mutation Decide($id: ID!, $decision: DecisionInput!, $note: String) {
          decideRequest(id: $id, decision: $decision, note: $note) { id status decisionBy decisionNote }
        }`,
        variables: { id, decision: 'APPROVED', note: 'Approved via GraphQL' },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.decideRequest.status).toBe('APPROVED');
    expect(res.body.data.decideRequest.decisionBy).toBe('approver-1');
    expect(res.body.data.decideRequest.decisionNote).toBe('Approved via GraphQL');
  });

  it('queries the AI agent', async () => {
    const res = await request(app)
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({
        query: `{ agentQuery(query: "Summarize request activity") { answer provider evaluation { queryUnderstood hadRelevantData score } } }`,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.agentQuery.answer).toBeDefined();
    expect(res.body.data.agentQuery.provider).toBe('mock');
    expect(res.body.data.agentQuery.evaluation.score).toBeGreaterThan(0);
  });

  it('REST endpoints still work alongside GraphQL', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
