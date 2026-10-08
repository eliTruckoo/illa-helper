/**
 * Pronunciation tooltip interaction controller.
 *
 * This module owns the tooltip's DOM lifecycle, mouse events, hotkey state, and async content updates.
 * PronunciationService only needs to register elements and should not know how the tooltip is shown or hidden.
 *
 * Hover detection uses one delegated mouseover/mouseout pair on the document instead of listeners per word,
 * per-word data lives in a WeakMap (so detached words are garbage collected without unregistering), and only
 * the currently visible tooltips are tracked.
 */

import { IPhoneticProvider } from '../phonetic';
import { AITranslationProvider } from '../translation';
import {
  CSS_CLASSES,
  PronunciationConfig,
  TIMER_CONSTANTS,
  UI_CONSTANTS,
} from '../config';
import { PhoneticInfo, PronunciationElementData } from '../types';
import { DOMUtils, PositionUtils, TimerManager } from '../utils';
import {
  StorageEventData,
  StorageEventType,
  StorageService,
} from '../../core/storage';
import type { UserSettings } from '../../shared/types/storage';
import { TooltipRenderer } from './TooltipRenderer';

const PRONUNCIATION_SELECTOR = `.${CSS_CLASSES.PRONUNCIATION_ENABLED}`;

// Timer keys: there is at most one main tooltip and one nested word tooltip at a time
const MAIN_SHOW_TIMER = 'main-show';
const MAIN_HIDE_TIMER = 'main-hide';
const WORD_SHOW_TIMER = 'word-show';
const WORD_HIDE_TIMER = 'word-hide';

export interface TooltipInteractionControllerOptions {
  getConfig: () => PronunciationConfig;
  phoneticProvider: IPhoneticProvider;
  translationProvider: AITranslationProvider;
  renderer: TooltipRenderer;
  storageService: StorageService;
  speakText: (text: string) => Promise<unknown>;
  speakTextWithAccent: (text: string, lang: string) => Promise<unknown>;
}

export class TooltipInteractionController {
  private readonly elementData = new WeakMap<
    HTMLElement,
    PronunciationElementData
  >();
  private readonly timerManager = new TimerManager();

  // The main tooltip currently in the DOM (if any) and the word it belongs to
  private activeMainData: PronunciationElementData | null = null;
  private currentWordTooltip: HTMLElement | null = null;
  private isCtrlPressed = false;
  private currentlyHoveredData: PronunciationElementData | null = null;
  // Hotkey requirement cached from settings so hovering never awaits storage
  private hotkeyRequired = false;

  constructor(private readonly options: TooltipInteractionControllerOptions) {
    document.addEventListener('mouseover', this.handleDocumentMouseOver, {
      capture: true,
      passive: true,
    });
    document.addEventListener('mouseout', this.handleDocumentMouseOut, {
      capture: true,
      passive: true,
    });
    document.addEventListener('keydown', this.handleDocumentKeyDown);
    document.addEventListener('keyup', this.handleDocumentKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    options.storageService.addEventListener(
      StorageEventType.SETTINGS_CHANGED,
      this.handleSettingsChanged,
    );
    void this.loadHotkeyConfig();
  }

  async register(
    element: HTMLElement,
    word: string,
    _isPhrase?: boolean,
  ): Promise<boolean> {
    try {
      if (!element || !word || this.elementData.has(element)) {
        return false;
      }

      const elementData: PronunciationElementData = {
        word: word.toLowerCase().trim(),
        element,
      };

      const originalText = element.getAttribute('data-original-text');
      if (originalText) {
        elementData.originalText = originalText;
      }

      this.elementData.set(element, elementData);
      element.classList.add(CSS_CLASSES.PRONUNCIATION_ENABLED);

      if (this.options.getConfig().uiConfig.inlineDisplay) {
        await this.preloadPhonetic(elementData);
      }

      return true;
    } catch (error) {
      console.error('Failed to add pronunciation feature:', error);
      return false;
    }
  }

  unregister(element: HTMLElement): void {
    const elementData = this.elementData.get(element);
    if (!elementData) return;

    if (this.activeMainData === elementData) {
      this.hideMainTooltip();
    }
    if (this.currentlyHoveredData === elementData) {
      this.currentlyHoveredData = null;
      this.timerManager.clear(MAIN_SHOW_TIMER);
    }

    element.classList.remove(
      CSS_CLASSES.PRONUNCIATION_ENABLED,
      CSS_CLASSES.PRONUNCIATION_LOADING,
    );

    this.elementData.delete(element);
  }

  destroy(): void {
    this.timerManager.clearAll();
    this.hideWordTooltipElement();
    this.hideMainTooltip();
    this.currentlyHoveredData = null;
    // Safety net for tooltips left behind by a previous instance (one-off cost)
    DOMUtils.cleanupElements('.wxt-pronunciation-tooltip, .wxt-word-tooltip');

    // Registered words are only reachable through the DOM (WeakMap keys)
    document.querySelectorAll(PRONUNCIATION_SELECTOR).forEach((element) => {
      this.unregister(element as HTMLElement);
    });

    document.removeEventListener('mouseover', this.handleDocumentMouseOver, {
      capture: true,
    });
    document.removeEventListener('mouseout', this.handleDocumentMouseOut, {
      capture: true,
    });
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    document.removeEventListener('keyup', this.handleDocumentKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.options.storageService.removeEventListener(
      StorageEventType.SETTINGS_CHANGED,
      this.handleSettingsChanged,
    );
  }

  private async loadHotkeyConfig(): Promise<void> {
    try {
      this.applyHotkeySettings(
        await this.options.storageService.getUserSettings(),
      );
    } catch (error) {
      console.error('Failed to get hotkey config:', error);
    }
  }

  private applyHotkeySettings(settings: UserSettings | null): void {
    this.hotkeyRequired = !!settings?.pronunciationHotkey?.enabled;
  }

  private readonly handleSettingsChanged = (event: StorageEventData): void => {
    this.applyHotkeySettings(event.data as UserSettings | null);
  };

  private async preloadPhonetic(
    elementData: PronunciationElementData,
  ): Promise<void> {
    if (elementData.phonetic) return;

    try {
      elementData.element.classList.add(CSS_CLASSES.PRONUNCIATION_LOADING);

      const result = await this.options.phoneticProvider.getPhonetic(
        elementData.word,
      );
      if (result.success && result.data) {
        elementData.phonetic = result.data;
        this.displayInlinePhonetic(elementData);
      }
    } catch (error) {
      console.error('Failed to preload phonetics:', error);
    } finally {
      elementData.element.classList.remove(CSS_CLASSES.PRONUNCIATION_LOADING);
    }
  }

  private displayInlinePhonetic(elementData: PronunciationElementData): void {
    if (
      !elementData.phonetic ||
      !this.options.getConfig().uiConfig.showPhonetic
    ) {
      return;
    }

    const phoneticText = elementData.phonetic.phonetics[0]?.text;
    if (!phoneticText) return;

    elementData.element.appendChild(
      DOMUtils.createPhoneticInlineElement(phoneticText),
    );
  }

  // ==================== Delegated hover handling ====================

  /**
   * Resolve the registered pronunciation word that contains an event target.
   */
  private findRegisteredElement(
    target: EventTarget | null,
  ): PronunciationElementData | null {
    if (!target || typeof (target as Element).closest !== 'function') {
      return null;
    }
    const element = (target as Element).closest(PRONUNCIATION_SELECTOR);
    if (!element) return null;
    return this.elementData.get(element as HTMLElement) ?? null;
  }

  private readonly handleDocumentMouseOver = (event: MouseEvent): void => {
    // A visible tooltip whose word was removed from the page is stale
    if (this.activeMainData && !this.activeMainData.element.isConnected) {
      this.hideWordTooltipElement();
      this.hideMainTooltip();
    }

    if (!this.options.getConfig().uiConfig.tooltipEnabled) return;

    const hovered = this.currentlyHoveredData;
    // Fast path: still inside the word that is already hovered
    if (
      hovered &&
      event.target instanceof Node &&
      hovered.element.contains(event.target)
    ) {
      return;
    }

    const elementData = this.findRegisteredElement(event.target);
    if (!elementData || elementData === hovered) return;

    if (hovered) {
      this.handleWordLeave(hovered);
    }
    this.handleWordEnter(elementData);
  };

  private readonly handleDocumentMouseOut = (event: MouseEvent): void => {
    const hovered = this.currentlyHoveredData;
    if (!hovered) return;

    const related = event.relatedTarget;
    // Moving between children of the same word is not a leave
    if (related instanceof Node && hovered.element.contains(related)) {
      return;
    }
    if (
      !(event.target instanceof Node) ||
      !hovered.element.contains(event.target)
    ) {
      return;
    }

    this.handleWordLeave(hovered);
  };

  private handleWordEnter(elementData: PronunciationElementData): void {
    elementData.isMouseOver = true;
    this.currentlyHoveredData = elementData;

    if (!this.checkHotkey()) {
      return;
    }
    this.scheduleShowMainTooltip(elementData);
  }

  private handleWordLeave(elementData: PronunciationElementData): void {
    elementData.isMouseOver = false;
    if (this.currentlyHoveredData === elementData) {
      this.currentlyHoveredData = null;
    }

    this.timerManager.clear(MAIN_SHOW_TIMER);
    // Whatever tooltip is visible times out unless the pointer reaches it
    this.scheduleHideMainTooltip();
  }

  private checkHotkey(): boolean {
    return !this.hotkeyRequired || this.isCtrlPressed;
  }

  private scheduleShowMainTooltip(elementData: PronunciationElementData): void {
    if (!this.options.getConfig().uiConfig.tooltipEnabled) return;

    // Re-entering the word whose tooltip is still visible just keeps it open
    if (
      this.activeMainData === elementData &&
      elementData.tooltip?.isConnected
    ) {
      this.timerManager.clear(MAIN_HIDE_TIMER);
      return;
    }

    this.timerManager.set(
      MAIN_SHOW_TIMER,
      () => {
        if (!elementData.element.isConnected) return;
        this.showMainTooltipWithAsyncContent(elementData);
      },
      TIMER_CONSTANTS.SHOW_DELAY,
    );
  }

  private scheduleHideMainTooltip(): void {
    const elementData = this.activeMainData;
    if (!elementData) return;

    this.timerManager.set(
      MAIN_HIDE_TIMER,
      () => {
        if (!this.currentWordTooltip && this.activeMainData === elementData) {
          this.hideMainTooltip();
        }
      },
      TIMER_CONSTANTS.HIDE_DELAY,
    );
  }

  // ==================== Main tooltip ====================

  private showMainTooltipWithAsyncContent(
    elementData: PronunciationElementData,
  ): void {
    const words = DOMUtils.extractWords(elementData.word);
    const isPhrase = words.length > 1;

    if (isPhrase) {
      this.showTooltip(elementData);
      return;
    }

    const needPhonetic = !elementData.phonetic;
    const needMeaning = !elementData.phonetic?.aiTranslation;

    if (!elementData.phonetic) {
      elementData.phonetic = this.createEmptyPhoneticInfo(elementData.word);
    }

    this.showTooltip(elementData);

    if (needPhonetic) {
      void this.loadPhoneticForMainTooltip(elementData);
    }

    if (needMeaning) {
      void this.loadMeaningForMainTooltip(elementData);
    }
  }

  private showTooltip(elementData: PronunciationElementData): void {
    this.hideWordTooltipElement();
    this.hideMainTooltip();

    const words = DOMUtils.extractWords(elementData.word);
    if (words.length <= 1 && !elementData.phonetic) {
      elementData.phonetic = this.createEmptyPhoneticInfo(elementData.word);
    }

    const tooltip = this.createTooltip(elementData);
    elementData.tooltip = tooltip;
    document.body.appendChild(tooltip);

    PositionUtils.positionTooltip(elementData.element, tooltip);

    this.activeMainData = elementData;
  }

  private hideMainTooltip(): void {
    this.timerManager.clear(MAIN_HIDE_TIMER);
    const elementData = this.activeMainData;
    if (!elementData) return;

    elementData.tooltip?.remove();
    elementData.tooltip = undefined;
    this.activeMainData = null;
  }

  private createTooltip(elementData: PronunciationElementData): HTMLElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'wxt-pronunciation-tooltip';
    tooltip.appendChild(
      this.options.renderer.createMainTooltipElement(elementData),
    );

    this.attachTooltipEventListeners(tooltip, elementData);

    const words = DOMUtils.extractWords(elementData.word);
    if (words.length > 1) {
      this.setupWordInteractions(tooltip);
    }

    return tooltip;
  }

  private attachTooltipEventListeners(
    tooltip: HTMLElement,
    elementData: PronunciationElementData,
  ): void {
    // These listeners live on the tooltip itself and are released with it
    tooltip.addEventListener('mouseenter', () => {
      this.timerManager.clear(MAIN_HIDE_TIMER);
    });

    tooltip.addEventListener('mouseleave', () => {
      this.scheduleHideMainTooltip();
    });

    const audioBtn = tooltip.querySelector('.wxt-audio-btn');
    audioBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.options.speakText(elementData.word);
    });
  }

  // ==================== Nested word tooltip (phrases) ====================

  private setupWordInteractions(tooltip: HTMLElement): void {
    const wordElements = tooltip.querySelectorAll('.wxt-interactive-word');

    wordElements.forEach((wordElement) => {
      const word = wordElement.getAttribute('data-word');
      if (!word) return;

      wordElement.addEventListener('mouseenter', () => {
        this.timerManager.clear(WORD_HIDE_TIMER);
        this.timerManager.clear(WORD_SHOW_TIMER);
        this.hideWordTooltip();

        this.timerManager.set(
          WORD_SHOW_TIMER,
          () => {
            this.showWordTooltip(wordElement as HTMLElement, word);
          },
          TIMER_CONSTANTS.WORD_SHOW_DELAY,
        );
      });

      wordElement.addEventListener('mouseleave', () => {
        this.timerManager.clear(WORD_SHOW_TIMER);

        this.timerManager.set(
          WORD_HIDE_TIMER,
          () => {
            this.hideWordTooltip();
          },
          TIMER_CONSTANTS.HIDE_DELAY,
        );
      });
    });
  }

  private showWordTooltip(wordElement: HTMLElement, word: string): void {
    try {
      if (!wordElement.isConnected) return;

      this.hideWordTooltipElement();
      this.timerManager.clear(MAIN_HIDE_TIMER);

      const wordTooltip = document.createElement('div');
      wordTooltip.className = 'wxt-word-tooltip';
      wordTooltip.appendChild(
        this.options.renderer.createNestedWordTooltipElement(word),
      );

      this.attachNestedWordTooltipEvents(wordTooltip, word);

      document.body.appendChild(wordTooltip);
      PositionUtils.positionTooltip(
        wordElement,
        wordTooltip,
        UI_CONSTANTS.WORD_TOOLTIP_Z_INDEX,
        'bottom',
      );

      this.currentWordTooltip = wordTooltip;

      requestAnimationFrame(() => {
        wordTooltip.style.visibility = 'visible';
        wordTooltip.style.opacity = '1';
      });

      void this.loadPhoneticForWordTooltip(wordTooltip, word);
      void this.loadMeaningForWordTooltip(wordTooltip, word);
    } catch (error) {
      console.error('Failed to show word tooltip:', error);
    }
  }

  private attachNestedWordTooltipEvents(
    wordTooltip: HTMLElement,
    word: string,
  ): void {
    const audioBtns = wordTooltip.querySelectorAll('.wxt-accent-audio-btn');
    audioBtns.forEach((audioBtn) => {
      audioBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const accent = audioBtn.getAttribute('data-accent');
        if (accent === 'uk') {
          void this.options.speakTextWithAccent(word, 'en-GB');
        } else if (accent === 'us') {
          void this.options.speakTextWithAccent(word, 'en-US');
        } else {
          void this.options.speakText(word);
        }
      });
    });

    wordTooltip.addEventListener('mouseenter', (event) => {
      event.stopPropagation();
      this.timerManager.clear(WORD_HIDE_TIMER);
      this.timerManager.clear(MAIN_HIDE_TIMER);
    });

    wordTooltip.addEventListener('mouseleave', (event) => {
      event.stopPropagation();
      this.timerManager.set(
        WORD_HIDE_TIMER,
        () => {
          this.hideWordTooltip();
        },
        TIMER_CONSTANTS.HIDE_DELAY,
      );
    });
  }

  /**
   * Remove the nested word tooltip without touching the main tooltip timers.
   */
  private hideWordTooltipElement(): void {
    this.timerManager.clear(WORD_SHOW_TIMER);
    this.timerManager.clear(WORD_HIDE_TIMER);
    this.currentWordTooltip?.remove();
    this.currentWordTooltip = null;
  }

  /**
   * Hide the nested word tooltip and let the main tooltip time out again.
   */
  private hideWordTooltip(): void {
    if (!this.currentWordTooltip) return;

    this.currentWordTooltip.remove();
    this.currentWordTooltip = null;
    this.scheduleHideMainTooltip();
  }

  // ==================== Async content ====================

  private async loadPhoneticForMainTooltip(
    elementData: PronunciationElementData,
  ): Promise<void> {
    try {
      const currentTranslation = elementData.phonetic?.aiTranslation;
      const phonetic = await this.getPhoneticInfo(elementData.word);
      if (currentTranslation && !phonetic.aiTranslation) {
        phonetic.aiTranslation = currentTranslation;
      }
      elementData.phonetic = phonetic;
    } catch (error) {
      console.error('Failed to get phonetics:', error);
      const currentTranslation = elementData.phonetic?.aiTranslation;
      elementData.phonetic = this.createPhoneticError(
        elementData.word,
        'Phonetic fetch error',
      );
      if (currentTranslation) {
        elementData.phonetic.aiTranslation = currentTranslation;
      }
    }

    if (elementData.tooltip) {
      this.options.renderer.updateTooltipWithPhonetic(
        elementData.tooltip,
        elementData.phonetic,
      );
    }
  }

  private async loadMeaningForMainTooltip(
    elementData: PronunciationElementData,
  ): Promise<void> {
    try {
      const meaningResult = await this.options.translationProvider.getMeaning(
        elementData.word,
      );
      if (!meaningResult.success || !meaningResult.data) {
        return;
      }

      elementData.phonetic ??= this.createEmptyPhoneticInfo(elementData.word);
      elementData.phonetic.aiTranslation = meaningResult.data;

      if (elementData.tooltip) {
        this.options.renderer.updateTooltipWithMeaning(
          elementData.tooltip,
          meaningResult.data.explain,
        );
      }
    } catch (error) {
      console.error('Failed to get AI translation:', error);
    }
  }

  private async loadPhoneticForWordTooltip(
    wordTooltip: HTMLElement,
    word: string,
  ): Promise<void> {
    let phonetic: PhoneticInfo;
    try {
      phonetic = await this.getPhoneticInfo(word);
    } catch (error) {
      console.error('Failed to get word tooltip phonetics:', error);
      phonetic = this.createPhoneticError(word, 'Phonetic fetch error');
    }

    if (this.currentWordTooltip === wordTooltip) {
      this.options.renderer.updateTooltipWithPhonetic(wordTooltip, phonetic);
    }
  }

  private async loadMeaningForWordTooltip(
    wordTooltip: HTMLElement,
    word: string,
  ): Promise<void> {
    try {
      const meaningResult =
        await this.options.translationProvider.getMeaning(word);
      if (
        meaningResult.success &&
        meaningResult.data &&
        this.currentWordTooltip === wordTooltip
      ) {
        this.options.renderer.updateTooltipWithMeaning(
          wordTooltip,
          meaningResult.data.explain,
        );
      }
    } catch (error) {
      console.error('Failed to get word tooltip definition:', error);
    }
  }

  private async getPhoneticInfo(word: string): Promise<PhoneticInfo> {
    const result = await this.options.phoneticProvider.getPhonetic(word);
    if (result.success && result.data) {
      return result.data;
    }

    return this.createPhoneticError(
      word,
      result.error || 'Phonetic fetch failed',
    );
  }

  private createEmptyPhoneticInfo(word: string): PhoneticInfo {
    return {
      word,
      phonetics: [],
    };
  }

  private createPhoneticError(word: string, message: string): PhoneticInfo {
    return {
      word,
      phonetics: [],
      error: {
        hasPhoneticError: true,
        phoneticErrorMessage: message,
      },
    };
  }

  // ==================== Hotkey ====================

  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Control' || this.isCtrlPressed) {
      return;
    }

    this.isCtrlPressed = true;

    if (!this.hotkeyRequired) {
      return;
    }

    const hovered = this.currentlyHoveredData;
    if (hovered && hovered.element.isConnected) {
      event.preventDefault();
      this.scheduleShowMainTooltip(hovered);
    }
  };

  private readonly handleDocumentKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Control') {
      this.isCtrlPressed = false;
    }
  };

  private readonly handleWindowBlur = (): void => {
    this.isCtrlPressed = false;
  };
}
