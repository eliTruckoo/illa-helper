/**
 * Rate limiting service
 * Controls the rate of API requests to prevent overly fast requests from triggering service limits
 */

import { RateLimiterConfig, RateLimiterStatus, RequestFunction } from './types';

/**
 * Simple rate limiter
 */
class SimpleRateLimiter {
  private requestTimes: number[] = [];
  private config: RateLimiterConfig;
  private executionQueue: Promise<any> = Promise.resolve();

  constructor(config: RateLimiterConfig) {
    this.config = {
      windowMs: 1000,
      bufferMs: 10,
      ...config,
    };
  }

  async checkAndWait(): Promise<void> {
    const chainedPromise = this.executionQueue.then(async () => {
      if (!this.config.enabled || this.config.requestsPerSecond <= 0) {
        return;
      }

      const now = Date.now();
      const windowMs = this.config.windowMs!;

      // Clean up expired request records
      while (
        this.requestTimes.length > 0 &&
        now - this.requestTimes[0] >= windowMs
      ) {
        this.requestTimes.shift();
      }

      // If the request count in the current window has reached the limit, wait
      if (this.requestTimes.length >= this.config.requestsPerSecond) {
        const oldestRequest = this.requestTimes[0];
        const waitTime =
          windowMs - (now - oldestRequest) + this.config.bufferMs!;

        if (waitTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }

        // Clean up again after waiting
        const newNow = Date.now();
        while (
          this.requestTimes.length > 0 &&
          newNow - this.requestTimes[0] >= windowMs
        ) {
          this.requestTimes.shift();
        }
      }

      // Record the time of this request
      this.requestTimes.push(Date.now());
    });

    this.executionQueue = chainedPromise;
    return chainedPromise;
  }

  updateConfig(config: Partial<RateLimiterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async executeBatch<T>(requestFunctions: RequestFunction<T>[]): Promise<T[]> {
    if (!this.config.enabled || requestFunctions.length === 0) {
      return Promise.all(requestFunctions.map((fn) => fn()));
    }

    const results: T[] = [];
    for (const requestFn of requestFunctions) {
      await this.checkAndWait();
      const result = await requestFn();
      results.push(result);
    }
    return results;
  }

  getStatus(): RateLimiterStatus {
    const now = Date.now();
    const windowMs = this.config.windowMs!;
    const recentRequests = this.requestTimes.filter(
      (time) => now - time < windowMs,
    );

    return {
      enabled: this.config.enabled,
      requestsPerSecond: this.config.requestsPerSecond,
      currentRequests: recentRequests.length,
      remainingRequests: Math.max(
        0,
        this.config.requestsPerSecond - recentRequests.length,
      ),
    };
  }
}

/**
 * Rate limiting service
 */
export class RateLimiterService {
  private static instance: RateLimiterService;
  private limiters = new Map<string, SimpleRateLimiter>();

  private constructor() {}

  public static getInstance(): RateLimiterService {
    if (!RateLimiterService.instance) {
      RateLimiterService.instance = new RateLimiterService();
    }
    return RateLimiterService.instance;
  }

  public getLimiter(
    endpoint: string,
    requestsPerSecond: number = 0,
    enabled: boolean = true,
  ): SimpleRateLimiter {
    if (!this.limiters.has(endpoint)) {
      const config: RateLimiterConfig = {
        requestsPerSecond: Math.max(0, requestsPerSecond),
        enabled: enabled && requestsPerSecond > 0,
      };
      this.limiters.set(endpoint, new SimpleRateLimiter(config));
    } else {
      const limiter = this.limiters.get(endpoint)!;
      limiter.updateConfig({
        requestsPerSecond: Math.max(0, requestsPerSecond),
        enabled: enabled && requestsPerSecond > 0,
      });
    }
    return this.limiters.get(endpoint)!;
  }

  public clear(): void {
    this.limiters.clear();
  }
}

// Exports
export const rateLimiterService = RateLimiterService.getInstance();

export const rateLimitManager = {
  getLimiter: (
    endpoint: string,
    requestsPerSecond: number = 0,
    enabled: boolean = true,
  ) => {
    return rateLimiterService.getLimiter(endpoint, requestsPerSecond, enabled);
  },
  clear: () => {
    rateLimiterService.clear();
  },
};

export { SimpleRateLimiter };

export function debugRateLimiters(): void {
  console.log('[RateLimit Debug] Rate limit service loaded');
}

export default RateLimiterService;
