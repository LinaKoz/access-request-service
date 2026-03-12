import { logger } from '../config/logger';

export interface EvaluationResult {
  queryUnderstood: boolean;
  hadRelevantData: boolean;
  score: number;
}

/**
 * Scores agent response on query understanding and data relevance.
 * Uses rule-based heuristics; logs outcomes for observability.
 *
 * @returns { queryUnderstood, hadRelevantData, score } — score 0–100
 */
export function evaluate(
  query: string,
  responseType: 'answered' | 'fallback',
  dataItemCount: number,
): EvaluationResult {
  const queryUnderstood = responseType === 'answered';
  const hadRelevantData = dataItemCount > 0;

  let score = 0;
  if (queryUnderstood) score += 50;
  if (hadRelevantData) score += 50;

  const result: EvaluationResult = { queryUnderstood, hadRelevantData, score };

  logger.info(
    { query, score, queryUnderstood, hadRelevantData },
    'Agent evaluation',
  );

  return result;
}
