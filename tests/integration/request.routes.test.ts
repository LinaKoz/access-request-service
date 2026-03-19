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
  await prisma.accessRequest.deleteMany();
  await prisma.$disconnect();
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/auth/token', () => {
  it('returns a JWT for a valid user', async () => {
    const res = await request(app)
      .post('/api/auth/token')
      .send({ userId: 'employee-1' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('returns 400 for unknown user', async () => {
    const res = await request(app)
      .post('/api/auth/token')
      .send({ userId: 'unknown' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/requests', () => {
  it('creates an access request', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', uuid())
      .send({ application: 'Jira', reason: 'Need project tracking' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.application).toBe('Jira');
    expect(res.body.data.createdBy).toBe('employee-1');
    expect(res.body.data.idempotencyKey).toBeDefined();
    expect(res.body.data.payloadFingerprint).toBeDefined();
  });

  it('returns 409 for duplicate pending request (different key, same app)', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', uuid())
      .send({ application: 'Jira', reason: 'Duplicate attempt' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('already exists');
  });

  it('returns 400 without Idempotency-Key', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .send({ application: 'Slack', reason: 'Need comms' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 for idempotent retry with same Idempotency-Key and same payload', async () => {
    const key = uuid();
    const payload = { application: 'GitHub', reason: 'Need repo access' };

    const first = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', key)
      .send(payload);

    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', key)
      .send(payload);

    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('returns 409 when same Idempotency-Key is reused with different payload', async () => {
    const key = uuid();

    const first = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', key)
      .send({ application: 'Notion', reason: 'Need wiki access' });

    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', key)
      .send({ application: 'Notion', reason: 'DIFFERENT reason' });

    expect(second.status).toBe(409);
    expect(second.body.error.message).toContain('different request payload');
  });

  it('allows same Idempotency-Key for different employees', async () => {
    const sharedKey = 'shared-key-across-users';
    const tokens2 = await import('../helpers').then((h) => h.tokens);

    const res1 = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', sharedKey)
      .send({ application: 'Figma', reason: 'Design tool' });

    // employee-1 may already have Figma pending, so accept 201 or 409-duplicate-pending
    // The point is that a second employee with the same key should NOT conflict on idempotency
    const res2 = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens2.requester2}`)
      .set('Idempotency-Key', sharedKey)
      .send({ application: 'Figma', reason: 'Design tool' });

    expect(res2.status).toBe(201);
  });

  it('returns 403 when approver tries to create', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.approver}`)
      .set('Idempotency-Key', uuid())
      .send({ application: 'Slack', reason: 'Want access' });

    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/requests')
      .set('Idempotency-Key', uuid())
      .send({ application: 'Slack', reason: 'Want access' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/requests', () => {
  it('REQUESTER sees only their own requests', async () => {
    const res = await request(app)
      .get('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const r of res.body.data) {
      expect(r.employeeId).toBe('employee-1');
    }
  });

  it('APPROVER sees all requests', async () => {
    const res = await request(app)
      .get('/api/requests')
      .set('Authorization', `Bearer ${tokens.approver}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('REQUESTER gets 403 when providing userId param', async () => {
    const res = await request(app)
      .get('/api/requests?userId=employee-2')
      .set('Authorization', `Bearer ${tokens.requester}`);

    expect(res.status).toBe(403);
  });

  it('APPROVER can filter by userId', async () => {
    const res = await request(app)
      .get('/api/requests?userId=employee-1')
      .set('Authorization', `Bearer ${tokens.approver}`);

    expect(res.status).toBe(200);
    for (const r of res.body.data) {
      expect(r.employeeId).toBe('employee-1');
    }
  });

  it('filters by status', async () => {
    const res = await request(app)
      .get('/api/requests?status=PENDING')
      .set('Authorization', `Bearer ${tokens.requester}`);

    expect(res.status).toBe(200);
    for (const r of res.body.data) {
      expect(r.status).toBe('PENDING');
    }
  });

  it('returns page object with opaque nextCursor when more results exist', async () => {
    const res = await request(app)
      .get('/api/requests?limit=1')
      .set('Authorization', `Bearer ${tokens.approver}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.page).toBeDefined();
    expect(res.body.page.limit).toBe(1);
    expect(res.body.page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('paginates with opaque cursor from page object', async () => {
    const page1 = await request(app)
      .get('/api/requests?limit=1')
      .set('Authorization', `Bearer ${tokens.approver}`);

    expect(page1.body.page.nextCursor).toBeDefined();

    const page2 = await request(app)
      .get(`/api/requests?limit=1&cursor=${page1.body.page.nextCursor}`)
      .set('Authorization', `Bearer ${tokens.approver}`);

    expect(page2.status).toBe(200);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
  });

  it('returns 400 for invalid cursor', async () => {
    const res = await request(app)
      .get('/api/requests?cursor=not-a-valid-cursor')
      .set('Authorization', `Bearer ${tokens.approver}`);

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/requests/:id/decision', () => {
  let requestId: string;

  beforeAll(async () => {
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', uuid())
      .send({ application: 'Confluence', reason: 'Need docs' });

    requestId = created.body.data.id;
  });

  it('approves a pending request', async () => {
    const res = await request(app)
      .patch(`/api/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({ decision: 'APPROVED', note: 'Approved for docs team' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.decisionBy).toBe('approver-1');
    expect(res.body.data.decisionAt).toBeDefined();
  });

  it('returns 200 when sending the same decision again (idempotent)', async () => {
    const res = await request(app)
      .patch(`/api/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({ decision: 'APPROVED' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
  });

  it('returns 409 when trying to decide with a different decision', async () => {
    const res = await request(app)
      .patch(`/api/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({ decision: 'DENIED' });

    expect(res.status).toBe(409);
  });

  it('returns 403 when requester tries to decide', async () => {
    const res = await request(app)
      .patch(`/api/requests/${requestId}/decision`)
      .set('Authorization', `Bearer ${tokens.requester}`)
      .send({ decision: 'APPROVED' });

    expect(res.status).toBe(403);
  });

  it('denies a pending request', async () => {
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', uuid())
      .send({ application: 'Datadog', reason: 'Need monitoring' });

    const res = await request(app)
      .patch(`/api/requests/${created.body.data.id}/decision`)
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({ decision: 'DENIED', note: 'Not approved for this team' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DENIED');
    expect(res.body.data.decisionBy).toBe('approver-1');
  });

  it('returns 400 with invalid decision value', async () => {
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', uuid())
      .send({ application: 'Sentry', reason: 'Need error tracking' });

    const res = await request(app)
      .patch(`/api/requests/${created.body.data.id}/decision`)
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({ decision: 'MAYBE' });

    expect(res.status).toBe(400);
  });

  it('returns 400 with non-UUID id param', async () => {
    const res = await request(app)
      .patch('/api/requests/not-a-uuid/decision')
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({ decision: 'APPROVED' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Request lifecycle — re-request after decision', () => {
  it('allows a new request for the same app after the first is DENIED', async () => {
    const app1 = 'Linear';

    const create1 = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', uuid())
      .send({ application: app1, reason: 'Need task tracking' });

    expect(create1.status).toBe(201);
    expect(create1.body.data.status).toBe('PENDING');

    const deny = await request(app)
      .patch(`/api/requests/${create1.body.data.id}/decision`)
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({ decision: 'DENIED', note: 'Not yet' });

    expect(deny.status).toBe(200);
    expect(deny.body.data.status).toBe('DENIED');

    const create2 = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', uuid())
      .send({ application: app1, reason: 'Re-requesting after team change' });

    expect(create2.status).toBe(201);
    expect(create2.body.data.status).toBe('PENDING');
    expect(create2.body.data.id).not.toBe(create1.body.data.id);
  });

  it('allows a new request for the same app after the first is APPROVED', async () => {
    const app1 = 'Miro';

    const create1 = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', uuid())
      .send({ application: app1, reason: 'Whiteboard access' });

    expect(create1.status).toBe(201);

    await request(app)
      .patch(`/api/requests/${create1.body.data.id}/decision`)
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({ decision: 'APPROVED', note: 'Go ahead' });

    const create2 = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${tokens.requester}`)
      .set('Idempotency-Key', uuid())
      .send({ application: app1, reason: 'Need extended license' });

    expect(create2.status).toBe(201);
    expect(create2.body.data.id).not.toBe(create1.body.data.id);
  });
});

describe('POST /api/agent/query', () => {
  it('answers an operational question', async () => {
    const res = await request(app)
      .post('/api/agent/query')
      .set('Authorization', `Bearer ${tokens.approver}`)
      .send({ query: 'Summarize current request activity' });

    expect(res.status).toBe(200);
    expect(res.body.data.answer).toBeDefined();
    expect(res.body.data.evaluation).toBeDefined();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/agent/query')
      .send({ query: 'Show pending requests' });

    expect(res.status).toBe(401);
  });
});
