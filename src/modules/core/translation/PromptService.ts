import { UserLevel } from '../../shared/types/core';
import { PromptConfig } from './types';
import { languageService } from './LanguageService';

/**
 * Version of the word-mode prompt and output format.
 * Part of the translation cache key: bump it whenever the prompt changes so cached answers are not reused.
 */
export const TRANSLATION_PROMPT_VERSION = '1';

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
   * Generate the unified prompt - condensed version
   */
  public getUnifiedPrompt(config: PromptConfig): string {
    const { targetLanguage, userLevel, replacementRate } = config;

    const components = [
      this.generateBaseInstruction(), // kept, slightly condensed
      this.generateTaskAndRules(targetLanguage), // merged: task + rules
      this.generateUserConfig(userLevel, replacementRate), // merged: level + ratio
      this.generateFormatRequirements(), // emphasis strengthened
      this.generateExamples(targetLanguage, replacementRate),
    ].filter((component) => component.trim() !== '');

    return components.join('\n\n');
  }

  /**
   * Base instruction - condensed
   */
  private generateBaseInstruction(): string {
    return 'You are an AI translator for language learners. Strictly follow instructions: select suitable words/phrases from input text based on user level and ratio, then output ONLY their translations in the specified format. No extra text allowed.';
  }

  /**
   * Task and rules - merged and simplified, conflicts clarified
   */
  private generateTaskAndRules(targetLanguage: string): string {
    const langName =
      languageService.getTargetLanguageDisplayName(targetLanguage);
    return `Task: User is learning ${langName}. Given any input text, intelligently select high-value words/phrases (e.g., key nouns, verbs, idioms) for learning, and provide their direct ${langName} translations.
    
## Strict Rules
1. Select based on context: Prioritize words that aid learning, avoid fillers (e.g., 'a', 'the', 'is').
2. Preserve original code, proper nouns, HTML tags unchanged.
3. Skip any text already in ${langName}.
4. Output ONLY the selected original||translation pairs. Rigorous ban on any additions, explanations, or prefixes (e.g., no 'Here is the translation:').
5. Output that does not meet the requirements, directly return the empty string.
6. Consider the context of the text when translating.
`;
  }

  /**
   * User config - level and ratio merged, guidance added
   */
  private generateUserConfig(
    userLevel: UserLevel,
    replacementRate: number,
  ): string {
    const levelGuidance: Record<UserLevel, string> = {
      [UserLevel.A1]: 'A1 (Beginner): Select very basic words only.',
      [UserLevel.A2]: 'A2 (Elementary): Select simple everyday words.',
      [UserLevel.B1]: 'B1 (Intermediate): Select common phrases and verbs.',
      [UserLevel.B2]: 'B2 (Upper-Intermediate): Select nuanced vocabulary.',
      [UserLevel.C1]: 'C1 (Advanced): Select advanced idioms and terms.',
      [UserLevel.C2]: 'C2 (Proficient): Select rare or specialized words.',
    };

    let ratioPart = '';
    if (replacementRate > 0 && replacementRate <= 1) {
      const percentage = Math.round(replacementRate * 100);
      const lower = Math.max(0, percentage - 3); // narrow the fluctuation range for better consistency
      const upper = Math.min(100, percentage + 3);
      ratioPart = `Select at most ~${percentage}% of the eligible words/phrases (${lower}%-${upper}% range). This is a hard upper bound: if unsure, output fewer items, not more. Focus on quality over quota; choose natural whole words/phrases.`;
    }

    return `User Level: ${levelGuidance[userLevel] || levelGuidance[UserLevel.B1]}
${ratioPart}`.trim();
  }

  /**
   * Format requirements - emphasis strengthened
   */
  private generateFormatRequirements(): string {
    return `MANDATORY FORMAT: Output ONLY lines of "original||translation". One per line. No JSON, quotes, extras, or other formats. Violating this will fail the task.`;
  }

  /**
   * Examples - 2 added to cover more scenarios
   */
  private generateExamples(
    targetLanguage: string,
    replacementRate: number,
  ): string {
    const langName =
      languageService.getTargetLanguageDisplayName(targetLanguage);
    const countHint =
      replacementRate > 0 && replacementRate <= 0.2
        ? 'For low replacement rates, output only one or two high-value items.'
        : 'Adjust the number of output lines to the configured replacement rate.';
    return `Examples (Target: ${langName}):
        Input: "The quick brown fox jumps over the lazy dog."
        Output:
        fox||translation_text
        jumps||translation_text

        ${countHint}`;
  }
}

// ==================== Exports ====================

export const promptService = PromptService.getInstance();

export const getSystemPromptByConfig = (config: PromptConfig): string => {
  return promptService.getUnifiedPrompt(config);
};
