import { logger } from '../config/logger';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

/**
 * Circuit states:
 * - **CLOSED** — Normal operation. Calls pass through to the wrapped function.
 *   Consecutive failures are counted; when they reach `failureThreshold` the
 *   circuit transitions to OPEN.
 * - **OPEN** — The wrapped function is assumed to be unhealthy. All calls fail
 *   immediately with `CircuitOpenError` (no invocation). After `resetTimeoutMs`
 *   elapses the circuit moves to HALF_OPEN.
 * - **HALF_OPEN** — A single probe call is allowed through. On success the
 *   circuit resets to CLOSED; on failure it returns to OPEN.
 */
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  public readonly circuitName: string;

  constructor(circuitName: string) {
    super(`Circuit "${circuitName}" is OPEN — call rejected`);
    this.name = 'CircuitOpenError';
    this.circuitName = circuitName;
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions,
  ) {}

  /**
   * Executes `fn` subject to circuit breaker logic.
   *
   * @throws {CircuitOpenError} When the circuit is OPEN and the reset timeout
   *   has not yet elapsed.
   * @throws Re-throws any error from `fn` after updating internal state.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.options.resetTimeoutMs) {
        this.transition('HALF_OPEN');
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await fn();

      if (this.state === 'HALF_OPEN') {
        this.transition('CLOSED');
      }
      this.failures = 0;

      return result;
    } catch (err) {
      this.failures++;

      if (this.state === 'HALF_OPEN') {
        this.trip();
      } else if (this.failures >= this.options.failureThreshold) {
        this.trip();
      }

      throw err;
    }
  }

  private trip(): void {
    this.transition('OPEN');
    this.openedAt = Date.now();
  }

  private transition(next: CircuitState): void {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    if (next === 'CLOSED') this.failures = 0;
    logger.info(
      { circuit: this.name, from: prev, to: next },
      'Circuit breaker state transition',
    );
  }
}
