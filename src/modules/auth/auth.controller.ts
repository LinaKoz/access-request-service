import { Request, Response } from 'express';
import { z } from 'zod';
import { generateToken, getMockUsers } from './auth.service';

const tokenSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

/**
 * Issues a JWT for a mock user. No authentication required.
 *
 * @throws {ZodError} 400 - Invalid or missing userId in body
 * @throws {AppError} 400 - Unknown userId (via generateToken)
 */
export function createToken(req: Request, res: Response): void {
  const { userId } = tokenSchema.parse(req.body);
  const token = generateToken(userId);

  res.json({
    token,
    expiresIn: '24h',
    usage: 'Set header: Authorization: Bearer <token>',
  });
}

/** Returns the list of mock users available for token generation. */
export function listUsers(_req: Request, res: Response): void {
  res.json({ users: getMockUsers() });
}
