/**
 * Base translation provider abstract class
 */

import {
  ApiConfig,
  BatchAnalysisResponse,
  FullTextAnalysisResponse,
} from '../../shared/types/api';
import { UserSettings } from '../../shared/types/storage';
import {
  CompletionRequest,
  CompletionResult,
  ITranslationProvider,
} from '../types';
import {
  validateInputs,
  createErrorResponse,
  createEmptyResponse,
  getResponseStatus,
} from '../utils/apiUtils';
import {
  addPositionsToReplacements,
  estimateMaxOutputTokens,
} from '../utils/textUtils';
import { StructuredTextParser } from '../utils/structuredTextParser';
import { translationStats } from '../../core/translation/TranslationStats';
import {
  getBatchSystemPromptByConfig,
  getSystemPromptByConfig,
  promptService,
} from '../../core/translation/PromptService';
import { calculateReplacementLimit } from '../../processing/ReplacementBudget';

/**
 * Drop the last line of a truncated answer: it may be cut in the middle of a translation.
 */
export function dropIncompleteLastLine(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  const lastBreak = trimmed.lastIndexOf('\n');
  return lastBreak === -1 ? '' : trimmed.slice(0, lastBreak);
}

/**
 * Base provider abstract class
 * Provides shared prompt building, parsing and error handling; subclasses only implement the transport.
 */
export abstract class BaseProvider implements ITranslationProvider {
  protected config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  /**
   * Analyze full text - template method
   */
  async analyzeFullText(
    text: string,
    settings: UserSettings,
  ): Promise<FullTextAnalysisResponse> {
    const originalText = text || '';

    // Nothing to translate (or a 0% rate) is a successful empty result; no request is needed
    if (
      !originalText.trim() ||
      calculateReplacementLimit(originalText, settings.replacementRate) === 0
    ) {
      return createEmptyResponse(originalText);
    }

    // Validate input
    if (!validateInputs(originalText, this.config.apiKey)) {
      return createErrorResponse(originalText, 'API key is not configured');
    }

    try {
      translationStats.recordRequest(1);
      const result = await this.doAnalyzeFullText(originalText, settings);
      return { ...result, status: getResponseStatus(result) };
    } catch (error: any) {
      translationStats.recordError();
      console.error(`${this.getProviderName()} API request failed:`, error);
      return createErrorResponse(
        originalText,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Single-segment analysis: prompt with a line limit, capped output, "original||translation" parsing.
   */
  protected async doAnalyzeFullText(
    text: string,
    settings: UserSettings,
  ): Promise<FullTextAnalysisResponse> {
    const maxItems = calculateReplacementLimit(text, settings.replacementRate);

    const completion = await this.requestCompletion(
      {
        systemPrompt: getSystemPromptByConfig({
          targetLanguage: settings.multilingualConfig.targetLanguage,
          userLevel: settings.userLevel,
          replacementRate: settings.replacementRate,
        }),
        userPrompt: promptService.getUserPrompt(text, maxItems),
        maxOutputTokens: estimateMaxOutputTokens(maxItems),
      },
      settings,
    );
    this.recordUsage(completion.usage);

    const content = completion.truncated
      ? dropIncompleteLastLine(completion.text)
      : completion.text;
    const parseResult = StructuredTextParser.parse(content);
    if (!parseResult.success) {
      throw new Error(
        `Structured text parsing failed: ${parseResult.errors.join(', ')}`,
      );
    }

    const replacements = addPositionsToReplacements(
      text,
      parseResult.replacements,
      { replacementRate: settings.replacementRate },
    );

    // A truncated answer without a single usable line is a failure, not an empty answer
    if (replacements.length === 0 && completion.truncated) {
      throw new Error('Response was truncated before the first complete line');
    }

    return {
      original: text,
      processed: '',
      replacements,
      status: replacements.length > 0 ? 'ok' : 'empty',
    };
  }

  /**
   * Analyze several segments in one request.
   * Input items are numbered (<1 max=N>text</1>), answers are "n|original||translation" lines.
   * Items without any answer line are returned as undefined so the caller can retry them alone.
   */
  async analyzeBatch(
    texts: string[],
    settings: UserSettings,
  ): Promise<BatchAnalysisResponse> {
    const items: Array<FullTextAnalysisResponse | undefined> = texts.map(
      () => undefined,
    );

    // Items that cannot produce replacements are answered locally and not sent
    const requestItems: Array<{
      index: number;
      text: string;
      maxItems?: number;
    }> = [];
    texts.forEach((rawText, index) => {
      const text = rawText || '';
      const maxItems = calculateReplacementLimit(
        text,
        settings.replacementRate,
      );
      if (!text.trim() || maxItems === 0) {
        items[index] = createEmptyResponse(text);
      } else {
        requestItems.push({ index, text, maxItems });
      }
    });

    if (requestItems.length === 0) {
      return { status: 'ok', items };
    }

    if (!validateInputs(requestItems[0].text, this.config.apiKey)) {
      return { status: 'error', error: 'API key is not configured', items };
    }

    try {
      translationStats.recordRequest(requestItems.length);

      // Unknown per-item limits (rate >= 100%) leave the output uncapped
      const lineLimit = requestItems.every(
        (item) => item.maxItems !== undefined,
      )
        ? requestItems.reduce((sum, item) => sum + (item.maxItems ?? 0), 0)
        : undefined;

      const completion = await this.requestCompletion(
        {
          systemPrompt: getBatchSystemPromptByConfig({
            targetLanguage: settings.multilingualConfig.targetLanguage,
            userLevel: settings.userLevel,
            replacementRate: settings.replacementRate,
          }),
          userPrompt: promptService.getBatchUserPrompt(requestItems),
          maxOutputTokens: estimateMaxOutputTokens(
            lineLimit,
            requestItems.length,
          ),
        },
        settings,
      );
      this.recordUsage(completion.usage);

      const content = completion.truncated
        ? dropIncompleteLastLine(completion.text)
        : completion.text;
      const parsed = StructuredTextParser.parseNumbered(
        content,
        requestItems.length,
      );

      requestItems.forEach((item, position) => {
        const pairs = parsed.items.get(position + 1);
        if (!pairs) {
          return; // missing: retried on its own by the caller
        }

        const replacements = addPositionsToReplacements(item.text, pairs, {
          replacementRate: settings.replacementRate,
        });
        items[item.index] = {
          original: item.text,
          processed: '',
          replacements,
          status: replacements.length > 0 ? 'ok' : 'empty',
        };
      });

      return { status: 'ok', items };
    } catch (error: any) {
      translationStats.recordError();
      console.error(
        `${this.getProviderName()} batch API request failed:`,
        error,
      );
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        items,
      };
    }
  }

  /**
   * Send one chat completion to the provider (transport only).
   * Must throw on HTTP/transport errors or a malformed response.
   */
  protected abstract requestCompletion(
    request: CompletionRequest,
    settings: UserSettings,
  ): Promise<CompletionResult>;

  /**
   * Get the provider name (used for logging)
   */
  protected abstract getProviderName(): string;

  /**
   * Record provider-reported token usage for the per-tab statistics
   */
  protected recordUsage(usage: unknown): void {
    translationStats.recordUsage(usage);
  }

  /**
   * Get configuration
   */
  protected getConfig(): ApiConfig {
    return this.config;
  }
}
