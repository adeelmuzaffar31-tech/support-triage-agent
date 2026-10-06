export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

export class RetryableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RetryableError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter. Only errors marked retryable are retried. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const {
    retries,
    baseDelayMs = 250,
    maxDelayMs = 4000,
    isRetryable = (e) => e instanceof RetryableError,
    onRetry,
    sleep = defaultSleep,
  } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = Math.floor(Math.random() * cap);
      onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
