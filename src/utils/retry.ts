export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  isRetryable: (err: unknown) => boolean;
  /** Extract a server-suggested delay (in ms) from the error, e.g. from a Retry-After header. */
  getRetryDelay?: (err: unknown) => number | undefined;
}

/**
 * Executes `fn` with automatic retries on transient failures.
 *
 * @param fn - Async function to execute
 * @param options.maxAttempts - Total attempts including the first (must be >= 1)
 * @param options.baseDelayMs - Initial delay in ms; doubles each attempt (exponential backoff)
 *   Delay formula: `baseDelayMs * 2^(attempt - 1)` — e.g. 300, 600, 1200 …
 *   Jitter is applied (50–100% of computed delay) to avoid thundering-herd retries.
 * @param options.maxDelayMs - Optional upper bound on any single retry delay
 * @param options.isRetryable - Predicate the caller provides to classify errors.
 *   Returning `false` causes an immediate rethrow with no further attempts.
 * @param options.getRetryDelay - Optional hook to read a server-suggested delay from the error.
 *   When provided and returns a number, that value is used instead of exponential backoff.
 * @returns The resolved value of `fn`
 * @throws The last error if all attempts are exhausted, or the first non-retryable error
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, isRetryable, getRetryDelay } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt === maxAttempts) {
        throw err;
      }

      const serverDelay = getRetryDelay?.(err);
      let delayMs: number;
      if (serverDelay !== undefined) {
        delayMs = serverDelay;
      } else {
        const backoff = baseDelayMs * Math.pow(2, attempt - 1);
        delayMs = backoff * (0.5 + Math.random() * 0.5);
      }
      if (maxDelayMs !== undefined) {
        delayMs = Math.min(delayMs, maxDelayMs);
      }

      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
