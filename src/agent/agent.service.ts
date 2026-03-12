import { queryLlm } from './llm.client';
import { evaluate, EvaluationResult } from './agent.evaluator';
import * as requestRepo from '../modules/requests/request.repository';
import { logger } from '../config/logger';

export interface AgentResponse {
  answer: string;
  provider: string;
  evaluation: EvaluationResult;
  cached?: boolean;
  degraded?: boolean;
  degradedReason?: string;
}

// --- In-memory query cache ---

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  response: AgentResponse;
  expiresAt: number;
}

const queryCache = new Map<string, CacheEntry>();

const CACHE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of queryCache) {
    if (entry.expiresAt <= now) queryCache.delete(key);
  }
}, CACHE_SWEEP_INTERVAL_MS).unref();

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

const SUPPORTED_CAPABILITIES = [
  'Count requests by status',
  'Filter and list requests by application or status',
  'Lookup a single request by ID',
  'Summarize request activity for the last 7 days',
];

const SYSTEM_PROMPT = `You are an IT operations assistant for application access requests.
You support ONLY these capabilities:
${SUPPORTED_CAPABILITIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Always base your answers strictly on the provided data context.
Do not make up data or call external APIs.`;

/**
 * Processes a natural-language query with in-memory caching.
 * Repeated queries within the TTL window return the cached response
 * without hitting the DB or LLM again.
 *
 * @returns Answer, provider (mock), evaluation metrics, and cached flag
 */
export async function handleQuery(query: string): Promise<AgentResponse> {
  const key = normalizeQuery(query);

  const cached = queryCache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      logger.info({ query }, 'Agent query cache hit');
      return { ...cached.response, cached: true };
    }
    queryCache.delete(key);
  }

  logger.info({ query }, 'Agent query cache miss');

  const requests = await requestRepo.findMany({ limit: 200 });
  const context = buildContext(requests);

  const llmResponse = await queryLlm({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: query,
    context,
  });

  const evaluation = evaluate(query, llmResponse.responseType, requests.length);

  const response: AgentResponse = {
    answer: llmResponse.answer,
    provider: llmResponse.provider,
    evaluation,
  };

  if (llmResponse.degraded) {
    response.degraded = true;
    response.degradedReason = llmResponse.degradedReason;
  } else {
    queryCache.set(key, { response, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return response;
}

type RequestRecord = Awaited<ReturnType<typeof requestRepo.findMany>>[number];

function buildContext(requests: RequestRecord[]): string {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const byStatus: Record<string, number> = {};
  const byApp: Record<string, number> = {};
  let recentCount = 0;

  for (const req of requests) {
    byStatus[req.status] = (byStatus[req.status] || 0) + 1;
    byApp[req.application] = (byApp[req.application] || 0) + 1;
    if (new Date(req.createdAt) >= sevenDaysAgo) recentCount++;
  }

  const lines = [
    `Total requests: ${requests.length}`,
    `By status: ${JSON.stringify(byStatus)}`,
    `By application: ${JSON.stringify(byApp)}`,
    `Requests in last 7 days: ${recentCount}`,
    '',
    'Recent requests (up to 10):',
    ...requests.slice(0, 10).map(
      (r) => `  - [${r.status}] ${r.employeeName} requested ${r.application} (${r.id})`,
    ),
  ];

  return lines.join('\n');
}
