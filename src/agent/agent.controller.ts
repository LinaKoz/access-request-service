import { Request, Response } from 'express';
import { z } from 'zod';
import { handleQuery } from './agent.service';

const querySchema = z.object({
  query: z.string().min(1, 'query is required'),
});

/**
 * Handles natural-language query about access requests. Requires authentication.
 *
 * @throws {ZodError} 400 - Missing or invalid query in body
 */
export async function agentQuery(req: Request, res: Response): Promise<void> {
  const { query } = querySchema.parse(req.body);
  const result = await handleQuery(query);
  res.json({ data: result });
}
