import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../../src/modules/requests/request.repository');
vi.mock('../../src/config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as service from '../../src/modules/requests/request.service';
import { encodeCursor, decodeCursor } from '../../src/modules/requests/request.service';
import * as repo from '../../src/modules/requests/request.repository';
import { AuthUser } from '../../src/middleware/auth';

function makeP2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: '6.19.2', meta: { target } },
  );
}

const mockedRepo = vi.mocked(repo);

const requester: AuthUser = { userId: 'emp-1', userName: 'Alice', role: 'REQUESTER' };
const requester2: AuthUser = { userId: 'emp-2', userName: 'Bob', role: 'REQUESTER' };
const approver: AuthUser = { userId: 'apr-1', userName: 'Carol', role: 'APPROVER' };

const baseRequest = {
  id: 'req-1',
  employeeId: 'emp-1',
  employeeName: 'Alice',
  application: 'Jira',
  reason: 'Need access',
  status: 'PENDING',
  createdBy: 'emp-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  decisionBy: null,
  decisionAt: null,
  decisionNote: null,
  idempotencyKey: 'key-1',
  payloadFingerprint: 'fp-match',
};

describe('RequestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createAccessRequest', () => {
    it('creates a request and returns isIdempotentRetry=false', async () => {
      mockedRepo.createRequest.mockResolvedValue(baseRequest);

      const result = await service.createAccessRequest(
        { application: 'Jira', reason: 'Need access' },
        requester,
        'new-key',
      );

      expect(result.isIdempotentRetry).toBe(false);
      expect(result.data.id).toBe('req-1');
      expect(result.data.status).toBe('PENDING');
      expect(mockedRepo.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp-1',
          application: 'Jira',
          idempotencyKey: 'new-key',
          payloadFingerprint: expect.any(String),
        }),
      );
    });

    it('returns existing request with isIdempotentRetry=true on matching key+payload', async () => {
      const crypto = await import('crypto');
      const expectedFP = crypto.createHash('sha256')
        .update(JSON.stringify({ application: 'Jira', reason: 'Need access' }))
        .digest('hex');

      mockedRepo.createRequest.mockRejectedValue(makeP2002(['employeeId', 'idempotencyKey']));
      mockedRepo.findByEmployeeAndIdempotencyKey.mockResolvedValue({
        ...baseRequest,
        payloadFingerprint: expectedFP,
      });

      const result = await service.createAccessRequest(
        { application: 'Jira', reason: 'Need access' },
        requester,
        'key-1',
      );

      expect(result.isIdempotentRetry).toBe(true);
      expect(result.data.id).toBe('req-1');
    });

    it('throws 409 when idempotency key reused with different payload', async () => {
      mockedRepo.createRequest.mockRejectedValue(makeP2002(['employeeId', 'idempotencyKey']));
      mockedRepo.findByEmployeeAndIdempotencyKey.mockResolvedValue({
        ...baseRequest,
        payloadFingerprint: 'completely-different-fingerprint',
      });

      await expect(
        service.createAccessRequest(
          { application: 'Jira', reason: 'Need access' },
          requester,
          'key-1',
        ),
      ).rejects.toThrow('different request payload');
    });

    it('throws conflict when a pending duplicate exists for same app', async () => {
      mockedRepo.createRequest.mockRejectedValue(makeP2002(['employeeId', 'application']));
      mockedRepo.findByEmployeeAndIdempotencyKey.mockResolvedValue(null);

      await expect(
        service.createAccessRequest(
          { application: 'Jira', reason: 'Need access' },
          requester,
          'different-key',
        ),
      ).rejects.toThrow('already exists');
    });
  });

  describe('decideRequest', () => {
    it('approves a pending request', async () => {
      mockedRepo.findById.mockResolvedValue(baseRequest);
      mockedRepo.updateDecision.mockResolvedValue({
        ...baseRequest,
        status: 'APPROVED',
        decisionBy: 'apr-1',
        decisionAt: new Date(),
        decisionNote: 'Looks good',
      });

      const result = await service.decideRequest(
        'req-1',
        { decision: 'APPROVED', note: 'Looks good' },
        approver,
      );

      expect(result.status).toBe('APPROVED');
      expect(result.decisionBy).toBe('apr-1');
    });

    it('denies a pending request', async () => {
      mockedRepo.findById.mockResolvedValue(baseRequest);
      mockedRepo.updateDecision.mockResolvedValue({
        ...baseRequest,
        status: 'DENIED',
        decisionBy: 'apr-1',
        decisionAt: new Date(),
        decisionNote: 'Not needed',
      });

      const result = await service.decideRequest(
        'req-1',
        { decision: 'DENIED', note: 'Not needed' },
        approver,
      );

      expect(result.status).toBe('DENIED');
    });

    it('throws conflict when request is already decided', async () => {
      mockedRepo.findById.mockResolvedValue({
        ...baseRequest,
        status: 'APPROVED',
        decisionBy: 'apr-1',
        decisionAt: new Date(),
      });

      await expect(
        service.decideRequest('req-1', { decision: 'DENIED' }, approver),
      ).rejects.toThrow('cannot be modified');
    });

    it('throws not found for non-existent request', async () => {
      mockedRepo.findById.mockResolvedValue(null);

      await expect(
        service.decideRequest('not-real', { decision: 'APPROVED' }, approver),
      ).rejects.toThrow('not found');
    });
  });

  describe('getRequestById', () => {
    it('returns a request to the owning REQUESTER', async () => {
      mockedRepo.findById.mockResolvedValue(baseRequest);

      const result = await service.getRequestById('req-1', requester);
      expect(result.id).toBe('req-1');
    });

    it('returns any request to an APPROVER', async () => {
      mockedRepo.findById.mockResolvedValue(baseRequest);

      const result = await service.getRequestById('req-1', approver);
      expect(result.id).toBe('req-1');
    });

    it('throws 403 when REQUESTER accesses another users request', async () => {
      mockedRepo.findById.mockResolvedValue(baseRequest);

      await expect(
        service.getRequestById('req-1', requester2),
      ).rejects.toThrow('your own requests');
    });

    it('throws not found for missing request', async () => {
      mockedRepo.findById.mockResolvedValue(null);
      await expect(service.getRequestById('nope', approver)).rejects.toThrow('not found');
    });
  });

  describe('listRequests', () => {
    it('auto-scopes REQUESTER to their own userId', async () => {
      mockedRepo.findMany.mockResolvedValue([baseRequest]);

      await service.listRequests({ limit: 20 }, requester);

      expect(mockedRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'emp-1' }),
      );
    });

    it('throws 403 when REQUESTER provides userId', async () => {
      await expect(
        service.listRequests({ userId: 'emp-2', limit: 20 }, requester),
      ).rejects.toThrow('cannot filter by userId');
    });

    it('allows APPROVER to filter by userId', async () => {
      mockedRepo.findMany.mockResolvedValue([baseRequest]);

      await service.listRequests({ userId: 'emp-1', limit: 20 }, approver);

      expect(mockedRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'emp-1' }),
      );
    });

    it('returns page object with opaque nextCursor when more items exist', async () => {
      const ts = new Date('2026-03-01T10:00:00Z');
      const items = Array.from({ length: 3 }, (_, i) => ({
        ...baseRequest,
        id: `req-${i}`,
        createdAt: ts,
      }));
      mockedRepo.findMany.mockResolvedValue(items);

      const result = await service.listRequests({ limit: 2 }, approver);

      expect(result.data).toHaveLength(2);
      expect(result.page.limit).toBe(2);
      expect(result.page.nextCursor).not.toBeNull();
      const decoded = decodeCursor(result.page.nextCursor!);
      expect(decoded.id).toBe('req-1');
      expect(decoded.createdAt).toBe(ts.toISOString());
    });

    it('returns page with null nextCursor when no more items', async () => {
      mockedRepo.findMany.mockResolvedValue([baseRequest]);

      const result = await service.listRequests({ limit: 20 }, approver);

      expect(result.data).toHaveLength(1);
      expect(result.page.nextCursor).toBeNull();
      expect(result.page.limit).toBe(20);
    });

    it('decodes cursor and passes components to repo', async () => {
      const ts = new Date('2026-03-01T10:00:00Z');
      const cursor = encodeCursor(ts, 'req-5');
      mockedRepo.findMany.mockResolvedValue([]);

      await service.listRequests({ limit: 20, cursor }, approver);

      expect(mockedRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursorCreatedAt: ts.toISOString(),
          cursorId: 'req-5',
        }),
      );
    });

    it('throws 400 for invalid cursor', async () => {
      await expect(
        service.listRequests({ limit: 20, cursor: 'not-valid' }, approver),
      ).rejects.toThrow('Invalid pagination cursor');
    });
  });

  describe('encodeCursor / decodeCursor', () => {
    it('round-trips correctly', () => {
      const ts = new Date('2026-03-08T12:00:00Z');
      const encoded = encodeCursor(ts, 'abc-123');
      const decoded = decodeCursor(encoded);
      expect(decoded.createdAt).toBe(ts.toISOString());
      expect(decoded.id).toBe('abc-123');
    });

    it('produces an opaque base64url string', () => {
      const encoded = encodeCursor(new Date(), 'test-id');
      expect(encoded).not.toContain('test-id');
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });
});
