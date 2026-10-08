/**
 * Rate limit service type definitions
 * Includes types for rate limiters, managers, configuration, etc.
 */

// ==================== Rate limit configuration ====================

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  requestsPerSecond: number;
  enabled: boolean;
  windowMs?: number;
  bufferMs?: number;
}

/**
 * Rate limiter state
 */
export interface RateLimiterStatus {
  enabled: boolean;
  requestsPerSecond: number;
  currentRequests: number;
  remainingRequests: number;
  nextResetTime?: number;
}

/**
 * Batch execution configuration
 */
export interface BatchExecutionConfig {
  maxConcurrency?: number;
  delayBetweenBatches?: number;
  enableProgressTracking?: boolean;
}

/**
 * Batch execution result
 */
export interface BatchExecutionResult<T> {
  results: T[];
  totalExecuted: number;
  totalFailed: number;
  executionTime: number;
  errors: Error[];
}

/**
 * Batch execution progress
 */
export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  percentage: number;
  estimatedTimeRemaining?: number;
}

// ==================== Request function types ====================

/**
 * Request function types
 */
export type RequestFunction<T = any> = () => Promise<T>;

/**
 * Progress callback function type
 */
export type ProgressCallback = (progress: BatchProgress) => void;

// ==================== Service configuration ====================

/**
 * Rate limit service configuration
 */
export interface RateLimiterServiceConfig {
  enableLogging?: boolean;
  enableMetrics?: boolean;
  defaultWindowMs?: number;
  defaultBufferMs?: number;
  maxLimiters?: number;
}

/**
 * Rate limiter event types
 */
export enum RateLimiterEventType {
  REQUEST_ALLOWED = 'request_allowed',
  REQUEST_THROTTLED = 'request_throttled',
  BATCH_STARTED = 'batch_started',
  BATCH_COMPLETED = 'batch_completed',
  BATCH_PROGRESS = 'batch_progress',
  LIMITER_CREATED = 'limiter_created',
  LIMITER_UPDATED = 'limiter_updated',
  LIMITER_REMOVED = 'limiter_removed',
}

/**
 * Rate limiter event data
 */
export interface RateLimiterEventData {
  type: RateLimiterEventType;
  timestamp: number;
  endpoint?: string;
  data?: any;
  error?: string;
}

/**
 * Event listener type
 */
export type RateLimiterEventListener = (event: RateLimiterEventData) => void;

// ==================== Statistics and metrics ====================

/**
 * Rate limit statistics
 */
export interface RateLimiterStats {
  totalRequests: number;
  allowedRequests: number;
  throttledRequests: number;
  averageWaitTime: number;
  peakRequestsPerSecond: number;
  activeEndpoints: number;
}

/**
 * Endpoint statistics
 */
export interface EndpointStats {
  endpoint: string;
  totalRequests: number;
  allowedRequests: number;
  throttledRequests: number;
  averageWaitTime: number;
  lastRequestTime: number;
  config: RateLimiterConfig;
}

// ==================== Factory and manager types ====================

/**
 * Rate limiter factory options
 */
export interface LimiterFactoryOptions {
  defaultConfig?: Partial<RateLimiterConfig>;
  enableCaching?: boolean;
  maxCacheSize?: number;
}

/**
 * Manager state
 */
export interface ManagerStatus {
  totalLimiters: number;
  activeLimiters: number;
  globalStats: RateLimiterStats;
  endpointStats: EndpointStats[];
  isHealthy: boolean;
}
