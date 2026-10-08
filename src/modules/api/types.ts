/**
 * API module type definitions
 */

import {
  BatchAnalysisResponse,
  FullTextAnalysisResponse,
} from '../shared/types/api';
import { UserSettings } from '../shared/types/storage';

/**
 * Optional per-request hints for word-mode analysis
 */
export interface AnalyzeOptions {
  /** Page glossary words already shown for this text; the model is asked not to output them */
  alreadyHandled?: string[];
}

export interface AnalyzeBatchOptions {
  /** Per item (same order as the texts): page glossary words the model should not output */
  alreadyHandled?: Array<string[] | undefined>;
}

/**
 * Translation provider interface
 */
export interface ITranslationProvider {
  analyzeFullText(
    text: string,
    settings: UserSettings,
    options?: AnalyzeOptions,
  ): Promise<FullTextAnalysisResponse>;
  /**
   * Analyze several segments in one request (numbered input/output).
   * Optional: callers fall back to analyzeFullText per segment.
   */
  analyzeBatch?(
    texts: string[],
    settings: UserSettings,
    options?: AnalyzeBatchOptions,
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
