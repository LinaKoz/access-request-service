export const RequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DENIED: 'DENIED',
} as const;

export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];

export const UserRole = {
  REQUESTER: 'REQUESTER',
  APPROVER: 'APPROVER',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
