/**
 * Style manager
 * Manages translated text styles and CSS injection
 */

import { TranslationStyle } from '../../shared/types/core';
import { ALL_STYLES } from '../index';

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
    if (!this.customStyleElement) {
      this.customStyleElement = document.createElement('style');
      this.customStyleElement.id = 'wxt-custom-translation-style';
      document.head.appendChild(this.customStyleElement);
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
    // Avoid duplicate injection
    if (this.mainStyleElement) {
      return;
    }

    this.mainStyleElement = document.createElement('style');
    this.mainStyleElement.id = 'wxt-main-styles';
    this.mainStyleElement.textContent = ALL_STYLES;
    document.head.appendChild(this.mainStyleElement);
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
