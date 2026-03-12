import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { AppError } from '../../errors/AppError';

const MOCK_USERS: Record<string, { userName: string; role: 'REQUESTER' | 'APPROVER' }> = {
  'employee-1': { userName: 'Alice', role: 'REQUESTER' },
  'employee-2': { userName: 'Bob', role: 'REQUESTER' },
  'approver-1': { userName: 'Carol', role: 'APPROVER' },
  'approver-2': { userName: 'Dave', role: 'APPROVER' },
};

/**
 * Generates a JWT for a mock user. Used for dev/testing only.
 *
 * @throws {AppError} 400 - userId not in mock user list
 */
export function generateToken(userId: string): string {
  const user = MOCK_USERS[userId];
  if (!user) {
    throw AppError.badRequest(
      `Unknown userId "${userId}". Valid: ${Object.keys(MOCK_USERS).join(', ')}`,
      'INVALID_USER',
    );
  }

  return jwt.sign(
    { userId, userName: user.userName, role: user.role },
    config.jwtSecret,
    { expiresIn: '24h' },
  );
}

/** Returns mock user list for token generation and testing. */
export function getMockUsers() {
  return Object.entries(MOCK_USERS).map(([userId, info]) => ({
    userId,
    ...info,
  }));
}
