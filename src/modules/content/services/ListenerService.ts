import { UserSettings, TriggerMode, TranslationMode } from '../../shared/types';
import { ProcessingService } from './ProcessingService';
import { ConfigurationService } from './ConfigurationService';
import { StyleManager } from '../../styles';
import { TextReplacerService } from '../../core/translation/TextReplacerService';
import { ParagraphTranslationService } from '../../core/translation/ParagraphTranslationService';
import { FloatingBallManager } from '../../floatingBall';
import { IListenerService } from '../types';
import {
  isProcessingResultNode,
  isDescendant,
  createBatchScheduler,
} from '../utils/domUtils';
import { TranslationStateManager } from '../ContentManager';
import {
  isOwnedOrProcessedElement,
  isTranslationCandidateNode,
} from '../../processing/DomTranslationPolicy';

/** Trailing debounce of DOM mutation batches */
const MUTATION_DEBOUNCE_MS = 150;
/** A batch is flushed at the latest this long after its first mutation */
const MUTATION_MAX_WAIT_MS = 750;
/** Beyond this many pending nodes the batch falls back to one body rescan */
const MAX_PENDING_NODES = 300;
/** characterData changes shorter than this (trimmed) are ignored */
const MIN_CHARACTER_DATA_LENGTH = 16;
/** Minimum text length of a dynamic node worth translating */
const MIN_DYNAMIC_TEXT_LENGTH = 16;

/**
 * Of the queued nodes, keep connected translation candidates that are not
 * inside another kept candidate. Runs in the flush, not in the observer
 * callback, because the candidate checks read text and computed style.
 */
function selectTopLevelCandidates(nodes: Set<Node>): Set<Node> {
  const candidates = new Set<Node>();
  nodes.forEach((node) => {
    if (!node.isConnected) return;
    if (isProcessingResultNode(node)) return;
    if (isTranslationCandidateNode(node, MIN_DYNAMIC_TEXT_LENGTH)) {
      candidates.add(node);
    }
  });

  const topLevel = new Set<Node>();
  candidates.forEach((node) => {
    if (!isDescendant(node, candidates)) topLevel.add(node);
  });
  return topLevel;
}

/**
 * Listener service - handles message listening and DOM observation
 */
export class ListenerService implements IListenerService {
  private settings: UserSettings;
  private processingService: ProcessingService;
  private configurationService: ConfigurationService;
  private styleManager: StyleManager;
  private textReplacer: TextReplacerService;
  private paragraphService: ParagraphTranslationService;
  private floatingBallManager: FloatingBallManager;
  private translationStateManager: TranslationStateManager;
  private pageLanguage?: string;
  private domObserver?: MutationObserver;
  private pendingNodes = new Set<Node>();
  private pendingOverflow = false;
  private isFlushing = false;
  private flushQueuedWhileBusy = false;
  private flushScheduler = createBatchScheduler(
    () => {
      void this.flushPendingNodes();
    },
    { wait: MUTATION_DEBOUNCE_MS, maxWait: MUTATION_MAX_WAIT_MS },
  );

  constructor(
    settings: UserSettings,
    processingService: ProcessingService,
    configurationService: ConfigurationService,
    styleManager: StyleManager,
    textReplacer: TextReplacerService,
    paragraphService: ParagraphTranslationService,
    floatingBallManager: FloatingBallManager,
    translationStateManager: TranslationStateManager,
    pageLanguage?: string,
  ) {
    this.settings = settings;
    this.processingService = processingService;
    this.configurationService = configurationService;
    this.styleManager = styleManager;
    this.textReplacer = textReplacer;
    this.paragraphService = paragraphService;
    this.floatingBallManager = floatingBallManager;
    this.translationStateManager = translationStateManager;
    this.pageLanguage = pageLanguage;
  }

  /**
   * Set up the message listener
   */
  setupMessageListeners(): void {
    browser.runtime.onMessage.addListener(async (message) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        console.error('[ListenerService] Message handling failed:', error);
      }
    });
  }

  /**
   * Set up the DOM observer.
   * Manual mode also needs observation: after the user triggers a translation, asynchronously loaded content should keep flowing into the same translation pipeline.
   */
  setupDomObserver(): void {
    if (!this.settings.isEnabled) return;
    if (this.settings.triggerMode !== TriggerMode.AUTOMATIC) return;
    this.createDomObserver();
  }

  /**
   * Destroy the service and clean up resources
   */
  destroy(): void {
    if (this.domObserver) {
      this.domObserver.disconnect();
      this.domObserver = undefined;
    }

    this.flushScheduler.cancel();
    this.pendingNodes.clear();
    this.pendingOverflow = false;
  }

  /**
   * Handle messages
   */
  private async handleMessage(message: any): Promise<void> {
    if (
      message.type === 'settings_updated' ||
      message.type === 'api_config_updated'
    ) {
      await this.handleSettingsUpdate(message.settings);
    } else if (message.type === 'translate-page-command') {
      // Toggle state instead of translating directly
      await this.toggleTranslationState();
    } else if (message.type === 'MANUAL_TRANSLATE') {
      if (this.settings.triggerMode === TriggerMode.MANUAL) {
        const isConfigValid = await browser.runtime.sendMessage({
          type: 'validate-configuration',
          source: 'user_action',
        });
        if (isConfigValid) {
          await this.startConfiguredTranslation();
          this.translationStateManager.showTranslations();
          this.ensureDomObserver();
        }
      }
    } else if (message.type === 'PARAGRAPH_TRANSLATE') {
      const isConfigValid = await browser.runtime.sendMessage({
        type: 'validate-configuration',
        source: 'user_action',
      });
      if (isConfigValid) {
        await this.paragraphService.start();
        this.translationStateManager.showTranslations();
        this.ensureDomObserver();
      }
    }
  }

  /**
   * Toggle translation state
   */
  private async toggleTranslationState(): Promise<void> {
    const isConfigValid = await browser.runtime.sendMessage({
      type: 'validate-configuration',
      source: 'user_action',
    });

    if (isConfigValid) {
      await this.translationStateManager.toggleTranslationState();
      this.ensureDomObserver();
    }
  }

  private ensureDomObserver(): void {
    if (!this.domObserver && this.settings.isEnabled) {
      this.createDomObserver();
    }
  }

  private async startConfiguredTranslation(): Promise<void> {
    if (this.settings.translationMode === TranslationMode.PARAGRAPH) {
      await this.paragraphService.start();
      return;
    }

    await this.processingService.processPage();
  }

  /**
   * Handle settings updates
   */
  private async handleSettingsUpdate(newSettings: UserSettings): Promise<void> {
    const needsPageReload =
      this.settings.triggerMode !== newSettings.triggerMode ||
      this.settings.isEnabled !== newSettings.isEnabled ||
      this.settings.enablePronunciationTooltip !==
        newSettings.enablePronunciationTooltip ||
      this.settings.userLevel !== newSettings.userLevel ||
      this.settings.useGptApi !== newSettings.useGptApi ||
      this.settings.multilingualConfig.targetLanguage !==
        newSettings.multilingualConfig.targetLanguage ||
      this.settings.multilingualConfig.nativeLanguage !==
        newSettings.multilingualConfig.nativeLanguage;

    if (needsPageReload) {
      window.location.reload();
      return;
    }

    Object.assign(this.settings, newSettings);
    this.configurationService.updateConfiguration(
      this.settings,
      this.styleManager,
      this.textReplacer,
      this.pageLanguage,
    );
    this.processingService.updateSettings(this.settings);
    this.floatingBallManager.updateConfig(this.settings.floatingBall);
  }

  /**
   * Create the DOM observer
   *
   * The callback only does cheap checks (node type, own/processed markers)
   * and collects nodes; the expensive candidate checks run in the flush. The
   * observer stays connected while a batch is processed: the extension's own
   * DOM writes carry markers (wxt-/illa- classes, data-wxt-* attributes) and
   * are filtered out, so no mutations from the page are lost.
   */
  private createDomObserver(): void {
    this.pendingNodes = new Set();
    this.pendingOverflow = false;

    this.domObserver = new MutationObserver((mutations) => {
      let hasValidChanges = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (this.enqueueNode(node)) hasValidChanges = true;
          });
        } else if (mutation.type === 'characterData') {
          // Ignore tiny text changes (counters, timestamps, typing).
          const text = (mutation.target as CharacterData).data ?? '';
          if (text.trim().length < MIN_CHARACTER_DATA_LENGTH) continue;

          const parent = mutation.target.parentElement;
          if (parent && this.enqueueNode(parent)) hasValidChanges = true;
        }
      }

      if (hasValidChanges) {
        this.flushScheduler.schedule();
      }
    });

    this.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  /**
   * Cheap pre-filter for the observer callback.
   * @returns true if the node was queued (or the batch is in overflow mode)
   */
  private enqueueNode(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!(node as Text).data?.trim()) return false;
      const parent = node.parentElement;
      if (parent && isOwnedOrProcessedElement(parent)) return false;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (isOwnedOrProcessedElement(node as Element)) return false;
    } else {
      return false;
    }

    if (this.pendingOverflow) return true;

    this.pendingNodes.add(node);
    if (this.pendingNodes.size > MAX_PENDING_NODES) {
      // Too many separate changes: rescan the page once instead.
      this.pendingOverflow = true;
      this.pendingNodes.clear();
    }
    return true;
  }

  /**
   * Process the collected batch. Batches never run concurrently: changes that
   * arrive while one is processed are flushed right after it.
   */
  private async flushPendingNodes(): Promise<void> {
    if (this.isFlushing) {
      this.flushQueuedWhileBusy = true;
      return;
    }

    const nodes = this.pendingNodes;
    const overflow = this.pendingOverflow;
    this.pendingNodes = new Set();
    this.pendingOverflow = false;
    if (!overflow && nodes.size === 0) return;

    this.isFlushing = true;
    try {
      const roots = overflow
        ? new Set<Node>([document.body])
        : selectTopLevelCandidates(nodes);
      if (roots.size > 0) {
        await this.processDynamicNodes(roots);
      }
    } catch (error) {
      console.error('[ListenerService] DOM node processing failed:', error);
    } finally {
      this.isFlushing = false;
      if (
        this.flushQueuedWhileBusy ||
        this.pendingNodes.size > 0 ||
        this.pendingOverflow
      ) {
        this.flushQueuedWhileBusy = false;
        if (this.domObserver) this.flushScheduler.schedule();
      }
    }
  }

  private async processDynamicNodes(nodes: Set<Node>): Promise<void> {
    if (this.settings.translationMode === TranslationMode.PARAGRAPH) {
      // One scan per batch, scoped to the mutated subtrees.
      await this.paragraphService.translateWithin(nodes);
      return;
    }

    for (const node of nodes) {
      await this.processingService.processNode(node);
    }
  }
}
