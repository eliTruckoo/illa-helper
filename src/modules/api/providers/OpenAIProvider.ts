/**
 * OpenAI translation provider
 */

import { UserSettings } from '../../shared/types/storage';
import { BaseProvider } from '../base/BaseProvider';
import { CompletionRequest, CompletionResult } from '../types';
import { mergeCustomParams, supportsOpenAIOutputCap } from '../utils/apiUtils';
import { sendApiRequest } from '../utils/requestUtils';
import { getApiTimeout } from '@/src/utils';
import { rateLimitManager } from '../../infrastructure/ratelimit';

/**
 * OpenAI API provider implementation
 */
export class OpenAIProvider extends BaseProvider {
  protected getProviderName(): string {
    return 'OpenAI';
  }

  protected async requestCompletion(
    request: CompletionRequest,
    settings: UserSettings,
  ): Promise<CompletionResult> {
    let requestBody: any = {
      model: this.config.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      temperature: this.config.temperature,
    };

    // Reasoning models count hidden tokens against the cap, so they stay uncapped
    if (request.maxOutputTokens && supportsOpenAIOutputCap(this.config)) {
      requestBody.max_tokens = request.maxOutputTokens;
    }

    // Only sent when the endpoint accepts it; defaults to thinking off
    if (this.config.includeThinkingParam) {
      requestBody.enable_thinking = this.config.enable_thinking ?? false;
    }

    requestBody = mergeCustomParams(requestBody, this.config.customParams);
    // Some endpoints reject max_tokens together with a user-provided max_completion_tokens
    if (requestBody.max_completion_tokens !== undefined) {
      delete requestBody.max_tokens;
    }

    const rateLimiter = rateLimitManager.getLimiter(
      this.config.apiEndpoint,
      this.config.requestsPerSecond || 0,
      true,
    );

    const apiRequestFunction = async () => {
      const timeout = getApiTimeout(settings.apiRequestTimeout || 0);
      return sendApiRequest(requestBody, this.config, timeout);
    };

    const [response] = await rateLimiter.executeBatch([apiRequestFunction]);

    if (!response.ok) {
      console.error(
        `API request failed: ${response.status} ${response.statusText}`,
      );
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    if (!choice?.message) {
      throw new Error('Invalid API response format');
    }

    // An empty or null content is a valid "nothing to translate" answer
    const content = choice.message.content;
    return {
      text: typeof content === 'string' ? content : '',
      usage: data?.usage,
      truncated: choice.finish_reason === 'length',
    };
  }
}
