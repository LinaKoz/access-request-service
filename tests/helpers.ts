import jwt from 'jsonwebtoken';
import { config } from '../src/config';

// Use the same JWT secret the app reads at runtime so test tokens always
// pass auth middleware verification regardless of environment config.
const JWT_SECRET = config.jwtSecret;

export function createTestToken(
  userId: string,
  userName: string,
  role: 'REQUESTER' | 'APPROVER',
): string {
  return jwt.sign({ userId, userName, role }, JWT_SECRET, { expiresIn: '1h' });
}

export const tokens = {
  requester: createTestToken('employee-1', 'Alice', 'REQUESTER'),
  requester2: createTestToken('employee-2', 'Bob', 'REQUESTER'),
  approver: createTestToken('approver-1', 'Carol', 'APPROVER'),
};
