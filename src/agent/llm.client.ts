import { config } from '../config';
import { logger } from '../config/logger';
import { withRetry } from '../utils/retry';
import { CircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker';

export interface LlmRequest {
  systemPrompt: string;
  userMessage: string;
  context?: string;
}

export interface LlmResponse {
  answer: string;
  provider: 'openai' | 'mock';
  responseType: 'answered' | 'fallback';
  degraded?: boolean;
  degradedReason?: 'circuit_open' | 'upstream_failure';
}

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

const llmCircuitBreaker = new CircuitBreaker('openai', {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
});

function isRetryableError(err: unknown): boolean {
  if (err instanceof CircuitOpenError) return false;
  if (err instanceof Error) {
    const match = err.message.match(/OpenAI API error (\d+)/);
    if (match) {
      const status = parseInt(match[1], 10);
      return status === 429 || status >= 500;
    }
    return true;
  }
  return false;
}

/**
 * Mock LLM client using keyword matching. Swappable for real OpenAI/Azure/etc.
 * Returns answer + provider; does not call external APIs.
 */
export async function queryLlm(request: LlmRequest): Promise<LlmResponse> {
  logger.info({ userMessage: request.userMessage }, 'LLM query received');

  if (config.openaiApiKey) {
    try {
      return await withRetry(
        () => llmCircuitBreaker.execute(() => callOpenAI(request)),
        { maxAttempts: 2, baseDelayMs: 300, isRetryable: isRetryableError },
      );
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        logger.warn({ err, degradedReason: 'circuit_open' }, 'Circuit open, falling back to mock');
      } else {
        logger.warn({ err, degradedReason: 'upstream_failure' }, 'OpenAI call failed after retries, falling back to mock');
      }

      const degradedReason = err instanceof CircuitOpenError ? 'circuit_open' : 'upstream_failure';
      const { answer, responseType } = generateMockResponse(request.userMessage, request.context);

      return { answer, provider: 'mock', responseType, degraded: true, degradedReason };
    }
  }

  const { answer, responseType } = generateMockResponse(request.userMessage, request.context);

  return { answer, provider: 'mock', responseType };
}

async function callOpenAI(request: LlmRequest): Promise<LlmResponse> {
  const userContent = request.context
    ? `${request.userMessage}\n\nData:\n${request.context}`
    : request.userMessage;

  const body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
    max_tokens: 1024,
  };

  const res = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };

  const answer = data.choices[0]?.message?.content ?? '';

  return { answer, provider: 'openai', responseType: 'answered' };
}

interface MockResult {
  answer: string;
  responseType: 'answered' | 'fallback';
}

function generateMockResponse(query: string, context?: string): MockResult {
  const lower = query.toLowerCase();

  // Capability 1: Count by status
  if (lower.includes('how many') || lower.includes('count')) {
    return {
      answer: formatWithContext('Here is the breakdown of requests by status.', context),
      responseType: 'answered',
    };
  }

  // Capability 2: Filter and list
  if (lower.includes('show') || lower.includes('list') || lower.includes('filter')) {
    return {
      answer: formatWithContext('Here are the matching requests based on your filters.', context),
      responseType: 'answered',
    };
  }

  // Capability 3: Lookup by ID
  if (lower.includes('status of') || lower.includes('lookup') || lower.includes('find request')) {
    return {
      answer: formatWithContext('Here are the details for the requested access request.', context),
      responseType: 'answered',
    };
  }

  // Capability 4: Activity summary
  if (lower.includes('summary') || lower.includes('summarize') || lower.includes('activity') || lower.includes('last')) {
    return {
      answer: formatWithContext('Here is a summary of access request activity for the last 7 days.', context),
      responseType: 'answered',
    };
  }

  return {
    answer: formatWithContext(
      'I can help with questions about access requests. Try asking about request counts, filtering requests, looking up a request by ID, or summarizing recent activity.',
      context,
    ),
    responseType: 'fallback',
  };
}

function formatWithContext(message: string, context?: string): string {
  if (!context) return message;
  return `${message}\n\nData:\n${context}`;
}
