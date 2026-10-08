/**
 * API module type definitions
 */

import { FullTextAnalysisResponse } from '../shared/types/api';
import { UserSettings } from '../shared/types/storage';

/**
 * Translation provider interface
 */
export interface ITranslationProvider {
  analyzeFullText(
    text: string,
    settings: UserSettings,
  ): Promise<FullTextAnalysisResponse>;
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
