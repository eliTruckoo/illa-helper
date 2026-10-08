/**
 * DOM utility class
 * Provides utility methods for DOM operations
 */

import { CSS_CLASSES } from '../config';

export class DOMUtils {
  /**
   * Generate a unique element ID
   * @param prefix prefix
   */
  static generateUniqueId(prefix = 'wxt'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add a unique identifier to an element
   * @param element target element
   */
  static addUniqueId(element: HTMLElement): string {
    let id = element.getAttribute('data-wxt-id');
    if (!id) {
      id = this.generateUniqueId();
      element.setAttribute('data-wxt-id', id);
    }
    return id;
  }

  /**
   * Get the unique key of an element
   * @param element target element
   */
  static getElementKey(element: HTMLElement): string {
    return element.getAttribute('data-wxt-id') || 'unknown';
  }

  /**
   * Remove all elements matching the given selector
   * @param selector CSS selector
   */
  static cleanupElements(selector: string): void {
    const elements = document.querySelectorAll(selector);
    elements.forEach((element) => {
      try {
        element.remove();
      } catch (_) {
        console.info(_);
      }
    });
  }

  /**
   * Create an inline phonetic element
   * @param phoneticText phonetic text
   */
  static createPhoneticInlineElement(phoneticText: string): HTMLElement {
    const phoneticSpan = document.createElement('span');
    phoneticSpan.className = CSS_CLASSES.PHONETIC_INLINE;
    phoneticSpan.textContent = ` ${phoneticText}`;
    phoneticSpan.style.cssText = `
      font-size: 0.85em;
      color: #666;
      margin-left: 2px;
      font-style: italic;
    `;
    return phoneticSpan;
  }

  /**
   * Extract the word list
   * @param text text
   */
  static extractWords(text: string): string[] {
    return text
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 0 && /^[a-zA-Z\-']+$/.test(word))
      .map((word) => word.replace(/^[^\w\-']+|[^\w\-']+$/g, ''))
      .filter((word) => word.length > 0);
  }

  /**
   * Check whether an element has the given CSS class
   * @param element target element
   * @param className CSS class name
   */
  static hasClass(element: HTMLElement, className: string): boolean {
    return element.classList.contains(className);
  }

  /**
   * Safely add a CSS class
   * @param element target element
   * @param className CSS class name
   */
  static addClass(element: HTMLElement, className: string): void {
    if (!this.hasClass(element, className)) {
      element.classList.add(className);
    }
  }

  /**
   * Safely remove a CSS class
   * @param element target element
   * @param className CSS class name
   */
  static removeClass(element: HTMLElement, className: string): void {
    if (this.hasClass(element, className)) {
      element.classList.remove(className);
    }
  }

  /**
   * Toggle a CSS class
   * @param element target element
   * @param className CSS class name
   */
  static toggleClass(element: HTMLElement, className: string): boolean {
    return element.classList.toggle(className);
  }

  /**
   * Safely set an element attribute
   * @param element target element
   * @param name attribute name
   * @param value attribute value
   */
  static setAttribute(element: HTMLElement, name: string, value: string): void {
    try {
      element.setAttribute(name, value);
    } catch (e) {
      console.warn(`Failed to set attribute: ${name}=${value}`, e);
    }
  }

  /**
   * Safely get an element attribute
   * @param element target element
   * @param name attribute name
   * @param defaultValue default value
   */
  static getAttribute(
    element: HTMLElement,
    name: string,
    defaultValue = '',
  ): string {
    try {
      return element.getAttribute(name) || defaultValue;
    } catch (e) {
      console.warn(`Failed to get attribute: ${name}`, e);
      return defaultValue;
    }
  }

  /**
   * Find the nearest ancestor element with the given class name
   * @param element starting element
   * @param className CSS class name
   */
  static findClosestWithClass(
    element: HTMLElement,
    className: string,
  ): HTMLElement | null {
    let current: HTMLElement | null = element;
    while (current && current !== document.body) {
      if (this.hasClass(current, className)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }
}
