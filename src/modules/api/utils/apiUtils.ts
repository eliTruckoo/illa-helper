/**
 * API-related utility functions
 */

import type {
  ApiConfig,
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

/**
 * Models whose output budget includes hidden reasoning tokens (or that reject `max_tokens`).
 * A tight output cap would truncate their answer, so it is not applied to them.
 */
const OPENAI_REASONING_MODEL_PATTERN =
  /(^|[/:])(o\d|gpt-5)|reason|think|qwq|deepseek-r1|(^|[-_/])r1([-_:]|$)/i;

/**
 * Whether an output token cap (max_tokens) can safely be sent to an OpenAI-compatible endpoint.
 */
export function supportsOpenAIOutputCap(config: ApiConfig): boolean {
  if (config.includeThinkingParam && config.enable_thinking) {
    return false;
  }
  return !OPENAI_REASONING_MODEL_PATTERN.test(config.model || '');
}

/**
 * Gemini generation settings for a capped answer, or null when the model must not be capped.
 * maxOutputTokens includes thinking tokens on Gemini 2.5+, so the cap is only applied when thinking
 * is unavailable (1.x / 2.0 / Gemma) or can be switched off (2.5 Flash / Flash-Lite: thinkingBudget 0).
 * Pro and newer models think by default and are left uncapped.
 */
export function getGeminiOutputConfig(
  model: string,
  maxOutputTokens: number | undefined,
): Record<string, any> | null {
  if (!maxOutputTokens) {
    return null;
  }

  const name = (model || '').toLowerCase();
  if (/gemini-2\.5-flash/.test(name)) {
    return { maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } };
  }
  if (/gemini-(1\.|2\.0)|gemma/.test(name)) {
    return { maxOutputTokens };
  }
  return null;
}
