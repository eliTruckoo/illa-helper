/**
 * Paragraph translation API service
 *
 * Reuses the existing UniversalApiService architecture, dedicated to full paragraph-level translation.
 * Unlike the word replacement API, this service uses a simple translation prompt.
 */

import { callAI } from '../../api/services/UniversalApiService';
import { StorageService } from '../storage';
import { languageService } from './LanguageService';
import { cleanParagraphTranslationResult } from './ParagraphTranslationResult';

/**
 * Paragraph translation prompt template
 */
const PARAGRAPH_TRANSLATION_PROMPT = `You are a professional translator. Translate the following text to {{targetLang}}. 

Requirements:
- Output ONLY the translation, no explanations
- Maintain the original meaning and tone
- If the text is already in the target language or doesn't need translation, return the original text
- Keep proper nouns, technical terms, and formatting as appropriate

Text to translate:
{{input}}`;

/**
 * Paragraph translation API service class
 */
export class ParagraphTranslationApi {
  private static instance: ParagraphTranslationApi | null = null;
  private storageService: StorageService;

  private constructor() {
    this.storageService = StorageService.getInstance();
  }

  /**
   * Get the service instance (singleton)
   */
  public static getInstance(): ParagraphTranslationApi {
    if (!ParagraphTranslationApi.instance) {
      ParagraphTranslationApi.instance = new ParagraphTranslationApi();
    }
    return ParagraphTranslationApi.instance;
  }

  /**
   * Translate paragraph text
   * @param sourceText Source text
   * @param targetLanguage Target language (optional, defaults to user settings)
   * @returns Translated text
   */
  public async translateParagraph(
    sourceText: string,
    targetLanguage?: string,
  ): Promise<string> {
    if (!sourceText || !sourceText.trim()) {
      return '';
    }

    // Clean the text (remove zero-width spaces, etc.)
    const cleanSourceText = sourceText.replace(/\u200B/g, '').trim();

    try {
      // Get user settings
      const settings = await this.storageService.getUserSettings();

      // Only detect the page language when the caller did not resolve it.
      const finalTargetLanguage =
        targetLanguage ||
        languageService.resolveTargetLanguage(
          settings.multilingualConfig,
          await languageService.detectPageLanguage(),
        );

      // Build the paragraph translation prompt
      const prompt = this.buildParagraphTranslationPrompt(
        cleanSourceText,
        finalTargetLanguage,
      );

      console.log(`[ParagraphTranslationApi] Calling API...`);
      const result = await callAI(prompt);
      console.log(`[ParagraphTranslationApi] Raw API result:`, result);

      if (!result.success) {
        throw new Error(result.error || 'Translation API call failed');
      }

      // Process the translation result
      const processedResult = cleanParagraphTranslationResult(
        result.content,
        cleanSourceText,
      );

      return processedResult;
    } catch (error) {
      console.error('Paragraph translation API call failed:', error);
      throw error;
    }
  }

  /**
   * Build the paragraph translation prompt
   */
  private buildParagraphTranslationPrompt(
    sourceText: string,
    targetLanguage: string,
  ): string {
    // Convert language codes to clear language names
    const languageNames: { [key: string]: string } = {
      zh: 'Chinese',
      'zh-cn': 'Chinese',
      chinese: 'Chinese',
      en: 'English',
      'en-us': 'English',
      english: 'English',
      ja: 'Japanese',
      japanese: 'Japanese',
      ko: 'Korean',
      korean: 'Korean',
      fr: 'French',
      french: 'French',
      de: 'German',
      german: 'German',
      es: 'Spanish',
      spanish: 'Spanish',
      ru: 'Russian',
      russian: 'Russian',
    };

    const finalLanguageName =
      languageNames[targetLanguage.toLowerCase()] || targetLanguage;

    return PARAGRAPH_TRANSLATION_PROMPT.replace(
      '{{targetLang}}',
      finalLanguageName,
    ).replace('{{input}}', sourceText);
  }

  /**
   * Translate multiple paragraphs in batch
   * @param paragraphs Array of paragraphs
   * @param targetLanguage Target language (optional)
   * @param concurrency Concurrency (default 3, to avoid API rate limiting)
   * @returns Array of translation results
   */
  public async translateMultipleParagraphs(
    paragraphs: string[],
    targetLanguage?: string,
    concurrency: number = 3,
  ): Promise<string[]> {
    if (paragraphs.length === 0) {
      return [];
    }

    const results: string[] = new Array(paragraphs.length).fill('');

    // Process in batches to avoid API rate limiting
    for (let i = 0; i < paragraphs.length; i += concurrency) {
      const batch = paragraphs.slice(i, i + concurrency);
      const batchPromises = batch.map(async (paragraph, batchIndex) => {
        const actualIndex = i + batchIndex;
        try {
          const translated = await this.translateParagraph(
            paragraph,
            targetLanguage,
          );
          results[actualIndex] = translated;
        } catch (error) {
          console.warn(
            `Paragraph translation failed [index ${actualIndex}]:`,
            error,
          );
          results[actualIndex] = ''; // Return an empty string when translation fails
        }
      });

      await Promise.all(batchPromises);

      // Short delay between batches to avoid API rate limiting
      if (i + concurrency < paragraphs.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return results;
  }
}
