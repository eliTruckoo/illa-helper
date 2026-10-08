/**
 * Processing coordinator
 * Coordinates all text processing requests, ensuring atomic processing without duplicates
 */

import {
  ContentSegment,
  globalProcessingState,
} from './ProcessingStateManager';
import {
  OriginalWordDisplayMode,
  TranslationPosition,
} from '../shared/types/core';
import type {
  FullTextAnalysisResponse,
  Replacement,
} from '../shared/types/api';
import {
  ReplacementBudget,
  calculateReplacementLimit,
} from './ReplacementBudget';
import {
  buildTextFromNodes,
  planStableReplacements,
} from './ReplacementPlanner';
import { applyReplacementToRange as writeReplacementToRange } from './RangeReplacementWriter';
import { translationStats } from '../core/translation/TranslationStats';
import { wordExposureRecorder } from '../core/translation/WordExposureRecorder';
import {
  TRANSLATION_BATCH_MAX_ITEMS,
  TRANSLATION_WAVE_SIZE,
  type PageGlossaryRunOptions,
  type PronunciationRegistrar,
  type TextReplacementEngine,
  type TranslationHint,
  type TranslationStyleProvider,
} from './ProcessingContracts';
import {
  countGlossaryCoverage,
  mergeWithGlossary,
  type PageGlossary,
} from './PageGlossary';

/** Concurrent single-segment requests per wave when batching is unavailable */
const SINGLE_REQUEST_CONCURRENCY = 8;

function isBudgetExhausted(budget: ReplacementBudget): boolean {
  const remaining = budget.getRemainingCount();
  return remaining !== undefined && remaining <= 0;
}

/**
 * Shrink the wave when little page budget is left: segments beyond it would most likely be requested
 * only to have their answers discarded. Never below one full batch, so requests stay well filled.
 */
function getWaveSize(waveSize: number, budget: ReplacementBudget): number {
  const remaining = budget.getRemainingCount();
  if (remaining === undefined) {
    return waveSize;
  }
  return Math.min(waveSize, Math.max(remaining, TRANSLATION_BATCH_MAX_ITEMS));
}

/**
 * Processing result interface
 */
export interface ProcessingResult {
  /** Whether processing succeeded */
  success: boolean;
  /** Number of replacements */
  replacementCount: number;
  /** Number of segments processed */
  segmentCount: number;
  /** Number of segments skipped (already processed or in progress) */
  skippedCount: number;
  /** Error message */
  error?: string;
  /** Processing duration (ms) */
  duration: number;
}

/**
 * Segment processing result
 */
interface SegmentProcessingResult {
  segment: ContentSegment;
  success: boolean;
  replacementCount: number;
  error?: string;
}

interface SegmentTranslationResult {
  segment: ContentSegment;
  success: boolean;
  replacements: Replacement[];
  error?: string;
}

/**
 * Processing coordinator
 *
 * Core responsibilities:
 * 1. Coordinate all processing requests and avoid duplicate processing
 * 2. Process atomically to avoid concurrency conflicts
 * 3. Provide unified error handling and rollback
 * 4. Monitor processing performance and state
 */
export class ProcessingCoordinator {
  /** Processing queue to prevent concurrency conflicts */
  private processingQueue: Promise<unknown> = Promise.resolve();

  /** Pronunciation service */
  private pronunciationService?: PronunciationRegistrar;

  /** Statistics */
  private stats = {
    totalProcessed: 0,
    totalSkipped: 0,
    totalErrors: 0,
    averageProcessingTime: 0,
  };

  constructor(pronunciationService?: PronunciationRegistrar) {
    this.pronunciationService = pronunciationService;
  }

  /**
   * Process the content segment list
   * Main entry point; ensures all segments are processed in order
   */
  async processSegments(
    segments: ContentSegment[],
    textReplacer: TextReplacementEngine,
    originalWordDisplayMode: OriginalWordDisplayMode,
    translationPosition: TranslationPosition,
    showParentheses: boolean,
    isLazyLoading: boolean = false,
    replacementBudget?: ReplacementBudget,
    pageGlossary?: PageGlossaryRunOptions,
  ): Promise<ProcessingResult> {
    const startTime = Date.now();

    // Enqueue the processing request to ensure serial processing
    const nextTask = this.processingQueue.then(async () => {
      return this.doProcessSegments(
        segments,
        textReplacer,
        originalWordDisplayMode,
        translationPosition,
        showParentheses,
        startTime,
        isLazyLoading,
        replacementBudget,
        pageGlossary,
      );
    });
    // A failed run must not break the queue for later runs sharing this coordinator
    this.processingQueue = nextTask.catch(() => undefined);
    return nextTask;
  }

  /**
   * Actual segment processing logic
   */
  private async doProcessSegments(
    segments: ContentSegment[],
    textReplacer: TextReplacementEngine,
    originalWordDisplayMode: OriginalWordDisplayMode,
    translationPosition: TranslationPosition,
    showParentheses: boolean,
    startTime: number,
    isLazyLoading: boolean = false,
    replacementBudget?: ReplacementBudget,
    pageGlossary?: PageGlossaryRunOptions,
  ): Promise<ProcessingResult> {
    let processedCount = 0;
    let skippedCount = 0;
    let totalReplacements = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // Filter out segments already processed or in progress
    const segmentsToProcess = segments.filter((segment) => {
      const isProcessed = globalProcessingState.isContentProcessed(
        segment.fingerprint,
      );
      const isProcessing = globalProcessingState.isContentProcessing(
        segment.fingerprint,
      );

      if (isProcessed || isProcessing) {
        skippedCount++;
        return false;
      }

      return true;
    });

    // Mark processing start in batch
    const successfullyMarked = segmentsToProcess.filter((segment) =>
      globalProcessingState.markProcessingStart(segment.fingerprint),
    );

    if (successfullyMarked.length > 0) {
      translationStats.recordRun();
      translationStats.recordSegments(successfullyMarked.length);
    }

    try {
      // Batching engines receive whole waves (deduplicated and split into numbered requests there);
      // otherwise segments are requested one by one, 8 at a time.
      const useBatching =
        typeof textReplacer.replaceTexts === 'function' &&
        TRANSLATION_BATCH_MAX_ITEMS > 1;
      const waveSize = useBatching
        ? TRANSLATION_WAVE_SIZE
        : SINGLE_REQUEST_CONCURRENCY;
      const results: SegmentProcessingResult[] = [];
      const activeBudget =
        replacementBudget ??
        ReplacementBudget.fromSegments(
          successfullyMarked,
          textReplacer.getConfig().replacementRate,
        );

      let i = 0;
      while (i < successfullyMarked.length) {
        // Once the page budget is used up every further answer would be discarded: skip the requests
        if (isBudgetExhausted(activeBudget)) {
          const remaining = successfullyMarked.slice(i);
          translationStats.recordBudgetSkipped(remaining.length);
          remaining.forEach((segment) => {
            results.push(this.skipSegment(segment));
          });
          break;
        }

        const wave = successfullyMarked.slice(
          i,
          i + getWaveSize(waveSize, activeBudget),
        );
        i += wave.length;

        const translations = await this.collectWaveTranslations(
          wave,
          textReplacer,
          useBatching,
          pageGlossary,
        );

        // API requests may run concurrently, but budget consumption and DOM writes must run in segment order.
        translations.forEach((translation) => {
          results.push(
            this.applySegmentTranslation(
              translation,
              textReplacer,
              originalWordDisplayMode,
              translationPosition,
              showParentheses,
              activeBudget,
              pageGlossary,
            ),
          );
        });
      }

      // Aggregate results
      results.forEach((result) => {
        if (result.success) {
          processedCount++;
          totalReplacements += result.replacementCount;

          // Mark processing complete
          globalProcessingState.markProcessingComplete(
            result.segment.fingerprint,
            result.segment.domPath,
            result.replacementCount,
            true,
          );
        } else {
          errorCount++;
          errors.push(result.error || 'Unknown error');

          // Failed segments are not recorded as processed so they can be retried later
          globalProcessingState.releaseProcessing(result.segment.fingerprint);
        }
      });
    } catch (globalError) {
      // Clear all markers; nothing is recorded as processed so a later run can retry
      successfullyMarked.forEach((segment) => {
        globalProcessingState.releaseProcessing(segment.fingerprint);
      });

      const duration = Date.now() - startTime;
      return {
        success: false,
        replacementCount: 0,
        segmentCount: 0,
        skippedCount,
        error:
          globalError instanceof Error
            ? globalError.message
            : String(globalError),
        duration,
      };
    }

    const duration = Date.now() - startTime;

    // Update statistics
    this.updateStats(processedCount, skippedCount, errorCount, duration);
    if (successfullyMarked.length > 0) {
      translationStats.logSummary(
        `run of ${successfullyMarked.length} segments (${isLazyLoading ? 'lazy' : 'direct'}, ${duration} ms)`,
      );
    }

    return {
      success: errorCount === 0,
      replacementCount: totalReplacements,
      segmentCount: processedCount,
      skippedCount,
      error: errors.length > 0 ? errors[0] : undefined,
      duration,
    };
  }

  /**
   * Fetch candidate replacements for a wave, in wave order.
   * With the page glossary, economy mode may serve segments locally and the prompt hint lists the
   * glossary words present in each requested segment.
   */
  private async collectWaveTranslations(
    wave: ContentSegment[],
    textReplacer: TextReplacementEngine,
    useBatching: boolean,
    pageGlossary?: PageGlossaryRunOptions,
  ): Promise<SegmentTranslationResult[]> {
    const replacementRate = textReplacer.getConfig().replacementRate;
    const local = new Map<ContentSegment, SegmentTranslationResult>();
    const requested: ContentSegment[] = [];

    wave.forEach((segment) => {
      if (
        pageGlossary?.economyMode &&
        this.canServeFromGlossary(
          segment,
          pageGlossary.glossary,
          replacementRate,
        )
      ) {
        // The glossary fills this segment's quota: no request, replacements come from the glossary merge
        translationStats.recordEconomySkipped();
        local.set(segment, { segment, success: true, replacements: [] });
      } else {
        requested.push(segment);
      }
    });

    const hints = pageGlossary?.promptHint
      ? requested.map((segment) =>
          this.buildGlossaryHint(
            segment,
            pageGlossary.glossary,
            replacementRate,
          ),
        )
      : undefined;

    let fetched: SegmentTranslationResult[] = [];
    if (requested.length > 0) {
      fetched = useBatching
        ? await this.collectWaveReplacements(requested, textReplacer, hints)
        : await Promise.all(
            requested.map((segment, index) =>
              this.collectSegmentReplacements(
                segment,
                textReplacer,
                hints?.[index],
              ),
            ),
          );
    }

    const fetchedBySegment = new Map(
      fetched.map((translation) => [translation.segment, translation]),
    );
    return wave.map(
      (segment) => local.get(segment) ?? fetchedBySegment.get(segment)!,
    );
  }

  /**
   * Economy mode: whether the glossary alone fills the segment's replacement limit
   * (PageGlossary.shouldSkipRequest never allows two segments in a row).
   */
  private canServeFromGlossary(
    segment: ContentSegment,
    glossary: PageGlossary,
    replacementRate?: number,
  ): boolean {
    const limit = calculateReplacementLimit(
      segment.textContent,
      replacementRate,
    );
    if (limit === 0) {
      // Nothing to translate: neither a skip nor a source of new words
      return false;
    }
    const coverage =
      limit === undefined
        ? 0
        : countGlossaryCoverage(
            glossary,
            buildTextFromNodes(segment.textNodes),
          );
    return glossary.shouldSkipRequest(coverage, limit);
  }

  /**
   * "Already handled" hint for one segment: glossary words present in the text sent to the model.
   */
  private buildGlossaryHint(
    segment: ContentSegment,
    glossary: PageGlossary,
    replacementRate?: number,
  ): TranslationHint | undefined {
    const pairs = glossary.hintFor(segment.textContent);
    if (pairs.length === 0) {
      return undefined;
    }
    return {
      pairs,
      maxPairs: calculateReplacementLimit(segment.textContent, replacementRate),
    };
  }

  /**
   * Fetch candidate replacements for a whole wave through the batching engine; the page budget is not consumed here.
   */
  private async collectWaveReplacements(
    segments: ContentSegment[],
    textReplacer: TextReplacementEngine,
    hints?: Array<TranslationHint | undefined>,
  ): Promise<SegmentTranslationResult[]> {
    segments.forEach((segment) => {
      segment.elements.forEach((element) => {
        this.addProcessingFeedback(element);
      });
    });

    let responses: Array<FullTextAnalysisResponse | undefined>;
    let waveError: string | undefined;
    try {
      const texts = segments.map((segment) => segment.textContent);
      responses = hints
        ? await textReplacer.replaceTexts!(texts, hints)
        : await textReplacer.replaceTexts!(texts);
    } catch (error) {
      responses = [];
      waveError = error instanceof Error ? error.message : String(error);
    }

    return segments.map((segment, index) =>
      this.toSegmentTranslation(segment, responses[index], waveError),
    );
  }

  /**
   * Map an engine response to a segment result; errors keep the segment retryable.
   */
  private toSegmentTranslation(
    segment: ContentSegment,
    result: FullTextAnalysisResponse | undefined,
    fallbackError?: string,
  ): SegmentTranslationResult {
    if (!result || result.status === 'error') {
      return {
        segment,
        success: false,
        replacements: [],
        error: result?.error || fallbackError || 'Translation request failed',
      };
    }

    return {
      segment,
      success: true,
      replacements: result.replacements ?? [],
    };
  }

  /**
   * Fetch candidate replacements concurrently; the page budget is not consumed here.
   */
  private async collectSegmentReplacements(
    segment: ContentSegment,
    textReplacer: TextReplacementEngine,
    hint?: TranslationHint,
  ): Promise<SegmentTranslationResult> {
    try {
      segment.elements.forEach((element) => {
        this.addProcessingFeedback(element);
      });

      const result = hint
        ? await textReplacer.replaceText(segment.textContent, hint)
        : await textReplacer.replaceText(segment.textContent);
      return this.toSegmentTranslation(segment, result);
    } catch (error) {
      return {
        segment,
        success: false,
        replacements: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Complete a segment without a request (page budget exhausted); it counts as processed with 0 replacements.
   */
  private skipSegment(segment: ContentSegment): SegmentProcessingResult {
    this.markTextNodesProcessed(segment.textNodes);
    return { segment, success: true, replacementCount: 0 };
  }

  /**
   * Apply candidate replacements in DOM order and consume the page-level budget here.
   */
  private applySegmentTranslation(
    translationResult: SegmentTranslationResult,
    textReplacer: TextReplacementEngine,
    originalWordDisplayMode: OriginalWordDisplayMode,
    translationPosition: TranslationPosition,
    showParentheses: boolean,
    replacementBudget: ReplacementBudget,
    pageGlossary?: PageGlossaryRunOptions,
  ): SegmentProcessingResult {
    const { segment } = translationResult;

    try {
      if (!translationResult.success) {
        return {
          segment,
          success: false,
          replacementCount: 0,
          error: translationResult.error,
        };
      }

      // Glossary matches fill what the model left (model picks win), capped by the segment's rate
      const candidates = pageGlossary
        ? mergeWithGlossary(
            buildTextFromNodes(segment.textNodes),
            segment.textContent,
            translationResult.replacements,
            pageGlossary.glossary,
            textReplacer.getConfig().replacementRate,
          )
        : translationResult.replacements;
      const replacements = replacementBudget.take(candidates);

      if (replacements.length > 0) {
        const applied: Replacement[] = [];
        const appliedCount = this.applyReplacements(
          segment,
          replacements,
          textReplacer.styleManager,
          originalWordDisplayMode,
          translationPosition,
          showParentheses,
          applied,
        );
        replacementBudget.restore(replacements.length - appliedCount);

        if (pageGlossary) {
          this.updateGlossary(pageGlossary.glossary, applied);
        }

        if (this.pronunciationService) {
          setTimeout(() => {
            this.addPronunciationToSegment(segment);
          }, 0);
        }

        this.markTextNodesProcessed(segment.textNodes);

        return {
          segment,
          success: true,
          replacementCount: appliedCount,
        };
      }

      this.markTextNodesProcessed(segment.textNodes);

      return {
        segment,
        success: true,
        replacementCount: 0,
      };
    } catch (error) {
      return {
        segment,
        success: false,
        replacementCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      segment.elements.forEach((element) => {
        this.removeProcessingFeedback(element);
      });
    }
  }

  /**
   * Learn the applied model picks and count the applied glossary replacements (`isNew: false`).
   */
  private updateGlossary(glossary: PageGlossary, applied: Replacement[]): void {
    const fromGlossary = applied.filter((r) => r.isNew === false).length;
    if (fromGlossary > 0) {
      translationStats.recordGlossaryHits(fromGlossary);
    }
    glossary.learn(applied.filter((r) => r.isNew !== false));
  }

  /**
   * Apply replacements to the DOM
   * @param applied optional collector receiving every replacement that was actually written
   */
  private applyReplacements(
    segment: ContentSegment,
    replacements: Replacement[],
    styleManager: TranslationStyleProvider,
    originalWordDisplayMode: OriginalWordDisplayMode,
    translationPosition: TranslationPosition,
    showParentheses: boolean,
    applied?: Replacement[],
  ): number {
    const reconstructedText = buildTextFromNodes(segment.textNodes);
    const plannedReplacements = planStableReplacements(
      reconstructedText,
      replacements,
    );
    const sortedReplacements = plannedReplacements.sort(
      (a, b) => b.position.start - a.position.start,
    );
    let appliedCount = 0;
    const shown: Replacement[] = [];

    for (const replacement of sortedReplacements) {
      const range = this.findRangeInTextNodes(
        segment.textNodes,
        replacement.position.start,
        replacement.position.end,
      );

      if (range) {
        const wasApplied = this.applyReplacementToRange(
          range,
          replacement,
          styleManager,
          originalWordDisplayMode,
          translationPosition,
          showParentheses,
        );
        if (wasApplied) {
          appliedCount++;
          applied?.push(replacement);
          shown.push(replacement);
        }
      }
    }

    // Learning layer: count what the user actually sees (batched, debounced)
    wordExposureRecorder.record(shown);

    return appliedCount;
  }

  /**
   * Find a range within the text nodes
   */
  private findRangeInTextNodes(
    textNodes: Text[],
    start: number,
    end: number,
  ): Range | null {
    let charCount = 0;
    let startNode: Text | null = null;
    let endNode: Text | null = null;
    let startOffset = 0;
    let endOffset = 0;

    // Build the full text content for validation
    const fullText = textNodes.map((node) => node.textContent || '').join('');

    // Validate position bounds
    if (start < 0 || end > fullText.length || start >= end) {
      return null;
    }

    for (const node of textNodes) {
      const nodeLength = node.textContent?.length || 0;

      if (startNode === null && charCount + nodeLength >= start) {
        startNode = node;
        startOffset = start - charCount;
      }

      if (endNode === null && charCount + nodeLength >= end) {
        endNode = node;
        endOffset = end - charCount;
      }

      if (startNode && endNode) break;
      charCount += nodeLength;
    }

    if (startNode && endNode) {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);

      // Verify the range content matches the expected text
      const extractedText = range.toString();
      const expectedText = fullText.substring(start, end);

      if (extractedText !== expectedText) {
        return null;
      }

      return range;
    }

    return null;
  }

  /**
   * Apply a single replacement to a range
   */
  private applyReplacementToRange(
    range: Range,
    replacement: Replacement,
    styleManager: TranslationStyleProvider,
    originalWordDisplayMode: OriginalWordDisplayMode,
    translationPosition: TranslationPosition,
    showParentheses: boolean,
  ): boolean {
    const result = writeReplacementToRange(range, replacement, {
      styleClass: styleManager.getCurrentStyleClass(),
      originalWordDisplayMode,
      translationPosition,
      showParentheses,
    });

    if (result.translationElement) {
      this.addGlowEffect(result.translationElement);
    }

    return result.success;
  }

  /**
   * Mark text nodes as processed
   */
  private markTextNodesProcessed(textNodes: Text[]): void {
    const timestamp = Date.now().toString();
    textNodes.forEach((node) => {
      if (node.parentElement) {
        node.parentElement.setAttribute('data-wxt-text-processed', 'true');
        node.parentElement.setAttribute('data-wxt-processed-time', timestamp);
      }
    });
  }

  /**
   * Add visual feedback while processing
   */
  private addProcessingFeedback(element: Element): void {
    element.classList.add('wxt-processing');
  }

  /**
   * Remove visual feedback while processing
   */
  private removeProcessingFeedback(element: Element): void {
    element.classList.remove('wxt-processing');
  }

  /**
   * Add glow effect
   */
  private addGlowEffect(element: Element): void {
    element.classList.add('wxt-glow');
    setTimeout(() => {
      element.classList.remove('wxt-glow');
    }, 800);
  }

  /**
   * Update statistics
   */
  private updateStats(
    processed: number,
    skipped: number,
    errors: number,
    duration: number,
  ): void {
    this.stats.totalProcessed += processed;
    this.stats.totalSkipped += skipped;
    this.stats.totalErrors += errors;

    // Update average processing time
    const totalOperations = this.stats.totalProcessed + this.stats.totalErrors;
    if (totalOperations > 0) {
      this.stats.averageProcessingTime =
        (this.stats.averageProcessingTime *
          (totalOperations - processed - errors) +
          duration) /
        totalOperations;
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      totalSkipped: 0,
      totalErrors: 0,
      averageProcessingTime: 0,
    };
  }

  /**
   * Wait for all processing to complete
   */
  async waitForCompletion(): Promise<void> {
    await this.processingQueue;
  }

  /**
   * Add pronunciation to the translated content of a single segment
   * @param segment Content segment
   */
  private async addPronunciationToSegment(
    segment: ContentSegment,
  ): Promise<void> {
    if (!this.pronunciationService) return;

    try {
      // Find translation elements in all related elements
      const allTranslationElements: Element[] = [];

      for (const element of segment.elements) {
        const translationElements = element.querySelectorAll
          ? element.querySelectorAll(
              '.wxt-translation-term:not([data-pronunciation-added])',
            )
          : [];
        allTranslationElements.push(...Array.from(translationElements));
      }

      for (const element of allTranslationElements) {
        const translationText = element.textContent;
        if (translationText) {
          // Extract plain English content (strip parentheses)
          const cleanText = translationText.replace(/[()]/g, '').trim();

          // Check whether the text is English (common punctuation and digits allowed)
          if (
            /^[a-zA-Z0-9\s\-',.!?;:()%]+$/.test(cleanText) &&
            cleanText.length > 0
          ) {
            await this.pronunciationService.addPronunciationToElement(
              element as HTMLElement,
              cleanText,
            );

            // Mark pronunciation as added
            element.setAttribute('data-pronunciation-added', 'true');
          }
        }
      }
    } catch (_) {
      // Silently ignore errors
    }
  }
}
