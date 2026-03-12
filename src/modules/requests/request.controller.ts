import { Request, Response } from 'express';
import {
  createRequestSchema,
  idempotencyKeySchema,
  requestIdParamSchema,
  listRequestsSchema,
  decisionSchema,
} from './request.validator';
import * as service from './request.service';
import { AppError } from '../../errors/AppError';
import { AuthUser } from '../../middleware/auth';

function getUser(req: Request): AuthUser {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

/**
 * Creates an access request. Requires Idempotency-Key header and REQUESTER role.
 * Returns 201 for new request, 200 for idempotent retry.
 *
 * @throws {ZodError} 400 - Invalid body or missing Idempotency-Key
 * @throws {AppError} 409 - Duplicate pending or idempotency key reused with different payload
 */
export async function create(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  const headers = idempotencyKeySchema.parse(req.headers);
  const input = createRequestSchema.parse(req.body);
  const result = await service.createAccessRequest(input, user, headers['idempotency-key']);
  const statusCode = result.isIdempotentRetry ? 200 : 201;
  res.status(statusCode).json({ data: result.data });
}

/**
 * Lists access requests with role-based scoping. REQUESTER sees own only; APPROVER can filter by userId.
 *
 * @throws {ZodError} 400 - Invalid query params
 * @throws {AppError} 403 - REQUESTER sending userId param
 */
export async function list(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  const query = listRequestsSchema.parse(req.query);
  const result = await service.listRequests(query, user);
  res.json({ data: result.data, page: result.page });
}

/**
 * Gets a single access request by id. REQUESTER can only view own; APPROVER can view any.
 *
 * @throws {ZodError} 400 - Invalid UUID in params
 * @throws {AppError} 404 - Request not found
 * @throws {AppError} 403 - REQUESTER accessing another user's request
 */
export async function getById(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  const { id } = requestIdParamSchema.parse(req.params);
  const request = await service.getRequestById(id, user);
  res.json({ data: request });
}

/**
 * Approves or denies a pending request. Requires APPROVER role.
 *
 * @throws {ZodError} 400 - Invalid params or body (invalid decision value)
 * @throws {AppError} 404 - Request not found
 * @throws {AppError} 409 - Request already decided
 */
export async function decide(req: Request, res: Response): Promise<void> {
  const user = getUser(req);
  const { id } = requestIdParamSchema.parse(req.params);
  const input = decisionSchema.parse(req.body);
  const request = await service.decideRequest(id, input, user);
  res.json({ data: request });
}
