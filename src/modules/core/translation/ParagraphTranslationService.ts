/**
 * Paragraph translation service
 *
 * Design principles:
 * 1. Use DomWalker to traverse the DOM uniformly and identify paragraphs by computed style
 * 2. Translate the discovered paragraph elements directly
 * 3. Share the same DOM collection logic with word translation mode
 */

import { StorageService } from '../storage';
import { StyleManager } from '../../styles/core/StyleManager';
import { ParagraphTranslationApi } from './ParagraphTranslationApi';
import { PARAGRAPH_TRANSLATION } from '../../shared/constants';
import type { LazyLoadingService } from '../../content/services/LazyLoadingService';
import type { ContentSegment } from '../../processing/ProcessingStateManager';
import { globalProcessingState } from '../../processing/ProcessingStateManager';
import {
  walkAndCollectParagraphs,
  collectTextNodes,
} from '../../processing/DomWalker';
import { languageService } from './LanguageService';
import { selectParagraphTranslationElements } from './ParagraphTranslationSelection';
import { renderParagraphTranslation } from './ParagraphTranslationRenderer';

/**
 * Paragraph translation service class
 */
export class ParagraphTranslationService {
  private static instance: ParagraphTranslationService | null = null;
  private storageService: StorageService;
  private styleManager: StyleManager;
  private paragraphApi: ParagraphTranslationApi;
  private lazyLoadingService?: LazyLoadingService; // Lazy loading service

  // Translation state management
  private isStarting: boolean = false;
  private translatedElements = new WeakSet<HTMLElement>();
  private translatingElements = new WeakSet<HTMLElement>(); // Elements currently being translated
  private targetLanguage?: string;

  // Concurrency settings
  private readonly BATCH_SIZE = 5; // Process 5 elements per batch
  private readonly BATCH_DELAY = 200; // 200ms delay between batches

  // Loading indicator styles
  private readonly LOADING_CLASS = 'illa-paragraph-loading';
  private readonly LOADING_ICON = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-dasharray="11 11" stroke-dashoffset="0">
        <animateTransform attributeName="transform" type="rotate" values="0 8 8;360 8 8" dur="1s" repeatCount="indefinite"/>
      </circle>
    </svg>
  `;

  private constructor(lazyLoadingService?: LazyLoadingService) {
    this.storageService = StorageService.getInstance();
    this.styleManager = new StyleManager();
    this.paragraphApi = ParagraphTranslationApi.getInstance();
    this.lazyLoadingService = lazyLoadingService;

    // Set the translation style dynamically
    this.storageService.getUserSettings().then((settings) => {
      if (settings && settings.translationStyle) {
        this.styleManager.setTranslationStyle(settings.translationStyle);
      }
    });
  }

  /**
   * Get the service instance (singleton)
   */
  public static getInstance(
    lazyLoadingService?: LazyLoadingService,
  ): ParagraphTranslationService {
    if (!ParagraphTranslationService.instance) {
      ParagraphTranslationService.instance = new ParagraphTranslationService(
        lazyLoadingService,
      );
    } else if (
      lazyLoadingService &&
      !ParagraphTranslationService.instance.lazyLoadingService
    ) {
      // If the instance exists but has no lazy loading service, update it
      ParagraphTranslationService.instance.lazyLoadingService =
        lazyLoadingService;
    }
    return ParagraphTranslationService.instance;
  }

  /**
   * Start paragraph translation
   */
  public async start(): Promise<number> {
    console.log('[ParagraphTranslation] Starting translation service...');

    if (this.isStarting) {
      console.warn(
        '[ParagraphTranslation] Translation service is already running',
      );
      return 0;
    }

    this.isStarting = true;

    try {
      // Re-read the current page and settings on every manual trigger. SPA route changes do not recreate the content script.
      const settings = await this.storageService.getUserSettings();
      const pageLanguage = await languageService.detectPageLanguage();
      this.targetLanguage = languageService.resolveTargetLanguage(
        settings.multilingualConfig,
        pageLanguage,
      );

      const isLazyLoadingEnabled =
        settings?.lazyLoading?.enabled && this.lazyLoadingService?.isEnabled();

      if (isLazyLoadingEnabled) {
        // Lazy loading mode only registers the current DOM; visible elements are triggered later by LazyLoadingService.
        console.log('[ParagraphTranslation] Using lazy loading mode');
        return this.startLazyLoading();
      }

      console.log('[ParagraphTranslation] Using full translation mode');
      return this.startFullTranslation();
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Stop paragraph translation
   */
  public stop(): void {
    this.isStarting = false;
    this.translatedElements = new WeakSet();
    this.translatingElements = new WeakSet(); // Reset
    this.targetLanguage = undefined;
    this.clearAllLoadingIndicators(); // Clear

    // Stop lazy loading observation
    if (this.lazyLoadingService) {
      this.lazyLoadingService.unobserveSegments([]);
    }

    console.log('[ParagraphTranslation] Translation service stopped');
  }

  /**
   * Clear all translations
   */
  public clearAllTranslations(): void {
    document
      .querySelectorAll(`.${PARAGRAPH_TRANSLATION.WRAPPER_CLASS}`)
      .forEach((el) => el.remove());
    this.translatedElements = new WeakSet();
    this.translatingElements = new WeakSet(); // Reset
    this.targetLanguage = undefined;
    this.clearAllLoadingIndicators(); // Clear

    // Stop lazy loading observation
    if (this.lazyLoadingService) {
      this.lazyLoadingService.unobserveSegments([]);
    }

    console.log('[ParagraphTranslation] All translations cleared');
  }

  /**
   * Find paragraph elements - based on the unified DomWalker traversal
   */
  private findParagraphElements(): HTMLElement[] {
    const paragraphs = walkAndCollectParagraphs(document.body);
    const paragraphElements = selectParagraphTranslationElements(paragraphs);

    // Filter out elements that are already translated, being translated, or too short
    const elements = paragraphElements.filter((element) => {
      if (this.translatedElements.has(element)) return false;
      if (this.translatingElements.has(element)) return false;

      const text = element.textContent?.trim();
      if (!text || text.length < 3) return false;
      if (text.length > 3000) return false;

      // Skip pure digits or simple symbols
      if (/^[\d\s.,!?\-+=()[\]{}]*$/.test(text)) return false;

      return true;
    });

    console.log(
      '[ParagraphTranslation] Paragraph elements found:',
      elements.length,
    );
    return elements;
  }

  /**
   * Translate a list of elements
   */
  private async translateElements(elements: HTMLElement[]): Promise<number> {
    if (elements.length === 0) {
      return 0;
    }

    console.log(
      '[ParagraphTranslation] Starting concurrent translation, element count:',
      elements.length,
    );

    // Process in batches to avoid API rate limiting
    const batchSize = this.BATCH_SIZE; // Process 5 elements per batch
    let successCount = 0;

    for (let i = 0; i < elements.length; i += batchSize) {
      const batch = elements.slice(i, i + batchSize);
      console.log(
        `[ParagraphTranslation] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(elements.length / batchSize)}, element count: ${batch.length}`,
      );

      // Process the current batch concurrently
      const batchPromises = batch.map(async (element) => {
        try {
          const success = await this.translateElement(element);
          return success ? 1 : 0;
        } catch (error) {
          console.error(
            '[ParagraphTranslation] Failed to translate element:',
            error,
          );
          return 0;
        }
      });

      // Wait for the current batch to finish
      const batchResults = await Promise.all(batchPromises);
      const batchSuccessCount = batchResults.reduce(
        (sum: number, result: number) => sum + result,
        0,
      );
      successCount += batchSuccessCount;

      // Short delay between batches to avoid API rate limiting
      if (i + batchSize < elements.length) {
        await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY));
      }
    }

    console.log(
      '[ParagraphTranslation] Concurrent translation finished, success count:',
      successCount,
    );
    return successCount;
  }

  /**
   * Translate a single element
   */
  private async translateElement(element: HTMLElement): Promise<boolean> {
    if (
      this.translatedElements.has(element) ||
      this.translatingElements.has(element)
    ) {
      return false;
    }

    const textContent = element.textContent?.trim();
    if (!textContent || textContent.length < 5) {
      return false;
    }

    // Mark as being translated
    this.translatingElements.add(element);
    this.showLoadingIndicator(element);

    try {
      console.log(
        '[ParagraphTranslation] Translating element:',
        element.tagName,
        textContent.substring(0, 50),
      );

      const translatedText = await this.paragraphApi.translateParagraph(
        textContent,
        this.targetLanguage,
      );

      if (translatedText && translatedText.trim()) {
        // Remove the loading indicator first, then show the translation
        this.removeLoadingIndicator(element);
        this.translatingElements.delete(element);

        this.showTranslation(element, translatedText);
        this.translatedElements.add(element);
        console.log(
          '[ParagraphTranslation] Translation succeeded:',
          element.tagName,
        );
        return true;
      } else {
        // Remove the loading indicator
        this.removeLoadingIndicator(element);
        this.translatingElements.delete(element);

        console.log(
          '[ParagraphTranslation] Translation result is empty, skipping:',
          element.tagName,
        );
        return false;
      }
    } catch (error) {
      // Remove the loading indicator
      this.removeLoadingIndicator(element);
      this.translatingElements.delete(element);

      console.error(
        '[ParagraphTranslation] Translation failed:',
        error,
        'element:',
        element.tagName,
      );
      return false;
    }
  }

  /**
   * Show the translation result
   */
  private showTranslation(element: HTMLElement, translatedText: string): void {
    // The same paragraph may be triggered repeatedly; remove the old result before writing to keep the DOM idempotent.
    this.removeAdjacentTranslation(element);
    element
      .querySelectorAll(`.${PARAGRAPH_TRANSLATION.WRAPPER_CLASS}`)
      .forEach((el) => el.remove());

    const styleClass = this.styleManager.getCurrentStyleClass();
    renderParagraphTranslation(element, translatedText, styleClass);
  }

  private removeAdjacentTranslation(element: HTMLElement): void {
    const nextSibling = element.nextSibling;
    if (nextSibling?.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const nextElement = nextSibling as HTMLElement;
    if (nextElement.classList.contains(PARAGRAPH_TRANSLATION.WRAPPER_CLASS)) {
      nextElement.remove();
    }
  }

  /**
   * Show the loading indicator
   */
  private showLoadingIndicator(element: HTMLElement): void {
    this.removeLoadingIndicator(element);

    // Ensure the global style is added only once
    if (!document.getElementById('illa-paragraph-loading-style')) {
      const style = document.createElement('style');
      style.id = 'illa-paragraph-loading-style';
      style.textContent = `
        .illa-paragraph-loading svg {
          animation: illa-spin 1s linear infinite;
        }
        @keyframes illa-spin {
          100% { transform: rotate(360deg); }
        }
        /* Ensure the loading indicator never blocks click events on any element */
        .illa-paragraph-loading {
          pointer-events: none !important;
          user-select: none;
        }
        /* Special handling for the loading indicator on link elements */
        a + .illa-paragraph-loading {
          position: relative;
          z-index: 1;
          margin-left: 2px;
        }
      `;
      document.head.appendChild(style);
    }

    const loadingSpan = document.createElement('span');
    loadingSpan.classList.add(this.LOADING_CLASS);
    loadingSpan.innerHTML = this.LOADING_ICON;

    // Unified loading indicator style; pointer-events is controlled by CSS
    loadingSpan.style.cssText = `
      display: inline-block;
      margin-left: 8px;
      vertical-align: middle;
      opacity: 0.8;
    `;

    // Special handling for link elements: reduce spacing
    if (element.tagName.toLowerCase() === 'a') {
      loadingSpan.style.marginLeft = '4px';
    }

    element.parentNode?.insertBefore(loadingSpan, element.nextSibling);
  }

  /**
   * Remove the loading indicator
   */
  private removeLoadingIndicator(element: HTMLElement): void {
    // Find and remove the loading indicator after this element
    const nextSibling = element.nextSibling;
    if (nextSibling && nextSibling.nodeType === Node.ELEMENT_NODE) {
      const nextElement = nextSibling as HTMLElement;
      if (nextElement.classList.contains(this.LOADING_CLASS)) {
        nextElement.remove();
      }
    }
  }

  /**
   * Clear all loading indicators
   */
  private clearAllLoadingIndicators(): void {
    document
      .querySelectorAll(`.${this.LOADING_CLASS}`)
      .forEach((el) => el.remove());
  }

  /**
   * Start full translation
   */
  private async startFullTranslation(): Promise<number> {
    // Find all paragraph elements
    const paragraphElements = this.findParagraphElements();
    console.log(
      '[ParagraphTranslation] Full translation mode: paragraph elements found:',
      paragraphElements.length,
    );

    // Translate the paragraph elements
    const result = await this.translateElements(paragraphElements);
    console.log('[ParagraphTranslation] Translation finished, result:', result);
    return result;
  }

  /**
   * Start lazy loading translation
   */
  private async startLazyLoading(): Promise<number> {
    if (!this.lazyLoadingService) {
      console.warn(
        '[ParagraphTranslation] Lazy loading service not initialized, falling back to full translation',
      );
      return this.startFullTranslation();
    }

    // Find all paragraph elements and convert them to ContentSegment
    const paragraphElements = this.findParagraphElements();
    const segments = this.convertToContentSegments(paragraphElements);

    console.log(
      '[ParagraphTranslation] Lazy loading mode: paragraph elements found:',
      paragraphElements.length,
    );

    // Set the lazy loading callback
    this.lazyLoadingService.setProcessingCallback(
      async (visibleSegments: ContentSegment[]) => {
        const elementsToTranslate = visibleSegments.map(
          (segment) => segment.element as HTMLElement,
        );
        await this.translateElements(elementsToTranslate);
      },
    );

    // Start observing paragraphs
    this.lazyLoadingService.observeSegments(segments);

    return segments.length;
  }

  /**
   * Convert paragraph elements to ContentSegment
   */
  private convertToContentSegments(elements: HTMLElement[]): ContentSegment[] {
    return elements.map((element, index) => {
      const textContent = element.textContent?.trim() || '';
      const domPath = globalProcessingState.generateDomPath(element);
      const fingerprint = globalProcessingState.generateContentFingerprint(
        textContent,
        domPath,
      );

      const textNodes: Text[] = collectTextNodes(element);

      return {
        id: `${element.tagName.toLowerCase()}-${fingerprint}-${index}`,
        textContent,
        element,
        elements: [element],
        textNodes,
        fingerprint,
        domPath,
      };
    });
  }

  /**
   * Get statistics
   */
  public getStats(): { total: number; translated: number } {
    const total = document.querySelectorAll(
      'p, h1, h2, h3, h4, h5, h6, div, blockquote, section, article, li, td, th',
    ).length;
    const translated = document.querySelectorAll(
      `.${PARAGRAPH_TRANSLATION.WRAPPER_CLASS}`,
    ).length;
    return { total, translated };
  }
}
