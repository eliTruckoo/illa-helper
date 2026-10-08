import { UserLevel } from '../../shared/types/core';
import { PromptConfig } from './types';
import { languageService } from './LanguageService';

/**
 * Version of the word-mode prompt and output format.
 * Part of the translation cache key: bump it whenever the prompt changes so cached answers are not reused.
 */
export const TRANSLATION_PROMPT_VERSION = '2';

/** Marker a batch answer uses for an item without any pick */
export const BATCH_EMPTY_ITEM_MARKER = '-';

export interface BatchPromptItem {
  text: string;
  /** Maximum number of output lines for this item */
  maxItems?: number;
}

/**
 * Prompt service - singleton
 */
export class PromptService {
  private static instance: PromptService;

  private constructor() {}

  public static getInstance(): PromptService {
    if (!PromptService.instance) {
      PromptService.instance = new PromptService();
    }
    return PromptService.instance;
  }

  /**
   * Word-mode system prompt for one segment per request.
   * Kept short on purpose: it is sent with every request.
   */
  public getUnifiedPrompt(config: PromptConfig): string {
    return [
      this.generateBaseInstruction(config),
      'Output only lines "original||translation", one per line, nothing else. If nothing qualifies, output nothing.',
    ].join('\n');
  }

  /**
   * Word-mode system prompt for several numbered segments per request.
   */
  public getBatchPrompt(config: PromptConfig): string {
    return [
      this.generateBaseInstruction(config),
      'The input has numbered items like <1 max=2>text</1>. Handle each item on its own; "max" is that item\'s line limit.',
      `Output only lines "n|original||translation" where n is the item number. For an item with nothing to pick, output "n|${BATCH_EMPTY_ITEM_MARKER}". Nothing else.`,
    ].join('\n');
  }

  /**
   * User message for one segment.
   */
  public getUserPrompt(text: string, maxItems?: number): string {
    const limit =
      maxItems !== undefined && maxItems > 0
        ? ` (at most ${maxItems} lines)`
        : '';
    return `Text${limit}:\n${text}`;
  }

  /**
   * User message for numbered segments; item numbers start at 1.
   */
  public getBatchUserPrompt(items: BatchPromptItem[]): string {
    return items
      .map((item, index) => {
        const id = index + 1;
        const limit =
          item.maxItems !== undefined && item.maxItems > 0
            ? ` max=${item.maxItems}`
            : '';
        return `<${id}${limit}>${item.text}</${id}>`;
      })
      .join('\n');
  }

  /**
   * Shared task, level and rate rules
   */
  private generateBaseInstruction(config: PromptConfig): string {
    const { targetLanguage, userLevel, replacementRate } = config;
    const langName =
      languageService.getTargetLanguageDisplayName(targetLanguage);

    const levelGuidance: Record<UserLevel, string> = {
      [UserLevel.A1]: 'A1 (beginner): very basic words only',
      [UserLevel.A2]: 'A2 (elementary): simple everyday words',
      [UserLevel.B1]: 'B1 (intermediate): common phrases and verbs',
      [UserLevel.B2]: 'B2 (upper-intermediate): nuanced vocabulary',
      [UserLevel.C1]: 'C1 (advanced): advanced idioms and terms',
      [UserLevel.C2]: 'C2 (proficient): rare or specialized words',
    };
    const level = levelGuidance[userLevel] || levelGuidance[UserLevel.B1];

    let amount = 'the eligible words/phrases';
    if (replacementRate > 0 && replacementRate < 1) {
      const percentage = Math.round(replacementRate * 100);
      amount = `about ${percentage}% of the eligible words/phrases (a hard upper bound; fewer is fine)`;
    }

    return [
      `You help a learner of ${langName}, level ${level}.`,
      `From the given text pick ${amount} most worth learning at this level and translate each into ${langName} as used in context.`,
      `Never exceed the given line limit. Skip filler words, names, code, URLs, numbers and text already in ${langName}. Copy each original exactly as written in the text.`,
    ].join('\n');
  }
}

// ==================== Exports ====================

export const promptService = PromptService.getInstance();

export const getSystemPromptByConfig = (config: PromptConfig): string => {
  return promptService.getUnifiedPrompt(config);
};

export const getBatchSystemPromptByConfig = (config: PromptConfig): string => {
  return promptService.getBatchPrompt(config);
};
