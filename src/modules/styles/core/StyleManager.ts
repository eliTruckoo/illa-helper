/**
 * Style manager
 * Manages translated text styles and CSS injection
 */

import { TranslationStyle } from '../../shared/types/core';
import { ALL_STYLES } from '../index';

// Element ids double as the injection guard: several StyleManager instances
// (content manager, text replacer, paragraph translation) share one document,
// so the stylesheet must be injected once per document, not once per instance.
const MAIN_STYLE_ELEMENT_ID = 'wxt-main-styles';
const CUSTOM_STYLE_ELEMENT_ID = 'wxt-custom-translation-style';

export class StyleManager {
  private currentStyle: TranslationStyle;
  private customCSS: string = '';
  private customStyleElement: HTMLStyleElement | null = null;
  private mainStyleElement: HTMLStyleElement | null = null;

  constructor() {
    this.currentStyle = TranslationStyle.DEFAULT;
    // Initialize styles
    this.initializeStyles();
  }

  /**
   * Set the translation style
   * @param style Style type
   */
  setTranslationStyle(style: TranslationStyle): void {
    this.currentStyle = style;
  }

  /**
   * Set custom CSS
   * @param css Custom CSS styles
   */
  setCustomCSS(css: string): void {
    this.customCSS = css;
    this.updateCustomStyle();
  }

  /**
   * Get the current style class name
   * @returns Style class name
   */
  getCurrentStyleClass(): string {
    if (this.currentStyle === TranslationStyle.LEARNING) {
      return 'wxt-translation-term--learning';
    }
    if (this.currentStyle === TranslationStyle.CUSTOM) {
      return 'wxt-style-custom';
    }

    return `wxt-style-${this.currentStyle}`;
  }

  /**
   * Update custom styles
   */
  private updateCustomStyle(): void {
    if (!this.customStyleElement?.isConnected) {
      this.customStyleElement =
        (document.getElementById(
          CUSTOM_STYLE_ELEMENT_ID,
        ) as HTMLStyleElement | null) ??
        this.createStyleElement(CUSTOM_STYLE_ELEMENT_ID);
    }

    // Safely wrap user CSS so it only applies to translation elements
    const safeCSS = this.customCSS?.trim()
      ? `.wxt-style-custom { ${this.customCSS} }`
      : '.wxt-style-custom { /* Add custom CSS in settings */ }';

    this.customStyleElement.textContent = safeCSS;
  }

  /**
   * Initialize styles
   * Inject CSS styles into the page
   */
  private initializeStyles(): void {
    // Avoid duplicate injection, also across StyleManager instances
    const existing = document.getElementById(
      MAIN_STYLE_ELEMENT_ID,
    ) as HTMLStyleElement | null;
    if (existing) {
      this.mainStyleElement = existing;
      return;
    }

    this.mainStyleElement = this.createStyleElement(MAIN_STYLE_ELEMENT_ID);
    this.mainStyleElement.textContent = ALL_STYLES;
  }

  private createStyleElement(id: string): HTMLStyleElement {
    const style = document.createElement('style');
    style.id = id;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  /**
   * Clean up style elements
   * Used to clean up the DOM when the component unmounts
   */
  cleanup(): void {
    if (this.mainStyleElement && this.mainStyleElement.parentNode) {
      this.mainStyleElement.parentNode.removeChild(this.mainStyleElement);
      this.mainStyleElement = null;
    }

    if (this.customStyleElement && this.customStyleElement.parentNode) {
      this.customStyleElement.parentNode.removeChild(this.customStyleElement);
      this.customStyleElement = null;
    }
  }

  /**
   * Re-initialize styles
   * Used for style updates or resets
   */
  reinitialize(): void {
    this.cleanup();
    this.initializeStyles();
    if (this.customCSS) {
      this.updateCustomStyle();
    }
  }
}
