import { browser } from 'wxt/browser';
import { UserSettings, TriggerMode } from '@/src/modules/shared/types';
import { TranslationMode } from '@/src/modules/shared/types/core';
import { StyleManager } from '@/src/modules/styles';
import { TextProcessorService } from '@/src/modules/core/translation/TextProcessorService';
import { TextReplacerService } from '@/src/modules/core/translation/TextReplacerService';
import { ParagraphTranslationService } from '@/src/modules/core/translation/ParagraphTranslationService';

import { FloatingBallManager } from '@/src/modules/floatingBall';
import { WebsiteManager } from '@/src/modules/options/website-management/manager';

import { ConfigurationService } from './services/ConfigurationService';
import { ProcessingService } from './services/ProcessingService';
import { ListenerService } from './services/ListenerService';
import { IContentManager, ServiceContainer } from './types';
import { LazyLoadingService } from './services/LazyLoadingService';
import {
  ContentSegment,
  globalProcessingState,
} from '../processing/ProcessingStateManager';
import { languageService } from '../core/translation/LanguageService';

/**
 * Translation display state manager
 *
 * Features:
 * - Controls showing/hiding of page translations via a global CSS class
 * - Supports state switching via hotkey and floating ball
 * - Automatically syncs the floating ball visual state
 *
 * Design principles:
 * - Controlled by a CSS class to avoid per-element operations and improve performance
 * - Newly added translations automatically inherit the current display state
 * - Floating ball visual feedback is updated in real time on state changes
 */
export class TranslationStateManager {
  /** Whether translations are visible */
  private isTranslationVisible = true;

  /** Page processing service reference */
  private processingService?: ProcessingService;

  /** Paragraph translation service reference */
  private paragraphTranslationService?: ParagraphTranslationService;

  /** Floating ball manager reference */
  private floatingBallManager?: any;

  /** CSS class name that hides translations */
  private readonly HIDDEN_CLASS = 'wxt-translation-hidden';

  /** Translation content selector */
  private readonly TRANSLATION_SELECTOR = '.wxt-translation-term';

  constructor(
    processingService?: ProcessingService,
    floatingBallManager?: any,
    paragraphTranslationService?: ParagraphTranslationService,
  ) {
    this.processingService = processingService;
    this.floatingBallManager = floatingBallManager;
    this.paragraphTranslationService = paragraphTranslationService;
  }

  /**
   * Toggle translation display state
   *
   * Logic:
   * 1. If the page has no translations, translate first
   * 2. If translations exist, toggle the display state directly
   * 3. Update the floating ball visual state
   */
  async toggleTranslationState(): Promise<void> {
    const hasTranslatedContent = this.hasTranslatedContent();

    if (!hasTranslatedContent) {
      // Page has no translations, run translation
      await this.executeTranslation();
    } else {
      // Page has translations, toggle display state
      this.toggleVisibilityState();
    }

    // Sync floating ball state
    this.syncFloatingBallState();
  }

  /**
   * Run page translation
   * @private
   */
  private async executeTranslation(): Promise<void> {
    // Get user settings to determine the translation mode
    const storageService = (
      await import('../core/storage/StorageService')
    ).StorageService.getInstance();
    const settings = await storageService.getUserSettings();

    if (settings.translationMode === TranslationMode.PARAGRAPH) {
      // Paragraph translation mode: use the paragraph translation service
      if (this.paragraphTranslationService) {
        await this.paragraphTranslationService.start();
      }
    } else {
      // Word translation mode: use the existing processing service
      if (this.processingService) {
        await this.processingService.processPage();
      }
    }

    this.isTranslationVisible = true;
    document.body.classList.remove(this.HIDDEN_CLASS);
  }

  /**
   * Toggle visibility state
   * @private
   */
  private toggleVisibilityState(): void {
    this.isTranslationVisible = !this.isTranslationVisible;

    if (this.isTranslationVisible) {
      document.body.classList.remove(this.HIDDEN_CLASS);
    } else {
      document.body.classList.add(this.HIDDEN_CLASS);
    }
  }

  /**
   * After the user explicitly triggers translation, the result must become visible.
   * Dynamic content handling must not call this, otherwise async content would force the user back into translation mode after switching to original text mode.
   */
  public showTranslations(): void {
    this.isTranslationVisible = true;
    document.body.classList.remove(this.HIDDEN_CLASS);
    this.syncFloatingBallState();
  }

  /**
   * Sync floating ball state
   * @private
   */
  private syncFloatingBallState(): void {
    if (this.floatingBallManager?.updateTranslationStateIndicator) {
      this.floatingBallManager.updateTranslationStateIndicator();
    }
  }

  /**
   * Check whether the page has translations
   * @private
   */
  private hasTranslatedContent(): boolean {
    // Check word translations
    const hasWordTranslation =
      document.querySelector(this.TRANSLATION_SELECTOR) !== null;

    // Check paragraph translations
    const hasParagraphTranslation =
      document.querySelector('.illa-paragraph-translation') !== null;

    return hasWordTranslation || hasParagraphTranslation;
  }

  /**
   * Get current display state
   */
  getTranslationVisibility(): boolean {
    return this.isTranslationVisible;
  }

  /**
   * Clear all translations (including paragraph translations)
   */
  public clearAllTranslations(): void {
    try {
      // Clear paragraph translations
      if (this.paragraphTranslationService) {
        this.paragraphTranslationService.clearAllTranslations();
      }
    } catch (error) {
      console.error('[ContentManager] Failed to clear translations:', error);
    }
  }

  /**
   * Update processing service reference
   */
  updateProcessingService(processingService: ProcessingService): void {
    this.processingService = processingService;
  }

  /**
   * Update floating ball manager reference
   */
  updateFloatingBallManager(floatingBallManager: any): void {
    this.floatingBallManager = floatingBallManager;
  }
}

/**
 * Content Script main management service
 * Coordinates all sub-services and manages the lifecycle
 */
export class ContentManager implements IContentManager {
  private configurationService: ConfigurationService;
  private processingService?: ProcessingService;
  private listenerService?: ListenerService;
  private services?: ServiceContainer;
  private settings?: UserSettings;
  private translationStateManager?: TranslationStateManager;
  private detectedPageLanguage?: string;
  private destroyed = false;
  constructor() {
    this.configurationService = new ConfigurationService();
  }

  /**
   * Initialize the Content Script
   *
   * Settings and website rules are both local storage reads and are fetched
   * in parallel. The enabled/blacklist gate runs before anything else, so a
   * disabled or blacklisted page never wakes the background service worker
   * and never constructs the heavy services.
   */
  async init(): Promise<void> {
    try {
      const [settings, websiteStatus] = await Promise.all([
        this.configurationService.getUserSettings(),
        this.checkWebsiteStatus(),
      ]);

      if (this.destroyed) return;

      if (websiteStatus === 'blacklisted') {
        console.log(
          '[ContentManager] Website is blacklisted, skipping initialization',
        );
        this.destroy();
        return;
      }

      if (!settings.isEnabled) {
        console.log(
          '[ContentManager] Extension is disabled, skipping initialization',
        );
        this.destroy();
        return;
      }

      this.settings = settings;

      // Validate the API config locally; only an invalid config messages the
      // background (which shows the once-per-session notification).
      this.validateConfiguration(settings);

      // Handle language detection
      await this.handleLanguageDetection();

      // Initialize all services
      await this.initializeServices();

      // Apply initial config
      this.applyInitialConfiguration();

      // Initialize floating ball
      await this.initializeFloatingBall();

      // The context may have been invalidated while awaiting: tear down
      // whatever was created after destroy() ran.
      if (this.destroyed) {
        this.teardown();
        return;
      }

      // Set up listeners
      this.setupListeners();

      // Run initial processing according to the trigger mode
      await this.handleInitialProcessing(websiteStatus);
    } catch (error) {
      console.error('[ContentManager] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Destroy services and clean up resources.
   *
   * Tears down every observer, listener, timer and UI element owned by this
   * content script instance. Translations already injected into the page and
   * the translation styles are left in place so the page keeps rendering.
   * Idempotent: repeated calls are no-ops.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.teardown();
  }

  private teardown(): void {
    const services = this.services;
    const steps: Array<[string, () => void]> = [
      ['listener service', () => this.listenerService?.destroy()],
      [
        'paragraph translation',
        () => services?.paragraphTranslationService?.stop(),
      ],
      // ProcessingService.destroy() also destroys the lazy loading service;
      // LazyLoadingService.destroy() is idempotent.
      ['processing service', () => this.processingService?.destroy()],
      ['lazy loading', () => services?.lazyLoadingService?.destroy()],
      [
        'pronunciation',
        () => services?.textProcessor?.getPronunciationService?.()?.destroy(),
      ],
      ['floating ball', () => services?.floatingBallManager?.destroy()],
      ['processing state', () => globalProcessingState.destroy()],
    ];

    for (const [name, step] of steps) {
      try {
        step();
      } catch (error) {
        console.error(`[ContentManager] Failed to destroy ${name}:`, error);
      }
    }

    console.log('[ContentManager] Services destroyed');
  }

  /**
   * Update settings
   */
  updateSettings(newSettings: UserSettings): void {
    this.settings = newSettings;

    // Update ProcessingService settings
    this.processingService?.updateSettings(newSettings);

    // Update the config service
    if (this.services) {
      this.configurationService.updateConfiguration(
        newSettings,
        this.services.styleManager,
        this.services.textReplacer,
        this.detectedPageLanguage,
      );
    }
  }

  /**
   * Check website status
   */
  private async checkWebsiteStatus(): Promise<string> {
    const websiteManager = new WebsiteManager();
    return await websiteManager.getWebsiteStatus(window.location.href);
  }

  /**
   * Validate the API config from already-loaded settings.
   * The background is only contacted when the config is invalid, so that it
   * can show the API configuration notification.
   */
  private validateConfiguration(settings: UserSettings): boolean {
    const isValid = this.configurationService.hasValidApiConfig(settings);
    if (!isValid) {
      browser.runtime
        .sendMessage({
          type: 'validate-configuration',
          source: 'page_load',
        })
        .catch((error) => {
          console.warn('[ContentManager] Config validation failed:', error);
        });
    }
    return isValid;
  }

  /**
   * Handle language detection
   * Detect the page language and determine the translation direction, avoiding repeated computation
   */
  private async handleLanguageDetection(): Promise<void> {
    if (!this.settings) return;

    // Detect page language
    this.detectedPageLanguage = await languageService.detectPageLanguage();
    const targetLanguage = languageService.resolveTargetLanguage(
      this.settings.multilingualConfig,
      this.detectedPageLanguage,
    );

    console.log(
      `[ContentManager] Page language: ${this.detectedPageLanguage}, target language: ${targetLanguage}`,
    );
  }

  /**
   * Initialize all core services
   */
  private async initializeServices(): Promise<void> {
    if (!this.settings) {
      throw new Error('Settings not loaded');
    }

    // Create service instances
    const styleManager = new StyleManager();

    const activeConfig = this.configurationService.getActiveApiConfig(
      this.settings,
    );
    const textProcessor = TextProcessorService.getInstance({
      enablePronunciationTooltip: this.settings.enablePronunciationTooltip,
      apiConfigItem: activeConfig ?? null,
    });

    const textReplacer = TextReplacerService.getInstance(
      this.configurationService.createReplacementConfig(
        this.settings,
        this.detectedPageLanguage,
      ),
    );

    // Create the lazy loading service
    const lazyLoadingService = this.initializeLazyLoading(this.settings);

    // Initialize the paragraph translation service, passing in the lazy loading service
    const paragraphTranslationService =
      ParagraphTranslationService.getInstance(lazyLoadingService);

    const floatingBallManager = new FloatingBallManager(
      this.settings.floatingBall,
    );

    // Save the service container
    this.services = {
      styleManager,
      textProcessor,
      textReplacer,
      floatingBallManager,
      lazyLoadingService,
      paragraphTranslationService, // added paragraph translation service
    };

    // Create business services
    this.processingService = new ProcessingService(
      textProcessor,
      textReplacer,
      this.settings,
      lazyLoadingService,
    );

    // Create the translation state manager
    this.translationStateManager = new TranslationStateManager(
      this.processingService,
      this.services.floatingBallManager,
      this.services.paragraphTranslationService, // pass the paragraph translation service directly
    );

    this.listenerService = new ListenerService(
      this.settings,
      this.processingService,
      this.configurationService,
      styleManager,
      textReplacer,
      paragraphTranslationService,
      floatingBallManager,
      this.translationStateManager,
      this.detectedPageLanguage,
    );
  }

  /**
   * Apply initial config
   */
  private applyInitialConfiguration(): void {
    if (!this.settings || !this.services) return;

    this.configurationService.updateConfiguration(
      this.settings,
      this.services.styleManager,
      this.services.textReplacer,
      this.detectedPageLanguage,
    );
  }

  /**
   * Initialize floating ball
   */
  private async initializeFloatingBall(): Promise<void> {
    if (!this.services?.floatingBallManager || !this.translationStateManager)
      return;

    await this.services.floatingBallManager.init(async () => {
      // Floating ball click state toggle callback.
      // Read fresh settings (local storage, no service worker wake-up) and
      // only ask the background when the config is invalid, so it can notify.
      const latestSettings = await this.configurationService.getUserSettings();
      const isConfigValid =
        this.configurationService.hasValidApiConfig(latestSettings) ||
        (await browser.runtime.sendMessage({
          type: 'validate-configuration',
          source: 'user_action',
        }));

      if (isConfigValid && this.translationStateManager) {
        await this.translationStateManager.toggleTranslationState();
      }
    });
  }

  /**
   * Set up listeners
   */
  private setupListeners(): void {
    this.listenerService?.setupMessageListeners();
    this.listenerService?.setupDomObserver();
  }

  /**
   * Handle initial page processing
   */
  private async handleInitialProcessing(websiteStatus: string): Promise<void> {
    if (!this.settings || !this.processingService) return;

    // Act according to the trigger mode or whitelist
    if (
      websiteStatus === 'whitelisted' ||
      this.settings.triggerMode === TriggerMode.AUTOMATIC
    ) {
      try {
        // Determine whether it is word mode or paragraph translation
        if (this.settings.translationMode === TranslationMode.PARAGRAPH) {
          const paragraphTranslationService =
            this.services?.paragraphTranslationService;
          if (!paragraphTranslationService) {
            return;
          }

          // Paragraph translation mode
          await paragraphTranslationService.start();
        } else {
          // Word translation mode
          await this.processingService.processPage();
        }
      } catch (error) {
        console.error(
          '[ContentManager] Initial page processing failed:',
          error,
        );
      }
    }
  }

  /**
   * Initialize the lazy loading service
   */
  private initializeLazyLoading(
    settings: UserSettings,
  ): LazyLoadingService | undefined {
    if (!settings.lazyLoading || !settings.lazyLoading.enabled) {
      return undefined;
    }

    const lazyLoadingService = new LazyLoadingService(settings.lazyLoading);
    lazyLoadingService.initialize();

    // Set the processing callback
    lazyLoadingService.setProcessingCallback(
      async (segments: ContentSegment[]) => {
        if (this.processingService) {
          await this.processingService.processSegmentsLazy(segments);
        }
      },
    );

    return lazyLoadingService;
  }
}
