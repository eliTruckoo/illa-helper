/**
 * Word exposure tracking (learning layer), content side.
 *
 * Counts the replacements actually shown on the page and sends them to the
 * background in aggregated, debounced `tm-words-record` messages (never per word).
 * Nothing is recorded in incognito tabs (also enforced by the background).
 */

import {
  TM_MAX_WORDS_PER_MESSAGE,
  TM_MESSAGE_TYPES,
  normalizeLanguageTag,
  type TmWordDelta,
} from './TranslationMemoryShared';
import type { TmSend } from './TranslationMemoryClient';

/** Exposures are collected for this long before one message is sent */
export const WORD_EXPOSURE_FLUSH_DELAY_MS = 5000;

export interface WordExposureConfig {
  enabled: boolean;
  srcLang: string;
  tgtLang: string;
}

const defaultSend: TmSend = async (message) => {
  if (typeof browser?.runtime?.sendMessage !== 'function') {
    throw new Error('Extension runtime is not available');
  }
  return browser.runtime.sendMessage(message);
};

function isIncognitoContext(): boolean {
  try {
    return !!(browser as any)?.extension?.inIncognitoContext;
  } catch {
    return false;
  }
}

export class WordExposureRecorder {
  private config: WordExposureConfig = {
    enabled: false,
    srcLang: 'und',
    tgtLang: 'und',
  };
  /** `${surface}\u0001${translation}` -> delta */
  private pending = new Map<string, TmWordDelta>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pageHideListening = false;

  constructor(
    private readonly send: TmSend = defaultSend,
    private readonly flushDelayMs: number = WORD_EXPOSURE_FLUSH_DELAY_MS,
    private readonly incognito: () => boolean = isIncognitoContext,
  ) {}

  configure(config: WordExposureConfig): void {
    const next = {
      enabled: config.enabled,
      srcLang: normalizeLanguageTag(config.srcLang),
      tgtLang: normalizeLanguageTag(config.tgtLang),
    };
    // Counts belong to the language pair they were collected under
    if (
      next.srcLang !== this.config.srcLang ||
      next.tgtLang !== this.config.tgtLang ||
      !next.enabled
    ) {
      void this.flush();
    }
    this.config = next;
  }

  /**
   * Count replacements that were applied to the page.
   */
  record(pairs: Array<{ original: string; translation: string }>): void {
    if (!this.config.enabled || pairs.length === 0 || this.incognito()) return;

    for (const { original, translation } of pairs) {
      const surface = (original || '').trim();
      const target = (translation || '').trim();
      if (!surface || !target) continue;
      const id = `${surface.toLowerCase()}\u0001${target}`;
      const delta = this.pending.get(id);
      if (delta) {
        delta.count++;
      } else {
        this.pending.set(id, { surface, translation: target, count: 1 });
      }
    }

    this.listenForPageHide();
    if (this.timer === null && this.pending.size > 0) {
      this.timer = setTimeout(() => {
        void this.flush();
      }, this.flushDelayMs);
    }
  }

  /** Send the collected exposures now */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0) return;

    const items = [...this.pending.values()];
    this.pending = new Map();
    const { srcLang, tgtLang } = this.config;

    const sends: Promise<unknown>[] = [];
    for (let i = 0; i < items.length; i += TM_MAX_WORDS_PER_MESSAGE) {
      sends.push(
        this.send({
          type: TM_MESSAGE_TYPES.WORDS_RECORD,
          srcLang,
          tgtLang,
          items: items.slice(i, i + TM_MAX_WORDS_PER_MESSAGE),
        }).catch(() => undefined),
      );
    }
    await Promise.all(sends);
  }

  /** Number of distinct pending (word, translation) pairs */
  get pendingCount(): number {
    return this.pending.size;
  }

  private listenForPageHide(): void {
    if (this.pageHideListening) return;
    this.pageHideListening = true;
    try {
      globalThis.addEventListener?.('pagehide', () => {
        void this.flush();
      });
    } catch {
      // Not a window context
    }
  }
}

/** Shared recorder of this document */
export const wordExposureRecorder = new WordExposureRecorder();
