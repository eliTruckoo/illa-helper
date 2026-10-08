/**
 * API proxy service - handles API requests via the background script, bypassing CORS restrictions
 */

import {
  ApiRequestMessage,
  ApiResponse,
  ApiProxyServiceConfig,
  BACKGROUND_CONSTANTS,
} from '../types';

export class ApiProxyService {
  private static instance: ApiProxyService | null = null;
  private config: ApiProxyServiceConfig;
  private activeRequests: Map<string, AbortController> = new Map();

  private constructor() {
    this.config = {
      defaultTimeout: BACKGROUND_CONSTANTS.API_REQUEST_TIMEOUT,
      maxRetries: 3,
      retryDelay: 1000,
    };
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
   * Handle an API request
   */
  public async handleApiRequest(
    message: ApiRequestMessage,
  ): Promise<ApiResponse> {
    const { url, method, headers, body, timeout } = message.data;
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      // Create an AbortController for timeout control
      const controller = new AbortController();

      // Only set the timeout when timeout is greater than 0
      if (timeout && timeout > 0) {
        timeoutId = setTimeout(() => controller.abort(), timeout);
      }

      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Read the response data
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
      } else {
        return {
          success: false,
          error: {
            message: `HTTP ${response.status}: ${response.statusText}`,
            status: response.status,
            statusText: response.statusText,
          },
        };
      }
    } catch (error: any) {
      console.error('Background API request failed:', error);

      let errorMessage = 'Request failed';
      if (error.name === 'AbortError') {
        errorMessage = 'Request timed out';
      } else if (error.message) {
        errorMessage = error.message;
      }

      return {
        success: false,
        error: {
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Cancel all active requests
   */
  public cancelAllRequests(): void {
    this.activeRequests.forEach((controller) => {
      controller.abort();
    });
    this.activeRequests.clear();
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<ApiProxyServiceConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
  }

  /**
   * Destroy the service
   */
  public destroy(): void {
    this.cancelAllRequests();
    ApiProxyService.instance = null;
  }
}
