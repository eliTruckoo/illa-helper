/**
 * Positioning utilities
 * Provides tooltip positioning helpers
 */

import { UI_CONSTANTS } from '../config';

export type TooltipPosition = 'top' | 'bottom' | 'auto';

export interface PositionResult {
  left: number;
  top: number;
  arrowClass: string;
}

export class PositionUtils {
  /**
   * Calculate tooltip position
   * @param element Target element
   * @param tooltip Tooltip element
   * @param zIndex z-index value
   * @param position Position preference
   */
  static positionTooltip(
    element: HTMLElement,
    tooltip: HTMLElement,
    zIndex: number = UI_CONSTANTS.TOOLTIP_Z_INDEX,
    position: TooltipPosition = 'auto',
  ): void {
    // Set basic styles first so the tooltip can be measured
    tooltip.style.cssText = `
      position: fixed;
      visibility: hidden;
      z-index: ${zIndex};
    `;

    const positionResult = this.calculatePosition(element, tooltip, position);

    // Update arrow styles
    const arrow = tooltip.querySelector('.wxt-tooltip-arrow');
    if (arrow) {
      arrow.className = positionResult.arrowClass;
    }

    // Apply the final position
    tooltip.style.cssText = `
      position: fixed;
      left: ${positionResult.left}px;
      top: ${positionResult.top}px;
      z-index: ${zIndex};
      visibility: visible;
    `;
  }

  /**
   * Calculate tooltip position
   * @param element Target element
   * @param tooltip Tooltip element
   * @param position Position preference
   */
  static calculatePosition(
    element: HTMLElement,
    tooltip: HTMLElement,
    position: TooltipPosition = 'auto',
  ): PositionResult {
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = UI_CONSTANTS.TOOLTIP_PADDING;

    // Calculate horizontal position (centered)
    let left = rect.left + (rect.width - tooltipRect.width) / 2;
    if (left < padding) {
      left = padding;
    } else if (left + tooltipRect.width > viewportWidth - padding) {
      left = viewportWidth - tooltipRect.width - padding;
    }

    // Calculate vertical position
    let top: number;
    let arrowClass: string;

    if (position === 'bottom') {
      // Force display below
      top = rect.bottom + 12;
      arrowClass = 'wxt-tooltip-arrow wxt-tooltip-arrow-top';
    } else if (position === 'top') {
      // Force display above
      top = rect.top - tooltipRect.height - 12;
      arrowClass = 'wxt-tooltip-arrow';
    } else {
      // Auto-select (prefer above)
      top = rect.top - tooltipRect.height - 12;
      arrowClass = 'wxt-tooltip-arrow';

      // If there is not enough space above, display below
      if (top < padding) {
        top = rect.bottom + 12;
        arrowClass = 'wxt-tooltip-arrow wxt-tooltip-arrow-top';
      }
    }

    // Vertical boundary check
    if (top + tooltipRect.height > viewportHeight - padding) {
      top = viewportHeight - tooltipRect.height - padding;
    }

    return { left, top, arrowClass };
  }

  /**
   * Check whether the element is within the viewport
   * @param element Target element
   */
  static isElementInViewport(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );
  }

  /**
   * Get the element's position relative to the viewport
   * @param element Target element
   */
  static getElementViewportInfo(element: HTMLElement): {
    rect: DOMRect;
    isInViewport: boolean;
    distanceFromTop: number;
    distanceFromBottom: number;
    distanceFromLeft: number;
    distanceFromRight: number;
  } {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    return {
      rect,
      isInViewport: this.isElementInViewport(element),
      distanceFromTop: rect.top,
      distanceFromBottom: viewportHeight - rect.bottom,
      distanceFromLeft: rect.left,
      distanceFromRight: viewportWidth - rect.right,
    };
  }
}
