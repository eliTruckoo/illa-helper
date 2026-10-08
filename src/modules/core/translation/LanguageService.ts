/**
 * Language management service - simplified version
 * Handles language support, language validation, and related features
 *
 * Features:
 * - 30+ mainstream languages supported
 * - Language validation and normalization
 * - Performance-optimizing cache
 */

import { browser } from 'wxt/browser';
import { LanguageOption } from '../../shared/types/api';
import { MultilingualConfig } from '../../shared/types/api';
import { Language } from './types';

// ==================== Language data definitions ====================

/**
 * Supported language data
 * Extended to 45+ mainstream languages
 */
const LANGUAGE_DEFINITIONS: { [key: string]: Language } = {
  // Popular languages (high priority) - major world languages
  en: { code: 'en', name: 'English', nativeName: 'English', isPopular: true },
  zh: { code: 'zh', name: 'Chinese', nativeName: 'Chinese', isPopular: true },
  ja: { code: 'ja', name: 'Japanese', nativeName: 'Japanese', isPopular: true },
  ko: { code: 'ko', name: 'Korean', nativeName: 'Korean', isPopular: true },
  fr: { code: 'fr', name: 'French', nativeName: 'Français', isPopular: true },
  de: { code: 'de', name: 'German', nativeName: 'Deutsch', isPopular: true },
  es: { code: 'es', name: 'Spanish', nativeName: 'Español', isPopular: true },
  ru: { code: 'ru', name: 'Russian', nativeName: 'Русский', isPopular: true },
  pt: {
    code: 'pt',
    name: 'Portuguese',
    nativeName: 'Português',
    isPopular: true,
  },
  it: { code: 'it', name: 'Italian', nativeName: 'Italiano', isPopular: true },
  hi: { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', isPopular: true },
  ar: { code: 'ar', name: 'Arabic', nativeName: 'العربية', isPopular: true },

  // European languages
  nl: { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  no: { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  da: { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  fi: { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  sv: { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  pl: { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  el: { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  he: { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  cs: { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  hu: { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
  ro: { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  uk: { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  bg: { code: 'bg', name: 'Bulgarian', nativeName: 'Български' },
  hr: { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski' },
  sk: { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
  sl: { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina' },
  et: { code: 'et', name: 'Estonian', nativeName: 'Eesti' },
  lv: { code: 'lv', name: 'Latvian', nativeName: 'Latviešu' },
  lt: { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių' },
  ca: { code: 'ca', name: 'Catalan', nativeName: 'Català' },

  // Asian languages
  tr: { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  th: { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  vi: { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  id: { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  ms: { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  tl: { code: 'tl', name: 'Filipino', nativeName: 'Filipino' },
  ur: { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  bn: { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  ta: { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  te: { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  fa: { code: 'fa', name: 'Persian', nativeName: 'فارسی' },
  kk: { code: 'kk', name: 'Kazakh', nativeName: 'Қазақша' },
  ky: { code: 'ky', name: 'Kyrgyz', nativeName: 'Кыргызча' },
  uz: { code: 'uz', name: 'Uzbek', nativeName: "O'zbek" },

  // Other regional languages
  sw: { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
  am: { code: 'am', name: 'Amharic', nativeName: 'አማርኛ' },
  zu: { code: 'zu', name: 'Zulu', nativeName: 'IsiZulu' },
  af: { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans' },
  is: { code: 'is', name: 'Icelandic', nativeName: 'Íslenska' },
  mt: { code: 'mt', name: 'Maltese', nativeName: 'Malti' },
};

/**
 * Language code normalization map
 * Handles common language code variants
 */
const LANGUAGE_CODE_NORMALIZATION: { [key: string]: string } = {
  // Chinese variants
  'zh-cn': 'zh',
  'zh-tw': 'zh',
  'zh-hk': 'zh',
  'zh-sg': 'zh',
  cmn: 'zh',
  chs: 'zh',
  cht: 'zh',

  // English variants
  'en-us': 'en',
  'en-gb': 'en',
  'en-au': 'en',
  'en-ca': 'en',
  'en-nz': 'en',
  'en-za': 'en',
  'en-ie': 'en',

  // Portuguese variants
  'pt-br': 'pt',
  'pt-pt': 'pt',

  // Spanish variants
  'es-es': 'es',
  'es-mx': 'es',
  'es-ar': 'es',
  'es-co': 'es',
  'es-cl': 'es',
  'es-pe': 'es',
  'es-ve': 'es',

  // French variants
  'fr-fr': 'fr',
  'fr-ca': 'fr',
  'fr-be': 'fr',
  'fr-ch': 'fr',

  // German variants
  'de-de': 'de',
  'de-at': 'de',
  'de-ch': 'de',

  // Arabic variants
  'ar-sa': 'ar',
  'ar-eg': 'ar',
  'ar-ae': 'ar',
  'ar-ma': 'ar',
  'ar-iq': 'ar',
  'ar-dz': 'ar',
  'ar-ly': 'ar',

  // Other common variants
  nb: 'no', // Norwegian variant
  nn: 'no', // Norwegian variant
  fil: 'tl', // Filipino variant
};

/** Characters sampled for page language detection */
const PAGE_LANGUAGE_SAMPLE_LENGTH = 1000;
/** Below this, the paragraph sample is topped up from other text nodes */
const PAGE_LANGUAGE_MIN_SAMPLE_LENGTH = 200;
/** Hard bound on text nodes visited by the fallback sample */
const PAGE_LANGUAGE_MAX_TEXT_NODES = 2000;
const NON_CONTENT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

// ==================== Language management service class ====================

/**
 * Language management service
 * Uses the singleton pattern to provide unified language management
 */
export class LanguageService {
  private static instance: LanguageService;

  // Caching to improve performance
  private _targetLanguageOptionsCache: LanguageOption[] | null = null;
  private _popularLanguagesCache: Language[] | null = null;
  private _otherLanguagesCache: Language[] | null = null;

  /** Page language detected for the current URL (in-flight or settled) */
  private pageLanguageCache: {
    pageKey: string;
    language: Promise<string>;
  } | null = null;

  /**
   * Private constructor to prevent external instantiation
   */
  private constructor() {}

  /**
   * Get the service instance
   * @returns LanguageService instance
   */
  public static getInstance(): LanguageService {
    if (!LanguageService.instance) {
      LanguageService.instance = new LanguageService();
    }
    return LanguageService.instance;
  }

  // ==================== Language data access ====================

  /**
   * Get all supported languages
   * @returns language definitions object
   */
  public get languages(): { [key: string]: Language } {
    return LANGUAGE_DEFINITIONS;
  }

  /**
   * Get information for the given language
   * @param code language code
   * @returns language info or null
   */
  public getLanguage(code: string): Language | null {
    const normalizedCode = this.normalizeLanguageCode(code);
    return LANGUAGE_DEFINITIONS[normalizedCode] || null;
  }

  /**
   * Check whether a language is supported
   * @param code language code
   * @returns whether supported
   */
  public isSupportedLanguage(code: string): boolean {
    const normalizedCode = this.normalizeLanguageCode(code);
    return normalizedCode in LANGUAGE_DEFINITIONS;
  }

  /**
   * Normalize a language code
   * @param code original language code
   * @returns normalized code
   */
  public normalizeLanguageCode(code: string): string {
    const lowerCode = code.toLowerCase();
    return LANGUAGE_CODE_NORMALIZATION[lowerCode] || lowerCode;
  }

  /**
   * Detect the main language of the current page
   * Unified page language detection entry point, so modules do not each implement their own version of the detection logic.
   */
  public async detectPageLanguage(): Promise<string> {
    // Detect once per page; SPA navigations change the URL and invalidate it.
    const pageKey = this.getPageKey();
    if (this.pageLanguageCache?.pageKey === pageKey) {
      return this.pageLanguageCache.language;
    }

    const language = this.detectPageLanguageUncached();
    this.pageLanguageCache = { pageKey, language };
    return language;
  }

  /**
   * Forget the cached page language (e.g. after the document was replaced).
   */
  public invalidatePageLanguage(): void {
    this.pageLanguageCache = null;
  }

  private getPageKey(): string {
    try {
      const { origin, pathname, search } = window.location;
      return `${origin}${pathname}${search}`;
    } catch {
      return '';
    }
  }

  private async detectPageLanguageUncached(): Promise<string> {
    try {
      // 1. The declared document language is free to read.
      const declared = this.getDeclaredPageLanguage();
      if (declared) {
        return declared;
      }

      // 2. A bounded textContent sample: no layout, unlike innerText.
      const textSample = this.samplePageText(PAGE_LANGUAGE_SAMPLE_LENGTH);
      if (!textSample.trim()) {
        return 'zh';
      }

      const result = await browser.i18n.detectLanguage(textSample);
      const detectedLang = result?.languages?.[0]?.language;
      if (!detectedLang) {
        return 'zh';
      }

      return this.normalizeLanguageCode(detectedLang);
    } catch (error) {
      console.warn('[LanguageService] Page language detection failed:', error);
      return 'zh';
    }
  }

  /**
   * Supported language declared by `<html lang>`, or null.
   */
  private getDeclaredPageLanguage(): string | null {
    const lang = document.documentElement?.getAttribute('lang')?.trim();
    if (!lang) return null;

    const normalized = this.normalizeLanguageCode(lang.replace(/_/g, '-'));
    if (normalized in LANGUAGE_DEFINITIONS) return normalized;

    const primary = this.normalizeLanguageCode(normalized.split('-')[0]);
    return primary in LANGUAGE_DEFINITIONS ? primary : null;
  }

  /**
   * Collect up to `maxLength` characters of visible-ish page text, preferring
   * paragraphs in the main content. Reads textContent only (never innerText)
   * and stops as soon as enough text has been gathered.
   */
  private samplePageText(maxLength: number): string {
    let sample = '';
    const append = (text: string | null | undefined) => {
      const normalized = text?.replace(/\s+/g, ' ').trim();
      if (normalized) sample += `${normalized} `;
    };

    // getElementsByTagName is lazy, so only the first few <p> are touched.
    const scope =
      document.querySelector('main, article, [role="main"]') ?? document.body;
    const paragraphs = scope?.getElementsByTagName('p');
    for (
      let i = 0;
      paragraphs &&
      i < paragraphs.length &&
      i < 20 &&
      sample.length < maxLength;
      i++
    ) {
      append(paragraphs[i].textContent);
    }

    if (sample.length < PAGE_LANGUAGE_MIN_SAMPLE_LENGTH && document.body) {
      // Few or no <p>: walk text nodes, skipping script/style content.
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      let node: Node | null;
      let visited = 0;
      while (
        sample.length < maxLength &&
        visited < PAGE_LANGUAGE_MAX_TEXT_NODES &&
        (node = walker.nextNode())
      ) {
        visited++;
        const parentTag = node.parentElement?.tagName;
        if (parentTag && NON_CONTENT_TAGS.has(parentTag)) continue;
        append(node.nodeValue);
      }
    }

    return sample.substring(0, maxLength);
  }

  /**
   * Resolve the translation target language to use based on the page language and the multilingual configuration.
   * This is the single source of truth for translation direction, so modules do not each maintain the same rules.
   */
  public resolveTargetLanguage(
    multilingualConfig: MultilingualConfig,
    pageLanguage?: string | null,
  ): string {
    if (!pageLanguage) {
      return multilingualConfig.targetLanguage;
    }

    const normalizedPageLang = this.normalizeLanguageCode(pageLanguage);
    const normalizedTargetLang = this.normalizeLanguageCode(
      multilingualConfig.targetLanguage,
    );
    const normalizedNativeLang = this.normalizeLanguageCode(
      multilingualConfig.nativeLanguage,
    );

    if (normalizedPageLang === normalizedTargetLang) {
      return multilingualConfig.nativeLanguage;
    }

    if (normalizedPageLang === normalizedNativeLang) {
      return multilingualConfig.targetLanguage;
    }

    return multilingualConfig.targetLanguage;
  }

  // ==================== Language option generation ====================

  /**
   * Get the popular language list (cached)
   * @returns array of popular languages
   */
  private getPopularLanguages(): Language[] {
    if (!this._popularLanguagesCache) {
      this._popularLanguagesCache = Object.values(LANGUAGE_DEFINITIONS)
        .filter((lang) => lang.isPopular)
        .sort((a, b) => {
          // English first, Chinese second, others sorted alphabetically
          if (a.code === 'en') return -1;
          if (b.code === 'en') return 1;
          if (a.code === 'zh') return -1;
          if (b.code === 'zh') return 1;
          return a.name.localeCompare(b.name);
        });
    }
    return this._popularLanguagesCache;
  }

  /**
   * Get the other language list (cached)
   * @returns array of other languages
   */
  private getOtherLanguages(): Language[] {
    if (!this._otherLanguagesCache) {
      this._otherLanguagesCache = Object.values(LANGUAGE_DEFINITIONS)
        .filter((lang) => !lang.isPopular)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return this._otherLanguagesCache;
  }

  /**
   * Get target language selection options (for smart translation mode)
   * @returns array of language options
   */
  public getTargetLanguageOptions(): LanguageOption[] {
    if (!this._targetLanguageOptionsCache) {
      const allLanguages = [
        ...this.getPopularLanguages(),
        ...this.getOtherLanguages(),
      ];

      this._targetLanguageOptionsCache = allLanguages.map((lang) => ({
        code: lang.code,
        name: lang.name,
        nativeName: lang.nativeName,
        isPopular: lang.isPopular,
      }));
    }
    return this._targetLanguageOptionsCache;
  }

  // ==================== Translation mode management ====================

  /**
   * Get the target language display name (for smart mode)
   * @param languageCode language code
   * @returns formatted display name
   */
  public getTargetLanguageDisplayName(languageCode: string): string {
    const language = this.getLanguage(languageCode);
    return language
      ? `${language.nativeName} (${language.name})`
      : languageCode.toUpperCase();
  }

  // ==================== Utility methods ====================

  /**
   * Clear the cache (for testing or reset)
   */
  public clearCache(): void {
    this._targetLanguageOptionsCache = null;
    this._popularLanguagesCache = null;
    this._otherLanguagesCache = null;
  }

  /**
   * Get the list of supported language codes
   * @returns array of language codes
   */
  public getSupportedLanguageCodes(): string[] {
    return Object.keys(LANGUAGE_DEFINITIONS);
  }

  /**
   * Get the list of popular language codes
   * @returns array of popular language codes
   */
  public getPopularLanguageCodes(): string[] {
    return this.getPopularLanguages().map((lang) => lang.code);
  }

  // ==================== Native language methods ====================

  /**
   * Get native language selection options
   * @returns array of native language options
   */
  public getNativeLanguageOptions(): LanguageOption[] {
    // Reuse the existing target language options
    return this.getTargetLanguageOptions();
  }
}

// ==================== Exports ====================

// Singleton instance export
export const languageService = LanguageService.getInstance();

// Default export
export default LanguageService;
