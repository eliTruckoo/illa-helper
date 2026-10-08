/**
 * API proxy service - handles API requests via the background script, bypassing CORS restrictions
 *
 * - A global priority semaphore caps concurrent upstream requests across all
 *   tabs; requests from the active tab (and extension pages) go first.
 * - Every attempt is bounded by a timeout (AbortController).
 * - Requests are tracked per tab and per requesting document; they are aborted
 *   when the tab closes or the document's lifetime port disconnects
 *   (navigation, reload, frame removal).
 * - Transient upstream failures (408/429/5xx) are retried with exponential
 *   backoff + jitter, honouring Retry-After. Other 4xx are never retried.
 */

import { browser } from 'wxt/browser';
import {
  ApiRequestMessage,
  ApiResponse,
  ApiErrorResponse,
  ApiProxyServiceConfig,
  BACKGROUND_CONSTANTS,
} from '../types';
import {
  getRetryDecision,
  parseRetryAfter,
  resolveRequestTimeout,
} from '../../infrastructure/ratelimit/retryPolicy';
import {
  PriorityLimiter,
  REQUEST_PRIORITY,
} from '../../infrastructure/ratelimit/PriorityLimiter';

/**
 * The parts of runtime.MessageSender the proxy relies on
 */
export interface ApiRequestSender {
  tab?: { id?: number; active?: boolean; windowId?: number };
  frameId?: number;
}

interface ActiveRequest {
  controller: AbortController;
  tabId?: number;
  clientId?: string;
}

interface LimiterTag {
  tabId?: number;
}

const MAX_ERROR_DETAIL_LENGTH = 500;

export class ApiProxyService {
  private static instance: ApiProxyService | null = null;
  private config: ApiProxyServiceConfig;
  private activeRequests: Map<string, ActiveRequest> = new Map();
  private requestCounter = 0;
  private listenersRegistered = false;
  private limiter: PriorityLimiter<LimiterTag>;
  /** Active tab per window, kept current via tabs.onActivated */
  private activeTabByWindow: Map<number, number> = new Map();

  private constructor() {
    this.config = {
      defaultTimeout: BACKGROUND_CONSTANTS.API_REQUEST_TIMEOUT,
      unlimitedTimeoutCeiling:
        BACKGROUND_CONSTANTS.API_UNLIMITED_TIMEOUT_CEILING,
      maxRetries: 2,
      retryDelay: 1000,
      maxRetryDelay: 8000,
      maxRetryAfter: 20000,
      maxConcurrentRequests: 4,
    };
    this.limiter = new PriorityLimiter<LimiterTag>(
      this.config.maxConcurrentRequests,
    );
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): ApiProxyService {
    if (!ApiProxyService.instance) {
      ApiProxyService.instance = new ApiProxyService();
    }
    return ApiProxyService.instance;
  }

  /**
   * Register the listeners that cancel requests whose requester went away.
   * Idempotent.
   */
  public registerLifecycleListeners(): void {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    // Each requesting document holds a port; it disconnects on unload/navigation
    browser.runtime.onConnect.addListener((port) => {
      const prefix = BACKGROUND_CONSTANTS.API_CLIENT_PORT_PREFIX;
      if (!port.name?.startsWith(prefix)) return;
      const clientId = port.name.slice(prefix.length);
      port.onDisconnect.addListener(() => {
        this.cancelClientRequests(clientId);
      });
    });

    browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
      this.cancelTabRequests(tabId);
      if (this.activeTabByWindow.get(removeInfo?.windowId) === tabId) {
        this.activeTabByWindow.delete(removeInfo.windowId);
      }
    });

    // Queued requests follow the user: the newly active tab jumps the queue
    browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
      this.setActiveTab(windowId, tabId);
    });
  }

  /**
   * Record the active tab of a window and reorder queued requests
   */
  public setActiveTab(windowId: number, tabId: number): void {
    const previous = this.activeTabByWindow.get(windowId);
    this.activeTabByWindow.set(windowId, tabId);
    if (previous !== undefined && previous !== tabId) {
      this.limiter.reprioritize(
        (tag) => tag?.tabId === previous,
        REQUEST_PRIORITY.BACKGROUND,
      );
    }
    this.limiter.reprioritize(
      (tag) => tag?.tabId === tabId,
      REQUEST_PRIORITY.FOREGROUND,
    );
  }

  /**
   * Requests from extension pages (no tab) and from the active tab go first
   */
  private getPriority(sender?: ApiRequestSender): number {
    const tab = sender?.tab;
    if (!tab || tab.id === undefined) return REQUEST_PRIORITY.FOREGROUND;

    if (tab.windowId !== undefined) {
      const activeTabId = this.activeTabByWindow.get(tab.windowId);
      if (activeTabId === undefined) {
        if (tab.active) this.activeTabByWindow.set(tab.windowId, tab.id);
      } else {
        return activeTabId === tab.id
          ? REQUEST_PRIORITY.FOREGROUND
          : REQUEST_PRIORITY.BACKGROUND;
      }
    }
    return tab.active
      ? REQUEST_PRIORITY.FOREGROUND
      : REQUEST_PRIORITY.BACKGROUND;
  }

  /**
   * Handle an API request
   */
  public async handleApiRequest(
    message: ApiRequestMessage,
    sender?: ApiRequestSender,
  ): Promise<ApiResponse> {
    const requestId = `req-${++this.requestCounter}`;
    const controller = new AbortController();
    this.activeRequests.set(requestId, {
      controller,
      tabId: sender?.tab?.id,
      clientId: message.data.clientId,
    });

    let release: (() => void) | undefined;
    try {
      release = await this.limiter.acquire({
        priority: this.getPriority(sender),
        signal: controller.signal,
        tag: { tabId: sender?.tab?.id },
      });
      return await this.executeWithRetry(message.data, controller.signal);
    } catch (error: any) {
      if (controller.signal.aborted) {
        return createAbortedResponse();
      }
      console.error('Background API request failed:', error);
      return {
        success: false,
        error: { message: error?.message || 'Request failed' },
      };
    } finally {
      release?.();
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Run the request, retrying transient upstream failures
   */
  private async executeWithRetry(
    data: ApiRequestMessage['data'],
    signal: AbortSignal,
  ): Promise<ApiResponse> {
    const timeout = resolveRequestTimeout(
      data.timeout,
      this.config.defaultTimeout,
      this.config.unlimitedTimeoutCeiling,
    );

    for (let retriesDone = 0; ; retriesDone++) {
      const result = await this.fetchOnce(data, signal, timeout);
      if (result.success || result.error.code !== 'http') {
        return result;
      }

      const decision = getRetryDecision(
        result.error.status,
        retriesDone,
        result.error.retryAfter,
        {
          maxRetries: this.config.maxRetries,
          baseDelay: this.config.retryDelay,
          maxDelay: this.config.maxRetryDelay,
          maxRetryAfter: this.config.maxRetryAfter,
        },
      );
      if (!decision.retry) {
        return result;
      }

      console.warn(
        `[ApiProxy] HTTP ${result.error.status}, retry ${retriesDone + 1}/${this.config.maxRetries} in ${decision.delayMs} ms`,
      );
      if (!(await waitFor(decision.delayMs, signal))) {
        return createAbortedResponse();
      }
    }
  }

  /**
   * A single upstream attempt bounded by `timeout`
   */
  private async fetchOnce(
    data: ApiRequestMessage['data'],
    signal: AbortSignal,
    timeout: number,
  ): Promise<ApiResponse> {
    if (signal.aborted) {
      return createAbortedResponse();
    }

    const { url, method, headers, body } = data;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      // Read the response data (still covered by the timeout)
      const responseData = await response.text();
      let parsedData;

      try {
        parsedData = JSON.parse(responseData);
      } catch {
        parsedData = responseData;
      }

      if (response.ok) {
        return {
          success: true,
          data: parsedData,
        };
      }

      const detail = extractErrorDetail(parsedData);
      return {
        success: false,
        error: {
          message: `HTTP ${response.status}: ${detail || response.statusText}`,
          status: response.status,
          statusText: response.statusText,
          code: 'http',
          retryAfter: parseRetryAfter(response.headers.get('retry-after')),
        },
      };
    } catch (error: any) {
      if (timedOut) {
        return {
          success: false,
          error: {
            message: `Request timed out after ${timeout} ms`,
            status: 408,
            statusText: 'Request Timeout',
            code: 'timeout',
          },
        };
      }
      if (signal.aborted) {
        return createAbortedResponse();
      }
      console.error('Background API request failed:', error);
      return {
        success: false,
        error: {
          message: error?.message || 'Request failed',
          code: 'network',
        },
      };
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Number of requests queued, in flight or waiting for a retry
   */
  public getActiveRequestCount(): number {
    return this.activeRequests.size;
  }

  /**
   * Snapshot of the global request limiter
   */
  public getConcurrencyStats(): { running: number; queued: number } {
    return {
      running: this.limiter.activeCount,
      queued: this.limiter.pendingCount,
    };
  }

  /**
   * Cancel the requests of one tab (tab closed)
   */
  public cancelTabRequests(tabId: number): void {
    this.cancelWhere((request) => request.tabId === tabId);
  }

  /**
   * Cancel the requests of one document (its lifetime port disconnected)
   */
  public cancelClientRequests(clientId: string): void {
    this.cancelWhere((request) => request.clientId === clientId);
  }

  /**
   * Cancel all active requests
   */
  public cancelAllRequests(): void {
    this.cancelWhere(() => true);
  }

  private cancelWhere(predicate: (request: ActiveRequest) => boolean): void {
    this.activeRequests.forEach((request, requestId) => {
      if (predicate(request)) {
        request.controller.abort();
        this.activeRequests.delete(requestId);
      }
    });
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<ApiProxyServiceConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
    this.limiter.setMaxConcurrent(this.config.maxConcurrentRequests);
  }

  /**
   * Destroy the service
   */
  public destroy(): void {
    this.cancelAllRequests();
    ApiProxyService.instance = null;
  }
}

function createAbortedResponse(): ApiErrorResponse {
  return {
    success: false,
    error: {
      message: 'Request cancelled',
      status: 499,
      statusText: 'Client Closed Request',
      code: 'aborted',
    },
  };
}

/**
 * Pull a short, human-readable error message out of an upstream error body
 */
function extractErrorDetail(data: unknown): string {
  let detail = '';
  if (typeof data === 'string') {
    detail = data;
  } else if (data && typeof data === 'object') {
    const anyData = data as any;
    detail =
      anyData.error?.message ||
      (typeof anyData.error === 'string' ? anyData.error : '') ||
      anyData.message ||
      '';
  }
  detail = String(detail).trim();
  return detail.length > MAX_ERROR_DETAIL_LENGTH
    ? `${detail.slice(0, MAX_ERROR_DETAIL_LENGTH)}...`
    : detail;
}

/**
 * Wait for `ms`; resolves false early if the signal aborts
 */
function waitFor(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
