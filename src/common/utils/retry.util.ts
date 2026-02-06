export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isRetryable(error: Error): boolean {
  const retryablePatterns = [
    'net::ERR_',
    'ETIMEDOUT',
    'ECONNRESET',
    'Navigation timeout',
  ];
  return retryablePatterns.some(p => error.message.includes(p));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000, maxDelay = 10000 } = options;
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (!isRetryable(lastError) || attempt === maxAttempts) {
        throw error;
      }
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      await sleep(delay);
    }
  }

  throw lastError!;
}
