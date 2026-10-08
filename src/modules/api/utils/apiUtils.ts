/**
 * API-related utility functions
 */

import type {
  FullTextAnalysisResponse,
  TranslationResultStatus,
} from '../../shared/types/api';

/**
 * Merge custom parameters into the base parameter object
 */
export function mergeCustomParams(
  baseParams: any,
  customParamsJson?: string,
): any {
  const merged = { ...baseParams };
  const protectedKeys = ['model', 'messages', 'apiKey'];

  if (!customParamsJson?.trim()) return merged;

  try {
    const customParams = JSON.parse(customParamsJson);
    Object.entries(customParams).forEach(([key, value]) => {
      if (!protectedKeys.includes(key)) {
        merged[key] = value;
      } else {
        console.warn(`Ignoring protected parameter: ${key}`);
      }
    });
  } catch (error) {
    console.warn('Failed to parse custom parameters JSON:', error);
  }

  return merged;
}

/**
 * Create a generic error response. Error responses must never be cached.
 */
export function createErrorResponse(
  originalText: string,
  error?: string,
): FullTextAnalysisResponse {
  return {
    original: originalText,
    processed: originalText,
    replacements: [],
    status: 'error',
    error,
  };
}

/**
 * Create a successful response without replacements (cacheable).
 */
export function createEmptyResponse(
  originalText: string,
): FullTextAnalysisResponse {
  return {
    original: originalText,
    processed: '',
    replacements: [],
    status: 'empty',
  };
}

/**
 * Resolve the status of a response, deriving it from the replacements when the provider did not set one.
 */
export function getResponseStatus(
  response: FullTextAnalysisResponse | null | undefined,
): TranslationResultStatus {
  if (!response) {
    return 'error';
  }
  if (response.status) {
    return response.status;
  }
  return response.replacements.length > 0 ? 'ok' : 'empty';
}

/**
 * Validate text and configuration
 */
export function validateInputs(text: string, apiKey?: string): boolean {
  return !!(text?.trim() && apiKey?.trim());
}
