/**
 * API retry wrapper with exponential backoff and 429 handling.
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
  onRateLimit?: (retryAfterMs: number) => void;
}

function isTransientError(err: any): boolean {
  // Network errors
  if (err.code === "ECONNRESET" || err.code === "ENOTFOUND" || err.code === "ETIMEDOUT" ||
      err.code === "ECONNREFUSED" || err.code === "EAI_AGAIN") {
    return true;
  }
  // HTTP 5xx or 429
  if (err.status >= 500 || err.status === 429) return true;
  // Anthropic SDK error types
  if (err.error?.type === "overloaded_error") return true;
  return false;
}

function getRetryAfterMs(err: any): number | null {
  // Check for Retry-After header in various places
  const retryAfter = err.headers?.["retry-after"] ?? err.response?.headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) return seconds * 1000;
  }
  return null;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, initialDelayMs = 1000, maxDelayMs = 8000, onRetry, onRateLimit } = opts;
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;

      if (attempt > maxRetries || !isTransientError(err)) {
        throw err;
      }

      // Check for 429 rate limit
      if (err.status === 429) {
        const retryAfterMs = getRetryAfterMs(err) ?? initialDelayMs * Math.pow(2, attempt);
        onRateLimit?.(retryAfterMs);
        onRetry?.(attempt, retryAfterMs, err);
        await sleep(retryAfterMs);
        continue;
      }

      // Exponential backoff
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      onRetry?.(attempt, delay, err);
      await sleep(delay);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
