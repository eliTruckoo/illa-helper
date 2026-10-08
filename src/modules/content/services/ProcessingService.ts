import { UserSettings } from '@/src/modules/shared/types';
import { TextProcessorService } from '@/src/modules/core/translation/TextProcessorService';
import { TextReplacerService } from '@/src/modules/core/translation/TextReplacerService';
import { LazyLoadingService } from './LazyLoadingService';
import { IProcessingService, ProcessingParams } from '../types';
import { ContentSegment } from '../../processing/ProcessingStateManager';
import { ProcessingCoordinator } from '../../processing/ProcessingCoordinator';
import { ReplacementBudget } from '../../processing/ReplacementBudget';
import { PageGlossary } from '../../processing/PageGlossary';
import type { PageGlossaryRunOptions } from '../../processing/ProcessingContracts';

/**
 * Page processing service
 * Handles page translation processing logic
 */
export class ProcessingService implements IProcessingService {
  private textProcessor: TextProcessorService;
  private textReplacer: TextReplacerService;
  private lazyLoadingService?: LazyLoadingService;
  private processingParams!: ProcessingParams;
  private pageReplacementBudget?: ReplacementBudget;
  // Page glossary (opt-in): page-scoped like the budget, shared by every run on this page
  private pageGlossary?: PageGlossary;
  private pageGlossaryOptions = {
    enabled: false,
    promptHint: false,
    economyMode: false,
  };
  /** Settings the learned translations depend on; a change discards the glossary */
  private pageGlossaryFingerprint = '';
  // One coordinator per tab so manual, lazy-loading and dynamic-content runs share its serial queue
  private coordinator: ProcessingCoordinator;

  constructor(
    textProcessor: TextProcessorService,
    textReplacer: TextReplacerService,
    settings: UserSettings,
    lazyLoadingService?: LazyLoadingService,
  ) {
    this.textProcessor = textProcessor;
    this.textReplacer = textReplacer;
    this.lazyLoadingService = lazyLoadingService;
    this.coordinator = new ProcessingCoordinator(
      textProcessor.getPronunciationService(),
    );
    this.updateProcessingParams(settings);

    // Set lazy loading callback
    if (this.lazyLoadingService) {
      this.lazyLoadingService.setProcessingCallback(
        this.processSegmentsLazy.bind(this),
      );
    }
  }

  /**
   * Process page content
   */
  async processPage(): Promise<void> {
    try {
      if (this.lazyLoadingService?.isEnabled()) {
        await this.processPageWithLazyLoading();
      } else {
        await this.processPageImmediate();
      }
    } catch (error) {
      console.error('[ProcessingService] Page processing failed:', error);
    }
  }

  /**
   * Process the entire page immediately
   */
  private async processPageImmediate(): Promise<void> {
    const segments = await this.getSegments(document.body);
    if (segments.length === 0) return;

    this.pageReplacementBudget = ReplacementBudget.fromSegments(
      segments,
      this.textReplacer.getConfig().replacementRate,
    );
    this.resetPageGlossary();

    await this.processSegments(segments, false);
  }

  /**
   * Process the page in lazy loading mode
   */
  private async processPageWithLazyLoading(): Promise<void> {
    const segments = await this.getSegments(document.body);
    if (segments.length === 0) return;

    this.pageReplacementBudget = ReplacementBudget.fromSegments(
      segments,
      this.textReplacer.getConfig().replacementRate,
    );
    this.resetPageGlossary();

    this.lazyLoadingService!.setProcessingCallback(
      this.processSegmentsLazy.bind(this),
    );
    this.lazyLoadingService!.observeSegments(segments);
  }

  /**
   * Get page segments
   */
  private async getSegments(root: Node): Promise<ContentSegment[]> {
    try {
      const { ContentSegmenter } = await import(
        '../../processing/ContentSegmenter'
      );
      const contentSegmenter = new ContentSegmenter({
        maxSegmentLength: this.processingParams.maxLength || 400,
        minSegmentLength: 20,
        mergeSmallSegments: false,
      });

      return await contentSegmenter.segmentContent(root);
    } catch (error) {
      console.error(
        '[ProcessingService] Failed to get content segments:',
        error,
      );
      return [];
    }
  }

  /**
   * Lazy-loaded segment processing
   */
  async processSegmentsLazy(segments: ContentSegment[]): Promise<void> {
    try {
      await this.processSegments(segments, true);
    } catch (error) {
      console.error(
        '[ProcessingService] Lazy-loaded segment processing failed:',
        error,
      );
      throw error;
    }
  }

  /**
   * Process a segment list. Whole-page processing, lazy-loading batches and dynamic nodes must all consume the same page budget.
   */
  private async processSegments(
    segments: ContentSegment[],
    isLazyLoading: boolean,
  ): Promise<void> {
    // Batches must share the page budget and must not fall back to single-segment processRoot on failure.
    // Otherwise each entry point would claim a fresh proportional quota and low replacement rates would stop working.
    // All runs go through the shared coordinator, whose queue serializes them per tab.
    await this.coordinator.processSegments(
      segments,
      this.textReplacer,
      this.processingParams.originalWordDisplayMode,
      this.processingParams.translationPosition,
      this.processingParams.showParentheses,
      isLazyLoading,
      this.pageReplacementBudget,
      this.getPageGlossaryRunOptions(),
    );
  }

  /**
   * Glossary options for a run, or undefined when the page glossary is disabled.
   */
  private getPageGlossaryRunOptions(): PageGlossaryRunOptions | undefined {
    if (!this.pageGlossaryOptions.enabled) {
      return undefined;
    }
    if (!this.pageGlossary) {
      this.pageGlossary = new PageGlossary();
    }
    return {
      glossary: this.pageGlossary,
      promptHint: this.pageGlossaryOptions.promptHint,
      economyMode: this.pageGlossaryOptions.economyMode,
    };
  }

  /**
   * Start a fresh glossary together with a fresh page budget.
   */
  private resetPageGlossary(): void {
    this.pageGlossary = this.pageGlossaryOptions.enabled
      ? new PageGlossary()
      : undefined;
  }

  /**
   * Apply the glossary settings; learned pairs are dropped when the glossary is turned off or when
   * a setting that changes the translations (provider, model, target language, level) changes.
   */
  private updatePageGlossarySettings(settings: UserSettings): void {
    const config = settings.pageGlossary;
    this.pageGlossaryOptions = {
      enabled: config?.enabled === true,
      promptHint: config?.promptHint === true,
      economyMode: config?.economyMode === true,
    };

    const activeConfig = settings.apiConfigs?.find(
      (item) => item.id === settings.activeApiConfigId,
    );
    const fingerprint = JSON.stringify([
      settings.activeApiConfigId,
      activeConfig?.config?.model ?? '',
      settings.multilingualConfig?.targetLanguage ?? '',
      settings.userLevel,
    ]);

    if (
      !this.pageGlossaryOptions.enabled ||
      fingerprint !== this.pageGlossaryFingerprint
    ) {
      this.pageGlossary = undefined;
    }
    this.pageGlossaryFingerprint = fingerprint;
  }

  /**
   * Process the given node
   */
  async processNode(node: Node): Promise<void> {
    try {
      const segments = await this.getSegments(node);
      if (segments.length === 0) return;

      const replacementRate = this.textReplacer.getConfig().replacementRate;
      if (this.pageReplacementBudget) {
        this.pageReplacementBudget.addSegments(segments, replacementRate);
      } else {
        this.pageReplacementBudget = ReplacementBudget.fromSegments(
          segments,
          replacementRate,
        );
      }

      if (this.lazyLoadingService?.isEnabled()) {
        this.lazyLoadingService.observeSegments(segments);
        return;
      }

      await this.processSegments(segments, false);
    } catch (error) {
      console.error('[ProcessingService] Node processing failed:', error);
    }
  }

  /**
   * Update settings
   */
  updateSettings(settings: UserSettings): void {
    this.updateProcessingParams(settings);

    const activeConfig = settings.apiConfigs.find(
      (config) => config.id === settings.activeApiConfigId,
    );
    this.textProcessor.updateApiConfig(activeConfig ?? null);

    if (this.lazyLoadingService) {
      this.lazyLoadingService.updateConfig(settings.lazyLoading);
    }
  }

  private updateProcessingParams(settings: UserSettings): void {
    this.processingParams = {
      originalWordDisplayMode: settings.originalWordDisplayMode,
      maxLength: settings.maxLength,
      translationPosition: settings.translationPosition,
      showParentheses: settings.showParentheses,
    };
    this.updatePageGlossarySettings(settings);
  }

  // State query methods
  getProcessingParams(): ProcessingParams {
    return { ...this.processingParams };
  }

  getLazyLoadingService(): LazyLoadingService | undefined {
    return this.lazyLoadingService;
  }

  isLazyLoadingEnabled(): boolean {
    return this.lazyLoadingService?.isEnabled() || false;
  }

  destroy(): void {
    if (this.lazyLoadingService) {
      this.lazyLoadingService.destroy();
    }
  }
}
