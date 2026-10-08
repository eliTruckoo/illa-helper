/**
 * Google Gemini translation provider
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { FullTextAnalysisResponse } from '../../shared/types/api';
import { UserSettings } from '../../shared/types/storage';
import { BaseProvider } from '../base/BaseProvider';
import { mergeCustomParams } from '../utils/apiUtils';
import { addPositionsToReplacements } from '../utils/textUtils';
import { getSystemPromptByConfig } from '../../core/translation/PromptService';
import { getApiTimeout, mapParamsForProvider } from '@/src/utils';
import { rateLimitManager } from '../../infrastructure/ratelimit';
import { StructuredTextParser } from '../utils/structuredTextParser';
import { languageService } from '../../core/translation/LanguageService';

/**
 * Google Gemini API provider implementation
 */
export class GoogleGeminiProvider extends BaseProvider {
  protected getProviderName(): string {
    return 'Google Gemini';
  }

  protected async doAnalyzeFullText(
    text: string,
    settings: UserSettings,
  ): Promise<FullTextAnalysisResponse> {
    const genAI = new GoogleGenerativeAI(this.config.apiKey);

    // Base generation config
    const baseGenerationConfig: any = {
      temperature: this.config.temperature,
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

    const systemPrompt = getSystemPromptByConfig({
      targetLanguage: settings.multilingualConfig.targetLanguage,
      userLevel: settings.userLevel,
      replacementRate: settings.replacementRate,
    });

    const prompt = `${systemPrompt}\n\nTranslate to ${languageService.getTargetLanguageDisplayName(settings.multilingualConfig.targetLanguage)} (original||translation): ${text}`;
    const rateLimiter = rateLimitManager.getLimiter(
      this.config.apiEndpoint || 'google-gemini-native',
      this.config.requestsPerSecond || 0,
      true,
    );

    const apiRequestFunction = () => model.generateContent(prompt);

    const [result] = await rateLimiter.executeBatch([apiRequestFunction]);
    const response = result.response;
    const responseText = response.text();
    this.recordUsage(response.usageMetadata);

    // Use the structured text parser
    const parseResult = StructuredTextParser.parse(responseText);

    if (!parseResult.success) {
      console.error('[Gemini] Parsing failed:', parseResult.errors);
      throw new Error(
        `Structured text parsing failed: ${parseResult.errors.join(', ')}`,
      );
    }

    const replacements = addPositionsToReplacements(
      text,
      parseResult.replacements,
      { replacementRate: settings.replacementRate },
    );

    return {
      original: text,
      processed: '',
      replacements,
      status: replacements.length > 0 ? 'ok' : 'empty',
    };
  }
}
