/**
 * API module type definitions
 */

import {
  BatchAnalysisResponse,
  FullTextAnalysisResponse,
} from '../shared/types/api';
import { UserSettings } from '../shared/types/storage';

/**
 * Translation provider interface
 */
export interface ITranslationProvider {
  analyzeFullText(
    text: string,
    settings: UserSettings,
  ): Promise<FullTextAnalysisResponse>;
  /**
   * Analyze several segments in one request (numbered input/output).
   * Optional: callers fall back to analyzeFullText per segment.
   */
  analyzeBatch?(
    texts: string[],
    settings: UserSettings,
  ): Promise<BatchAnalysisResponse>;
}

/**
 * One chat completion sent by a provider
 */
export interface CompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  /** Output token cap; undefined = provider default */
  maxOutputTokens?: number;
}

/**
 * Raw provider answer
 */
export interface CompletionResult {
  text: string;
  /** Raw usage payload (OpenAI `usage` / Gemini `usageMetadata`) */
  usage?: unknown;
  /** The answer hit the output token cap */
  truncated?: boolean;
}

/**
 * API request configuration
 */
export interface ApiRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeout: number;
}

/**
 * Background proxy response
 */
export interface BackgroundProxyResponse {
  success: boolean;
  data?: any;
  error?: {
    status?: number;
    statusText?: string;
    message?: string;
  };
}
