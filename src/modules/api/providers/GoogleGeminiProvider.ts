/**
 * Google Gemini translation provider
 */

import { UserSettings } from '../../shared/types/storage';
import { BaseProvider } from '../base/BaseProvider';
import { CompletionRequest, CompletionResult } from '../types';
import { mergeCustomParams, getGeminiOutputConfig } from '../utils/apiUtils';
import { getApiTimeout, mapParamsForProvider } from '@/src/utils';
import { generateGeminiContent } from '../utils/requestUtils';
import { rateLimitManager } from '../../infrastructure/ratelimit';

/**
 * Google Gemini API provider implementation
 */
export class GoogleGeminiProvider extends BaseProvider {
  protected getProviderName(): string {
    return 'Google Gemini';
  }

  protected async requestCompletion(
    request: CompletionRequest,
    settings: UserSettings,
  ): Promise<CompletionResult> {
    // Base generation config
    const baseGenerationConfig: any = {
      temperature: this.config.temperature,
      // Output cap (+ thinking off where possible); customParams below can override it
      ...getGeminiOutputConfig(this.config.model, request.maxOutputTokens),
    };

    // Merge extra parameters from customParams
    let generationConfig = mergeCustomParams(
      baseGenerationConfig,
      this.config.customParams,
    );

    // Adapt parameters
    generationConfig = mapParamsForProvider(generationConfig, 'gemini');

    // Sent through the background proxy (timeout, retries, global concurrency cap)
    const timeout = getApiTimeout(settings.apiRequestTimeout);

    const prompt = `${request.systemPrompt}\n\n${request.userPrompt}`;
    const rateLimiter = rateLimitManager.getLimiter(
      this.config.apiEndpoint || 'google-gemini-native',
      this.config.requestsPerSecond || 0,
      true,
    );

    const apiRequestFunction = () =>
      generateGeminiContent(this.config, prompt, { generationConfig, timeout });

    const [result] = await rateLimiter.executeBatch([apiRequestFunction]);
    const response = result.response;
    const responseText = response.text();

    return {
      text: responseText,
      usage: response.usageMetadata,
      truncated: response.candidates?.[0]?.finishReason === 'MAX_TOKENS',
    };
  }
}
