export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  isRetryable: (err: unknown) => boolean;
}

/**
 * Executes `fn` with automatic retries on transient failures.
 *
 * @param fn - Async function to execute
 * @param options.maxAttempts - Total attempts including the first (must be >= 1)
 * @param options.baseDelayMs - Initial delay in ms; doubles each attempt (exponential backoff)
 *   Delay formula: `baseDelayMs * 2^(attempt - 1)` — e.g. 300, 600, 1200 …
 * @param options.isRetryable - Predicate the caller provides to classify errors.
 *   Returning `false` causes an immediate rethrow with no further attempts.
 * @returns The resolved value of `fn`
 * @throws The last error if all attempts are exhausted, or the first non-retryable error
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxAttempts, baseDelayMs, isRetryable } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt === maxAttempts) {
        throw err;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
