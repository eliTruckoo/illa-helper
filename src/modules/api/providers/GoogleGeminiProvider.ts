/**
 * Google Gemini translation provider
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { UserSettings } from '../../shared/types/storage';
import { BaseProvider } from '../base/BaseProvider';
import { CompletionRequest, CompletionResult } from '../types';
import { mergeCustomParams, getGeminiOutputConfig } from '../utils/apiUtils';
import { getApiTimeout, mapParamsForProvider } from '@/src/utils';
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
    const genAI = new GoogleGenerativeAI(this.config.apiKey);

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

    // Request options, such as timeout and proxy endpoint
    const requestOptions: { timeout?: number; baseUrl?: string } = {};
    const timeout = getApiTimeout(settings.apiRequestTimeout);
    if (timeout) {
      requestOptions.timeout = timeout;
    }
    if (this.config.apiEndpoint) {
      requestOptions.baseUrl = this.config.apiEndpoint;
    }

    const model = genAI.getGenerativeModel(
      {
        model: this.config.model,
        generationConfig,
      },
      requestOptions,
    );

    const prompt = `${request.systemPrompt}\n\n${request.userPrompt}`;
    const rateLimiter = rateLimitManager.getLimiter(
      this.config.apiEndpoint || 'google-gemini-native',
      this.config.requestsPerSecond || 0,
      true,
    );

    const apiRequestFunction = () => model.generateContent(prompt);

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
