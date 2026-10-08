/**
 * Rate limit service unified entry
 * Exports all rate-limit related functionality
 */

// Service class exports
export {
  default as RateLimiterService,
  rateLimiterService,
  rateLimitManager,
  SimpleRateLimiter,
  debugRateLimiters,
} from './RateLimiterService';

// Type definition exports
export type {
  RateLimiterConfig,
  RateLimiterStatus,
  BatchExecutionConfig,
  BatchExecutionResult,
  BatchProgress,
  RequestFunction,
  ProgressCallback,
  RateLimiterServiceConfig,
  RateLimiterEventData,
  RateLimiterEventListener,
  RateLimiterStats,
  EndpointStats,
  ManagerStatus,
} from './types';

export { RateLimiterEventType } from './types';

// Default export
export { rateLimiterService as default } from './RateLimiterService';
