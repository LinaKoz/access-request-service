import { z } from 'zod';
import { RequestStatus } from './request.types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requestIdParamSchema = z.object({
  id: z.string().regex(UUID_REGEX, 'id must be a valid UUID'),
});

export const idempotencyKeySchema = z.object({
  'idempotency-key': z.string().min(1, 'Idempotency-Key header is required'),
});

export const createRequestSchema = z.object({
  application: z.string().min(1, 'application is required'),
  reason: z.string().min(1, 'reason is required'),
});

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

export const listRequestsSchema = z.object({
  userId: z.string().optional(),
  status: z.nativeEnum(RequestStatus).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().optional(),
});

export const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'DENIED']),
  note: z.string().optional(),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type ListRequestsQuery = z.infer<typeof listRequestsSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
