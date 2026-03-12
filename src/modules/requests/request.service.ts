import crypto from 'crypto';
import { AppError } from '../../errors/AppError';
import { logger } from '../../config/logger';
import { AuthUser } from '../../middleware/auth';
import { RequestStatus } from './request.types';
import * as repo from './request.repository';
import { CreateRequestInput, ListRequestsQuery, DecisionInput } from './request.validator';

// --- Opaque cursor encoding ---

interface CursorPayload {
  createdAt: string;
  id: string;
}

/**
 * Encodes createdAt + id into an opaque base64url cursor for pagination.
 */
export function encodeCursor(createdAt: Date, id: string): string {
  const payload: CursorPayload = { createdAt: createdAt.toISOString(), id };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decodes an opaque pagination cursor back to { createdAt, id }.
 *
 * @throws {AppError} 400 - Invalid or malformed cursor
 */
export function decodeCursor(cursor: string): CursorPayload {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed.createdAt || !parsed.id) throw new Error();
    return parsed as CursorPayload;
  } catch {
    throw AppError.badRequest('Invalid pagination cursor', 'INVALID_CURSOR');
  }
}

// --- Service ---

export interface CreateResult {
  data: Awaited<ReturnType<typeof repo.createRequest>>;
  isIdempotentRetry: boolean;
}

/**
 * Creates an access request or returns existing one on idempotent retry.
 * Enforces: idempotency (same key + same payload → return existing), duplicate pending prevention.
 *
 * @returns { data, isIdempotentRetry } — isIdempotentRetry true when same key+payload reused
 * @throws {AppError} 409 - Idempotency key reused with different payload
 * @throws {AppError} 409 - Duplicate pending request for same employee + application
 */
export async function createAccessRequest(
  input: CreateRequestInput,
  user: AuthUser,
  idempotencyKey: string,
): Promise<CreateResult> {
  const payloadFingerprint = buildPayloadFingerprint(input);

  const existingByKey = await repo.findByEmployeeAndIdempotencyKey(user.userId, idempotencyKey);
  if (existingByKey) {
    if (existingByKey.payloadFingerprint !== payloadFingerprint) {
      throw AppError.conflict(
        'Idempotency-Key has already been used with a different request payload',
      );
    }
    logger.info({ idempotencyKey, requestId: existingByKey.id }, 'Idempotent retry — returning existing request');
    return { data: existingByKey, isIdempotentRetry: true };
  }

  const existingPending = await repo.findPendingByEmployeeAndApp(user.userId, input.application);
  if (existingPending) {
    throw AppError.conflict(
      `A pending request for "${input.application}" already exists (id: ${existingPending.id})`,
    );
  }

  const request = await repo.createRequest({
    employeeId: user.userId,
    employeeName: user.userName,
    application: input.application,
    reason: input.reason,
    createdBy: user.userId,
    idempotencyKey,
    payloadFingerprint,
  });

  logger.info(
    { requestId: request.id, application: input.application, userId: user.userId },
    'Access request created',
  );

  return { data: request, isIdempotentRetry: false };
}

export interface PaginatedResult {
  data: Awaited<ReturnType<typeof repo.findMany>>;
  page: {
    nextCursor: string | null;
    limit: number;
  };
}

/**
 * Lists access requests with role-based scoping. REQUESTER auto-scoped to own; APPROVER can filter by userId.
 * Uses cursor-based pagination with stable ordering (createdAt DESC, id DESC).
 *
 * @throws {AppError} 403 - REQUESTER sending userId param
 * @throws {AppError} 400 - Invalid cursor (via decodeCursor)
 */
export async function listRequests(query: ListRequestsQuery, user: AuthUser): Promise<PaginatedResult> {
  if (user.role === 'REQUESTER' && query.userId) {
    throw AppError.forbidden('REQUESTER cannot filter by userId');
  }

  const effectiveUserId = user.role === 'REQUESTER' ? user.userId : query.userId;
  const cursorPayload = query.cursor ? decodeCursor(query.cursor) : undefined;

  const rows = await repo.findMany({
    userId: effectiveUserId,
    status: query.status,
    limit: query.limit,
    cursorCreatedAt: cursorPayload?.createdAt,
    cursorId: cursorPayload?.id,
  });

  const hasMore = rows.length > query.limit;
  const data = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = data[data.length - 1];
  const nextCursor = hasMore && lastItem
    ? encodeCursor(lastItem.createdAt, lastItem.id)
    : null;

  return { data, page: { nextCursor, limit: query.limit } };
}

/**
 * Fetches a single access request. REQUESTER can only view own; APPROVER can view any.
 *
 * @throws {AppError} 404 - Request not found
 * @throws {AppError} 403 - REQUESTER accessing another user's request
 */
export async function getRequestById(id: string, user: AuthUser) {
  const request = await repo.findById(id);
  if (!request) {
    throw AppError.notFound(`Request "${id}" not found`);
  }

  if (user.role === 'REQUESTER' && request.employeeId !== user.userId) {
    throw AppError.forbidden('You can only view your own requests');
  }

  return request;
}

/**
 * Approves or denies a pending request. Enforces state machine: PENDING → APPROVED | DENIED only.
 *
 * @throws {AppError} 404 - Request not found
 * @throws {AppError} 409 - Request already decided (invalid state transition)
 */
export async function decideRequest(id: string, input: DecisionInput, user: AuthUser) {
  const request = await repo.findById(id);
  if (!request) {
    throw AppError.notFound(`Request "${id}" not found`);
  }

  if (request.status !== RequestStatus.PENDING) {
    throw AppError.conflict(
      `Request is already ${request.status.toLowerCase()} and cannot be modified`,
    );
  }

  const newStatus = input.decision as RequestStatus;
  const updated = await repo.updateDecision(id, newStatus, user.userId, input.note);

  logger.info(
    { requestId: id, status: newStatus, decisionBy: user.userId },
    `Access request ${newStatus.toLowerCase()}`,
  );

  return updated;
}

function buildPayloadFingerprint(input: CreateRequestInput): string {
  const normalized = JSON.stringify({ application: input.application, reason: input.reason });
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
