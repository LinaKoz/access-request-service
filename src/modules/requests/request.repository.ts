import { prisma } from '../../prisma/client';
import { RequestStatus } from './request.types';

export interface CreateRequestData {
  employeeId: string;
  employeeName: string;
  application: string;
  reason: string;
  createdBy: string;
  idempotencyKey: string;
  payloadFingerprint: string;
}

/** Creates a new AccessRequest. No business validation; service layer enforces rules. */
export async function createRequest(data: CreateRequestData) {
  return prisma.accessRequest.create({ data });
}

/** Fetches an AccessRequest by id. Returns null if not found. */
export async function findById(id: string) {
  return prisma.accessRequest.findUnique({ where: { id } });
}

/** Looks up AccessRequest by unique (employeeId, idempotencyKey). Used for idempotency check. */
export async function findByEmployeeAndIdempotencyKey(employeeId: string, idempotencyKey: string) {
  return prisma.accessRequest.findUnique({
    where: {
      uq_employee_idempotency_key: { employeeId, idempotencyKey },
    },
  });
}

/** Finds PENDING request for given employee + application. Used for duplicate-pending check. */
export async function findPendingByEmployeeAndApp(employeeId: string, application: string) {
  return prisma.accessRequest.findFirst({
    where: { employeeId, application, status: RequestStatus.PENDING },
  });
}

export interface FindManyOptions {
  userId?: string;
  status?: RequestStatus;
  limit: number;
  cursorCreatedAt?: string;
  cursorId?: string;
}

/** Lists AccessRequests with filters, cursor-based pagination, order createdAt DESC id DESC. */
export async function findMany(options: FindManyOptions) {
  const { userId, status, limit, cursorCreatedAt, cursorId } = options;

  const cursorFilter = cursorCreatedAt && cursorId
    ? {
        OR: [
          { createdAt: { lt: new Date(cursorCreatedAt) } },
          { createdAt: new Date(cursorCreatedAt), id: { lt: cursorId } },
        ],
      }
    : undefined;

  return prisma.accessRequest.findMany({
    where: {
      ...(userId && { employeeId: userId }),
      ...(status && { status }),
      ...cursorFilter,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
}

/** Updates status, decisionBy, decisionAt, decisionNote for a request. */
export async function updateDecision(
  id: string,
  status: RequestStatus,
  decisionBy: string,
  decisionNote?: string,
) {
  return prisma.accessRequest.update({
    where: { id },
    data: {
      status,
      decisionBy,
      decisionAt: new Date(),
      decisionNote: decisionNote ?? null,
    },
  });
}
