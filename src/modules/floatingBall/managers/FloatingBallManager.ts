/**
 * Floating ball manager
 * Creates and manages the translation floating ball on the page
 */

import type { FloatingBallConfig } from '../../shared/types/ui';
import type { FloatingBallState, FloatingBallActionType } from '../types';
import { FLOATING_BALL_STYLES, DRAG_CONFIG, MENU_ACTIONS } from '../config';
import { safeSetInnerHTML } from '../../../utils';
import { StorageService } from '../../core/storage';

export class FloatingBallManager {
  private config: FloatingBallConfig;
  private state: FloatingBallState;
  private rootHost: HTMLElement | null = null;
  private uiRoot: ShadowRoot | null = null;
  private ballElement: HTMLElement | null = null;
  private menuContainer: HTMLElement | null = null;
  private dragStartY = 0;
  private ballStartY = 0;
  private onTranslateCallback?: () => void;
  private savePositionTimer: number | null = null;

  private storageService: StorageService;
  // Event listener reference management
  private eventListeners: Array<{
    target: EventTarget;
    type: string;
    listener: EventListener;
    options?: boolean | AddEventListenerOptions;
  }> = [];
  // Double-click and touch detection
  private lastClickTime = 0;
  private clickDebounceTimer: number | null = null;
  private isTouchDevice = false;
  // Menu hover related
  private menuHoverTimer: number | null = null;

  constructor(config: FloatingBallConfig) {
    this.config = config;
    this.state = {
      isDragging: false,
      isVisible: false,
      isMenuExpanded: false,
      currentPosition: config.position,
    };

    // Initialize services
    this.storageService = StorageService.getInstance();

    // Initialize touch device detection
    this.isTouchDevice =
      'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  /**
   * Unified event listener binding method
   */
  private bindEventListener<K extends keyof DocumentEventMap>(
    target: EventTarget,
    type: K,
    listener: (this: Document, ev: DocumentEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  private bindEventListener(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void;
  private bindEventListener(
    target: EventTarget,
    type: string,
    listener: EventListener | ((ev: Event) => unknown),
    options?: boolean | AddEventListenerOptions,
  ): void {
    const wrappedListener = listener as EventListener;
    target.addEventListener(type, wrappedListener, options);
    this.eventListeners.push({
      target,
      type,
      listener: wrappedListener,
      options,
    });
  }

  /**
   * Remove all event listeners
   */
  private removeAllEventListeners(): void {
    this.eventListeners.forEach(({ target, type, listener, options }) => {
      target.removeEventListener(type, listener, options);
    });
    this.eventListeners = [];
  }

  /**
   * Initialize the floating ball
   */
  init(onTranslate?: () => void): void {
    this.onTranslateCallback = onTranslate;

    if (this.config.enabled) {
      this.createBall();
      this.setupEventListeners();
      this.state.isVisible = true;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: FloatingBallConfig): void {
    const wasEnabled = this.config.enabled;
    this.config = config;
    this.state.currentPosition = config.position;

    if (config.enabled && !wasEnabled) {
      // Changed from disabled to enabled
      this.createBall();
      this.setupEventListeners();
      this.state.isVisible = true;
    } else if (!config.enabled && wasEnabled) {
      // Changed from enabled to disabled. Keep the translate callback: the ball
      // is re-created when it is enabled again and must still work.
      this.teardown();
      this.state.isVisible = false;
    } else if (config.enabled && this.ballElement) {
      // Update styles
      this.updateBallStyle();
      // Ensure the position is exact
      this.calibratePosition();
    }
  }

  /**
   * Create the floating ball element
   */
  private createBall(): void {
    if (this.ballElement) {
      this.ballElement.remove();
    }

    const uiRoot = this.ensureUiRoot();
    this.ballElement = document.createElement('div');
    this.ballElement.className = 'wxt-floating-ball';
    safeSetInnerHTML(this.ballElement, this.createBallIcon());

    // Set the initial tooltip
    this.updateTooltipText();

    this.updateBallStyle();
    this.createMenu();
    uiRoot.appendChild(this.ballElement);
  }

  private ensureUiRoot(): ShadowRoot {
    if (this.rootHost?.isConnected && this.uiRoot) {
      return this.uiRoot;
    }

    const existingHost = document.getElementById('illa-floating-root');
    if (existingHost) {
      existingHost.remove();
    }

    const host = document.createElement('illa-floating-root');
    host.id = 'illa-floating-root';
    host.style.cssText = `
      all: initial !important;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      min-width: 0 !important;
      min-height: 0 !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      overflow: visible !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
      background: transparent !important;
    `;

    const shadow = host.attachShadow({ mode: 'open' });
    const resetStyle = document.createElement('style');
    resetStyle.id = 'illa-floating-root-reset';
    resetStyle.textContent = `
      :host {
        all: initial !important;
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        overflow: visible !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        background: transparent !important;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      .wxt-floating-ball,
      .wxt-floating-panel {
        pointer-events: auto;
      }
    `;
    shadow.appendChild(resetStyle);

    document.body.appendChild(host);
    this.rootHost = host;
    this.uiRoot = shadow;

    return shadow;
  }

  /**
   * Create the menu container - card-style panel
   */
  private createMenu(): void {
    if (this.menuContainer) {
      this.menuContainer.remove();
    }

    const uiRoot = this.ensureUiRoot();
    this.menuContainer = document.createElement('div');
    this.menuContainer.className = 'wxt-floating-panel';
    safeSetInnerHTML(this.menuContainer, this.createMenuItems());

    // Inject panel styles
    this.injectPanelStyles();

    uiRoot.appendChild(this.menuContainer);
    // Initially hidden
    this.updateMenuStyle();
  }

  /**
   * Create panel content
   */
  private createMenuItems(): string {
    // Get translation state
    const hasTranslatedContent = this.hasTranslatedContent();
    const isTranslationHidden = document.body.classList.contains(
      'wxt-translation-hidden',
    );

    let statusClass = 'wxt-status--ready';
    let statusText = 'Ready to translate';
    if (hasTranslatedContent && !isTranslationHidden) {
      statusClass = 'wxt-status--translated';
      statusText = 'Translation mode';
    } else if (hasTranslatedContent && isTranslationHidden) {
      statusClass = 'wxt-status--original';
      statusText = 'Original mode';
    }

    const actionButtons = MENU_ACTIONS.map((action) => {
      const dangerClass = action.id === 'close' ? ' wxt-panel-btn--danger' : '';
      return `
        <div class="wxt-panel-btn${dangerClass}" data-action="${action.id}" title="${action.label}">
          <div class="wxt-btn-icon">${action.icon}</div>
          <span class="wxt-btn-label">${action.label}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="wxt-panel-status">
        <span class="wxt-status-dot ${statusClass}"></span>
        <span class="wxt-status-text">${statusText}</span>
      </div>
      <div class="wxt-panel-divider"></div>
      <div class="wxt-panel-actions">
        ${actionButtons}
      </div>
    `;
  }

  /**
   * Inject panel styles
   */
  private injectPanelStyles(): void {
    const uiRoot = this.ensureUiRoot();
    const styleId = 'wxt-floating-panel-styles';
    if (uiRoot.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .wxt-floating-panel {
        position: fixed;
        z-index: 9999;
        width: 180px;
        padding: 10px;
        border-radius: 12px;
        pointer-events: auto;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: rgba(255, 255, 255, 0.82);
        border: 1px solid rgba(106, 136, 224, 0.15);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(106, 136, 224, 0.1);
        backdrop-filter: blur(20px) saturate(1.4);
        -webkit-backdrop-filter: blur(20px) saturate(1.4);
        opacity: 0;
        transform: translateX(8px) scale(0.92);
        transform-origin: right center;
        transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .wxt-floating-panel.wxt-panel-visible {
        opacity: 1;
        transform: translateX(0) scale(1);
      }

      /* Status bar */
      .wxt-panel-status {
        display: flex;
        align-items: center;
        padding: 0 2px 8px 2px;
        gap: 6px;
      }
      .wxt-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        transition: background 0.3s ease, box-shadow 0.3s ease;
      }
      .wxt-status-dot.wxt-status--ready {
        background: #6A88E0;
        box-shadow: 0 0 6px rgba(106, 136, 224, 0.4);
      }
      .wxt-status-dot.wxt-status--translated {
        background: #00e676;
        box-shadow: 0 0 6px rgba(0, 230, 118, 0.4);
      }
      .wxt-status-dot.wxt-status--original {
        background: #ff6b6b;
        box-shadow: 0 0 6px rgba(255, 107, 107, 0.4);
      }
      .wxt-status-text {
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
        color: #444;
        letter-spacing: 0.2px;
      }

      /* Divider */
      .wxt-panel-divider {
        height: 1px;
        background: rgba(106, 136, 224, 0.12);
        margin: 0 2px 8px 2px;
      }

      /* Action button grid */
      .wxt-panel-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      .wxt-panel-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 8px 0;
        border-radius: 8px;
        cursor: pointer;
        color: #555;
        background: transparent;
        border: none;
        transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
      }
      .wxt-panel-btn:hover {
        background: rgba(106, 136, 224, 0.1);
        color: #6A88E0;
        transform: translateY(-1px);
      }
      .wxt-panel-btn:active {
        transform: translateY(0) scale(0.96);
      }
      .wxt-panel-btn--danger:hover {
        background: rgba(239, 68, 68, 0.08);
        color: #EF4444;
      }
      .wxt-btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
      }
      .wxt-btn-icon svg {
        width: 18px;
        height: 18px;
      }
      .wxt-btn-label {
        font-size: 11px;
        font-weight: 400;
        line-height: 1;
      }

      /* Dark mode */
      @media (prefers-color-scheme: dark) {
        .wxt-floating-panel {
          background: rgba(30, 30, 36, 0.85);
          border-color: rgba(106, 136, 224, 0.2);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        .wxt-status-text {
          color: rgba(255, 255, 255, 0.8);
        }
        .wxt-panel-divider {
          background: rgba(255, 255, 255, 0.08);
        }
        .wxt-panel-btn {
          color: rgba(255, 255, 255, 0.7);
        }
        .wxt-panel-btn:hover {
          background: rgba(106, 136, 224, 0.2);
          color: #8BA4F0;
        }
        .wxt-panel-btn--danger:hover {
          background: rgba(239, 68, 68, 0.15);
          color: #ff7b7b;
        }
      }
    `;
    uiRoot.appendChild(style);
  }

  /**
   * Create the floating ball icon
   *
   * Dynamically generates different visuals based on the translation state:
   * - No translation content: default purple-blue gradient background + blue status dot (ready to translate)
   * - Translation shown: purple-blue gradient background + green status dot (translation mode)
   * - Translation hidden: pink gradient background + red status dot (original mode)
   *
   * @returns SVG icon string
   */
  private createBallIcon(): string {
    const { iconSize } = FLOATING_BALL_STYLES;

    // Check translation state
    const hasTranslatedContent = this.hasTranslatedContent();
    const isTranslationHidden = document.body.classList.contains(
      'wxt-translation-hidden',
    );

    // Define the three states
    let stateConfig;
    if (!hasTranslatedContent) {
      // No translation content - default state (ready to translate)
      stateConfig = {
        colors: { start: '#667eea', end: '#764ba2', dot: '#4f7cff' },
        opacity: '0.9',
      };
    } else if (isTranslationHidden) {
      // Translation content hidden - original mode
      stateConfig = {
        colors: { start: '#f093fb', end: '#f5576c', dot: '#ff6b6b' },
        opacity: '0.8',
      };
    } else {
      // Translation content visible - translation mode
      stateConfig = {
        colors: { start: '#667eea', end: '#764ba2', dot: '#00ff88' },
        opacity: '1',
      };
    }

    // Translation icon path (the same icon is used for all states)
    const iconPath =
      'M16 10h2l4.4 11h-2.155l-1.201-3h-4.09l-1.199 3h-2.154L16 10zm1 2.885L15.753 16h2.492L17 12.885zM3 4h10v2H9v7h4v2H9v4H7v-4H3v-2h4V6H3V4zM17 3a4 4 0 0 1 4 4v2h-2V7a2 2 0 0 0-2-2h-3V3h3zM5 15v2a2 2 0 0 0 2 2h3v2H7a4 4 0 0 1-4-4v-2h2z';

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}">
        <defs>
          <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${stateConfig.colors.start};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${stateConfig.colors.end};stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${iconSize}" height="${iconSize}" fill="url(#bgGradient)" rx="4" ry="4" opacity="${stateConfig.opacity}"/>
        <path d="${iconPath}" fill="white" opacity="0.9"/>
        <circle cx="18" cy="6" r="2" fill="${stateConfig.colors.dot}" opacity="0.9"/>
      </svg>
    `;
  }

  /**
   * Inject minimal animation styles
   */
  private injectPulseAnimation(): void {
    const uiRoot = this.ensureUiRoot();
    const animationId = 'wxt-floating-ball-animation';
    if (uiRoot.getElementById(animationId)) return;

    const style = document.createElement('style');
    style.id = animationId;
    style.textContent = `
      @keyframes wxt-floating-ball-pulse {
        0%, 100% {
          transform: translateY(-50%) scale(0.9);
        }
        50% {
          transform: translateY(-50%) scale(1);
        }
      }
    `;
    uiRoot.appendChild(style);
  }

  /**
   * Calibrate position - ensure accuracy and boundary safety
   */
  private calibratePosition(): void {
    if (!this.ballElement) return;

    // Validate and correct position
    const correctedPosition = this.validateAndCorrectPosition(
      this.config.position,
    );
    if (correctedPosition !== this.config.position) {
      this.config.position = correctedPosition;
      this.state.currentPosition = correctedPosition;
    }

    // Reset the position to ensure exact alignment
    requestAnimationFrame(() => {
      if (this.ballElement) {
        this.ballElement.style.top = `${this.config.position}%`;
      }
    });
  }

  /**
   * Validate and correct the position to keep it within safe bounds
   */
  private validateAndCorrectPosition(position: number): number {
    // Basic validity check
    if (!this.isValidPosition(position)) {
      return 50; // Default middle position
    }

    // Boundary detection and correction
    const windowHeight = window.innerHeight;
    const ballSize = FLOATING_BALL_STYLES.size;

    // Calculate safe bounds (percentage)
    const minSafePercent = (ballSize / 2 / windowHeight) * 100;
    const maxSafePercent = ((windowHeight - ballSize / 2) / windowHeight) * 100;

    // Ensure within safe bounds
    const safePosition = Math.max(
      Math.max(DRAG_CONFIG.minPosition, minSafePercent),
      Math.min(Math.min(DRAG_CONFIG.maxPosition, maxSafePercent), position),
    );

    return safePosition;
  }

  /**
   * Update floating ball styles
   */
  private updateBallStyle(): void {
    if (!this.ballElement) return;

    const { size, right, background, boxShadow, transition, zIndex } =
      FLOATING_BALL_STYLES;

    // Inject animation styles
    this.injectPulseAnimation();

    const styles = `
      position: fixed;
      right: ${right};
      top: ${this.config.position}%;
      width: ${size}px;
      height: ${size}px;
      background: ${background};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: ${boxShadow};
      opacity: ${this.config.opacity};
      z-index: ${zIndex};
      transition: ${transition};
      user-select: none;
      transform: translateY(-50%);
      animation: wxt-floating-ball-pulse 4s ease-in-out infinite;
    `;

    this.ballElement.style.cssText = styles;

    // Calibrate position
    this.calibratePosition();
  }

  /**
   * Update panel position and visibility
   */
  private updateMenuStyle(): void {
    if (!this.menuContainer || !this.ballElement) return;

    const ballRect = this.ballElement.getBoundingClientRect();

    // Position the panel to the left of the floating ball
    const gap = 8;
    const rightPos = window.innerWidth - ballRect.left + gap;

    // Vertically center-align with the floating ball
    const topPos = ballRect.top + ballRect.height / 2;

    this.menuContainer.style.right = `${rightPos}px`;
    this.menuContainer.style.top = `${topPos}px`;
    this.menuContainer.style.transform = this.state.isMenuExpanded
      ? 'translateY(-50%) translateX(0) scale(1)'
      : 'translateY(-50%) translateX(8px) scale(0.92)';

    if (this.state.isMenuExpanded) {
      this.menuContainer.classList.add('wxt-panel-visible');
      this.menuContainer.style.pointerEvents = 'auto';
    } else {
      this.menuContainer.classList.remove('wxt-panel-visible');
      this.menuContainer.style.pointerEvents = 'none';
    }
  }

  /**
   * Update panel content (called when state changes)
   */
  private updateMenuItemPositions(): void {
    // In panel mode there is no need to position items individually; only update the status display
    if (!this.menuContainer) return;

    const hasTranslatedContent = this.hasTranslatedContent();
    const isTranslationHidden = document.body.classList.contains(
      'wxt-translation-hidden',
    );

    const dot = this.menuContainer.querySelector('.wxt-status-dot');
    const text = this.menuContainer.querySelector('.wxt-status-text');
    if (!dot || !text) return;

    dot.className = 'wxt-status-dot';
    if (hasTranslatedContent && !isTranslationHidden) {
      dot.classList.add('wxt-status--translated');
      text.textContent = 'Translation mode';
    } else if (hasTranslatedContent && isTranslationHidden) {
      dot.classList.add('wxt-status--original');
      text.textContent = 'Original mode';
    } else {
      dot.classList.add('wxt-status--ready');
      text.textContent = 'Ready to translate';
    }
  }

  /**
   * Set up hover effects
   */
  private setupHoverEffects(): void {
    if (!this.ballElement) return;

    const {
      hoverBackground,
      hoverBoxShadow,
      background,
      boxShadow,
      hoverScale,
      activeBackground,
      activeBoxShadow,
    } = FLOATING_BALL_STYLES;

    // Mouse enter effect
    this.bindEventListener(this.ballElement, 'mouseenter', () => {
      if (!this.state.isDragging && this.ballElement) {
        this.ballElement.style.background = hoverBackground;
        this.ballElement.style.transform = `translateY(-50%) scale(${hoverScale})`;
        this.ballElement.style.boxShadow = hoverBoxShadow;
      }
    });

    // Mouse leave effect
    this.bindEventListener(this.ballElement, 'mouseleave', () => {
      if (!this.state.isDragging && this.ballElement) {
        this.ballElement.style.background = background;
        this.ballElement.style.transform = 'translateY(-50%) scale(1)';
        this.ballElement.style.boxShadow = boxShadow;
      }
    });

    // Click active effect
    this.bindEventListener(this.ballElement, 'mousedown', () => {
      if (this.ballElement) {
        this.ballElement.style.background = activeBackground;
        this.ballElement.style.boxShadow = activeBoxShadow;
      }
    });

    // Click release effect
    this.bindEventListener(this.ballElement, 'mouseup', () => {
      if (!this.state.isDragging && this.ballElement) {
        setTimeout(() => {
          if (this.ballElement) {
            this.ballElement.style.background = hoverBackground;
            this.ballElement.style.boxShadow = hoverBoxShadow;
          }
        }, 150); // Briefly show the active state, then restore the hover state
      }
    });
  }

  /**
   * Set up menu hover events
   */
  private setupMenuHoverEvents(): void {
    if (!this.ballElement || !this.menuContainer) return;

    // Show menu when hovering over the floating ball
    this.bindEventListener(this.ballElement, 'mouseenter', () => {
      this.showMenuOnHover();
    });

    // Hide menu when leaving the floating ball (with delay)
    this.bindEventListener(this.ballElement, 'mouseleave', () => {
      this.hideMenuOnLeave();
    });

    // Keep the menu visible while hovering over the menu container
    this.bindEventListener(this.menuContainer, 'mouseenter', () => {
      this.showMenuOnHover();
    });

    // One delegated click listener for all panel buttons, bound together with
    // the panel so it can never be bound twice
    this.bindEventListener(this.menuContainer, 'click', (e) => {
      const button = (e.target as Element | null)?.closest?.('.wxt-panel-btn');
      if (!button) return;
      e.preventDefault();
      e.stopPropagation();
      const action = (button as HTMLElement).dataset
        .action as FloatingBallActionType;
      this.handleMenuAction(action);
    });

    // Hide menu when leaving the menu container
    this.bindEventListener(this.menuContainer, 'mouseleave', () => {
      this.hideMenuOnLeave();
    });

    // Add click-to-toggle menu support for touch devices
    if (this.isTouchDevice) {
      this.bindEventListener(this.ballElement, 'click', (e) => {
        if (!this.state.isDragging) {
          e.preventDefault();
          e.stopPropagation();
          // On touch devices, a click toggles the menu's shown/hidden state
          if (this.state.isMenuExpanded) {
            this.hideMenuOnLeave();
          } else {
            this.showMenuOnHover();
          }
        }
      });
    }
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    if (!this.ballElement) return;

    // Hover effects
    this.setupHoverEffects();

    // Set up menu hover events
    this.setupMenuHoverEvents();

    // Click event (with double-click handling and debouncing)
    this.bindEventListener(this.ballElement, 'click', (e) => {
      if (!this.state.isDragging) {
        e.preventDefault();
        e.stopPropagation();
        this.handleClickWithDebounce();
      }
    });

    // Touch event handling - passive: false lets us prevent default behavior when needed
    // but only prevent default when truly necessary, so the rest of the page can still scroll
    this.bindEventListener(
      this.ballElement,
      'touchstart',
      this.handleTouchStart.bind(this),
      { passive: false },
    );
    this.bindEventListener(
      document,
      'touchmove',
      this.handleTouchMove.bind(this),
      { passive: false },
    );
    this.bindEventListener(
      document,
      'touchend',
      this.handleTouchEnd.bind(this),
      { passive: false },
    );

    // Also register mouse events as a fallback (with device detection)
    this.bindEventListener(
      this.ballElement,
      'mousedown',
      this.handleMouseDown.bind(this),
    );
    this.bindEventListener(
      document,
      'mousemove',
      this.handleMouseMove.bind(this),
    );
    this.bindEventListener(document, 'mouseup', this.handleMouseUp.bind(this));
  }

  /**
   * Click handling with debouncing
   */
  private handleClickWithDebounce(): void {
    const currentTime = Date.now();
    const timeDiff = currentTime - this.lastClickTime;

    // Detect double-click (second click within 300ms)
    if (timeDiff < 300) {
      // Double-click: cancel the previous timer and do not translate
      if (this.clickDebounceTimer) {
        clearTimeout(this.clickDebounceTimer);
        this.clickDebounceTimer = null;
      }

      if (this.menuHoverTimer) {
        clearTimeout(this.menuHoverTimer);
        this.menuHoverTimer = null;
      }
      return;
    }

    this.lastClickTime = currentTime;

    // Clear the previous timer
    if (this.clickDebounceTimer) {
      clearTimeout(this.clickDebounceTimer);
    }

    // Set a new timer to translate after 100ms (guards against rapid clicks)
    this.clickDebounceTimer = window.setTimeout(() => {
      this.handleTranslate();
      this.clickDebounceTimer = null;
    }, 100);
  }

  /**
   * Handle translation
   */
  private handleTranslate(): void {
    if (this.onTranslateCallback && this.ballElement) {
      this.onTranslateCallback();

      // Show translation animation
      const { activeBackground, background } = FLOATING_BALL_STYLES;
      this.ballElement.style.background = activeBackground;

      setTimeout(() => {
        if (this.ballElement) {
          this.ballElement.style.background = background;
        }
      }, 1000);
    }
  }

  /**
   * Mouse down handling (enhanced event control)
   */
  private handleMouseDown(e: MouseEvent): void {
    // Prevent duplicate handling on touch devices
    if (this.isTouchDevice && e.target && 'ontouchstart' in e.target) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    this.state.isDragging = false;
    this.dragStartY = e.clientY;

    // Record the current actual position (pixel value)
    if (this.ballElement) {
      const rect = this.ballElement.getBoundingClientRect();
      this.ballStartY = rect.top + rect.height / 2; // actual Y coordinate of the ball center
    }

    // Disable transition animation to avoid interference while dragging
    if (this.ballElement) {
      this.ballElement.style.transition = 'none';
    }
  }

  /**
   * Mouse move handling (enhanced event filtering to avoid conflicts with text selection)
   */
  private handleMouseMove(e: MouseEvent): void {
    // Key fix: only handle move events when the floating ball was explicitly pressed
    if (
      !this.ballElement ||
      (!this.state.isDragging && this.dragStartY === 0)
    ) {
      return;
    }

    // Check mouse button state (the left button must be pressed)
    if (e.buttons !== 1) {
      return;
    }

    // Avoid text selection conflicts: check for an active text selection
    const selection = window.getSelection();
    if (
      selection &&
      selection.toString().length > 0 &&
      !this.state.isDragging
    ) {
      // If a text selection exists and dragging has not started, ignore this event
      return;
    }

    // Validate event source: ensure it relates to the initial interaction with the floating ball
    if (this.dragStartY === 0) {
      // No valid drag start point, ignore the event
      return;
    }

    // Calculate the move distance and start dragging if it exceeds the threshold
    const deltaY = Math.abs(e.clientY - this.dragStartY);
    if (deltaY > DRAG_CONFIG.threshold) {
      this.state.isDragging = true;
    }

    // If dragging, update the position
    if (this.state.isDragging) {
      e.preventDefault();
      e.stopPropagation();

      // Fix coordinate system issue: ensure position calculation is viewport-based, not page-based
      const currentY = e.clientY; // clientY is already relative to the viewport
      const windowHeight = window.innerHeight;
      const ballSize = FLOATING_BALL_STYLES.size;

      // Calculate the new ball center position (viewport coordinates)
      const moveY = currentY - this.dragStartY;
      const newPixelY = this.ballStartY + moveY;

      // Ensure the ball does not leave the visible area
      const minPixelY = ballSize / 2;
      const maxPixelY = windowHeight - ballSize / 2;
      const clampedPixelY = Math.max(minPixelY, Math.min(maxPixelY, newPixelY));

      // Convert to percentage (based on ball center and viewport height)
      const newPositionPercent = (clampedPixelY / windowHeight) * 100;

      // Clamp again to the configured range
      const finalPosition = Math.max(
        DRAG_CONFIG.minPosition,
        Math.min(DRAG_CONFIG.maxPosition, newPositionPercent),
      );

      // Validate position
      if (this.isValidPosition(finalPosition)) {
        this.config.position = finalPosition;
        this.state.currentPosition = finalPosition;
        this.ballElement.style.top = `${finalPosition}%`;
      }
    }
  }

  /**
   * Check whether the position is valid
   */
  private isValidPosition(position: number): boolean {
    return (
      typeof position === 'number' &&
      !isNaN(position) &&
      position >= 0 &&
      position <= 100
    );
  }

  /**
   * Mouse up handling (improved state management, avoids text selection conflicts)
   */
  private handleMouseUp(e: MouseEvent): void {
    // Prevent duplicate handling on touch devices
    if (this.isTouchDevice && e.target && 'ontouchstart' in e.target) {
      return;
    }

    // Only handle the release event when there is a valid drag start point
    if (this.dragStartY === 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    // Restore transition animation
    if (this.ballElement) {
      this.ballElement.style.transition = FLOATING_BALL_STYLES.transition;
    }

    const wasDragging = this.state.isDragging;

    if (wasDragging) {
      // Final position calibration
      this.calibratePosition();

      // Debounced save of position to storage
      this.debouncedSavePosition();
    }

    // Reset all drag-related state
    this.state.isDragging = false;
    this.dragStartY = 0; // Key: reset the drag start point
    this.ballStartY = 0;

    // If a drag just finished, allow click events after a short delay
    if (wasDragging) {
      // Set a flag to prevent an immediate click
      this.lastClickTime = Date.now();
    }
  }

  /**
   * Touch start handling (independent implementation to avoid conflicts with mouse events)
   */
  private handleTouchStart(e: TouchEvent): void {
    // Ensure this is a touch device with a single touch point
    if (e.touches.length !== 1) return;

    // Check whether the touch point is on the floating ball
    if (this.ballElement) {
      const touch = e.touches[0];
      const ballRect = this.ballElement.getBoundingClientRect();

      // Determine whether the touch point is within the floating ball bounds
      const isTouchOnBall =
        touch.clientX >= ballRect.left &&
        touch.clientX <= ballRect.right &&
        touch.clientY >= ballRect.top &&
        touch.clientY <= ballRect.bottom;

      // Only handle the touch event when the touch point is actually on the floating ball
      if (isTouchOnBall) {
        // Prevent default behavior, but only within the floating ball bounds
        e.preventDefault();
        e.stopPropagation();

        // Record the start position to distinguish a click from a drag
        this.state.isDragging = false;
        this.dragStartY = touch.clientY;
        this.lastClickTime = Date.now(); // Update the click time, used to detect click events

        // Record the current actual position (pixel value)
        const rect = this.ballElement.getBoundingClientRect();
        this.ballStartY = rect.top + rect.height / 2; // actual Y coordinate of the ball center

        // Add visual feedback indicating the draggable state
        this.ballElement.style.transform = 'translateY(-50%) scale(1.05)';

        // Disable transition animation to avoid interference while dragging
        this.ballElement.style.transition = 'none';

        // Show the menu (on touch devices, the menu appears on tap)
        this.showMenuOnHover();
      } else {
        // If the touch point is not on the floating ball, make sure state is reset
        this.dragStartY = 0;
        this.ballStartY = 0;
      }
    }
  }

  /**
   * Touch move handling (independent implementation)
   */
  private handleTouchMove(e: TouchEvent): void {
    if (!this.ballElement || e.touches.length !== 1) return;

    // Only prevent default behavior once we confirm the floating ball is being dragged
    // This lets the rest of the page scroll normally
    if (this.dragStartY !== 0) {
      const touch = e.touches[0];

      // If dragging has started or the move distance exceeds the threshold, set the drag state
      const deltaY = Math.abs(touch.clientY - this.dragStartY);
      // Use a smaller threshold to make dragging more responsive
      const dragThreshold = Math.min(DRAG_CONFIG.threshold, 5);

      if (deltaY > dragThreshold) {
        // Only prevent page default behavior once a floating ball drag is confirmed
        e.preventDefault();
        e.stopPropagation();
        this.state.isDragging = true;
      }

      // Once dragging starts, keep updating the position
      // Use the same position calculation logic as mouse events
      const currentY = touch.clientY;
      const windowHeight = window.innerHeight;
      const ballSize = FLOATING_BALL_STYLES.size;

      // Calculate the new ball center position (viewport coordinates)
      const moveY = currentY - this.dragStartY;
      const newPixelY = this.ballStartY + moveY;

      // Ensure the ball does not leave the visible area
      const minPixelY = ballSize / 2;
      const maxPixelY = windowHeight - ballSize / 2;
      const clampedPixelY = Math.max(minPixelY, Math.min(maxPixelY, newPixelY));

      // Convert to percentage
      const newPositionPercent = (clampedPixelY / windowHeight) * 100;

      // Clamp again to the configured range
      const finalPosition = Math.max(
        DRAG_CONFIG.minPosition,
        Math.min(DRAG_CONFIG.maxPosition, newPositionPercent),
      );

      // Validate position
      if (this.isValidPosition(finalPosition)) {
        this.config.position = finalPosition;
        this.state.currentPosition = finalPosition;
        this.ballElement.style.top = `${finalPosition}%`;
      }
    }
  }

  /**
   * Touch end handling (independent implementation)
   */
  private handleTouchEnd(e: TouchEvent): void {
    // Check whether this is a click/drag on the floating ball
    const touchOnBall = this.dragStartY !== 0;

    if (touchOnBall) {
      e.preventDefault();
      e.stopPropagation();

      // Restore transition animation
      if (this.ballElement) {
        this.ballElement.style.transition = FLOATING_BALL_STYLES.transition;

        // Restore normal size
        this.ballElement.style.transform = 'translateY(-50%) scale(1)';
      }

      const wasDragging = this.state.isDragging;

      // If the floating ball was actually dragged, save the new position
      if (wasDragging) {
        // Final position calibration
        this.calibratePosition();

        // Debounced save of position to storage
        this.debouncedSavePosition();
      } else {
        // If it was not dragged (just a tap), trigger translation
        const currentTime = Date.now();
        const timeDiff = currentTime - this.lastClickTime;

        // A short touch counts as a click and triggers translation
        if (timeDiff < 300) {
          // Simulate a click event
          this.handleTranslate();
        }
      }
    }

    // Always reset the drag state to keep the state machine clean
    this.state.isDragging = false;
    this.dragStartY = 0;
    this.ballStartY = 0;
  }

  /**
   * Debounced save of position
   */
  private debouncedSavePosition(): void {
    if (this.savePositionTimer) {
      clearTimeout(this.savePositionTimer);
    }

    this.savePositionTimer = window.setTimeout(() => {
      this.savePosition();
    }, 300); // 300ms debounce
  }

  /**
   * Save position to storage
   */
  private async savePosition(): Promise<void> {
    try {
      const { StorageService } = await import('../../core/storage');
      const storageService = StorageService.getInstance();
      const settings = await storageService.getUserSettings();
      settings.floatingBall.position = this.config.position;
      await storageService.saveUserSettings(settings);
    } catch (error) {
      console.error('Failed to save floating ball position:', error);
    }
  }

  /**
   * Show the menu on mouse hover or touch
   */
  private showMenuOnHover(): void {
    // Clear the hide timer
    if (this.menuHoverTimer) {
      clearTimeout(this.menuHoverTimer);
      this.menuHoverTimer = null;
    }

    // Show the menu immediately
    if (!this.state.isMenuExpanded) {
      this.state.isMenuExpanded = true;

      // Ensure the menu position is correct
      this.updateMenuStyle();

      // On touch devices, close the menu automatically after a delay
      if (this.isTouchDevice) {
        this.menuHoverTimer = window.setTimeout(() => {
          this.hideMenuOnLeave();
          this.menuHoverTimer = null;
        }, 3000); // auto-close after 3 seconds
      }
    }
  }

  /**
   * Hide the menu when the mouse leaves (with delay)
   */
  private hideMenuOnLeave(): void {
    // Clear the previous timer
    if (this.menuHoverTimer) {
      clearTimeout(this.menuHoverTimer);
    }

    // Hide the menu after 300ms to give the user time to move onto it
    this.menuHoverTimer = window.setTimeout(() => {
      if (this.state.isMenuExpanded) {
        this.state.isMenuExpanded = false;
        this.updateMenuStyle();
      }
      this.menuHoverTimer = null;
    }, 300);
  }

  /**
   * Handle menu actions
   */
  private handleMenuAction(action: FloatingBallActionType): void {
    // Clear the hover timer
    if (this.menuHoverTimer) {
      clearTimeout(this.menuHoverTimer);
      this.menuHoverTimer = null;
    }

    // Close the menu first
    this.state.isMenuExpanded = false;
    this.updateMenuStyle();

    switch (action) {
      case 'translate':
        this.handleTranslate();
        break;

      case 'settings':
        this.openSettings();
        break;

      case 'close':
        this.closeBall();
        break;
      case 'options':
        this.openOptions();
        break;
      default:
        console.warn('Unknown menu action:', action);
    }
  }

  /**
   * Open the settings page
   */
  private openSettings(): void {
    try {
      // Open the popup via the extension API
      browser.runtime.sendMessage({ type: 'open-popup' });
    } catch (error) {
      console.error('Failed to open settings:', error);
    }
  }

  /**
   * Open the options page
   */
  private openOptions(): void {
    try {
      browser.runtime.sendMessage({ type: 'open-options' });
    } catch (error) {
      console.error('Failed to open options:', error);
    }
  }

  /**
   * Close the floating ball
   */
  private closeBall(): void {
    // Clear all timers
    if (this.menuHoverTimer) {
      clearTimeout(this.menuHoverTimer);
      this.menuHoverTimer = null;
    }
    if (this.clickDebounceTimer) {
      clearTimeout(this.clickDebounceTimer);
      this.clickDebounceTimer = null;
    }

    // Collapse the menu (it stays usable if the ball is shown again)
    this.state.isMenuExpanded = false;
    this.updateMenuStyle();

    // Hide the element
    this.state.isVisible = false;
    if (this.ballElement) {
      this.ballElement.style.display = 'none';
    }
  }

  /**
   * Get the current state
   */
  getState(): FloatingBallState {
    return { ...this.state };
  }

  /**
   * Update the translation state indicator
   *
   * Provides a smooth visual transition:
   * 1. Floating ball shrinks (0.1s)
   * 2. Update the icon and tooltip text
   * 3. Floating ball returns to size (0.1s)
   *
   * Performance optimizations:
   * - Use requestAnimationFrame to keep animation smooth
   * - Update all changed properties at once
   */
  updateTranslationStateIndicator(): void {
    if (!this.ballElement) return;

    // Start the scale animation
    this.startTransitionAnimation();

    // Delay the content update to create a smooth transition
    setTimeout(() => {
      this.updateBallContent();
      this.updateMenuItemPositions(); // Sync panel state
      this.endTransitionAnimation();
    }, 100);
  }

  /**
   * Start the transition animation
   * @private
   */
  private startTransitionAnimation(): void {
    if (!this.ballElement) return;

    this.ballElement.style.transition = 'transform 0.2s ease-out';
    this.ballElement.style.transform = 'translateY(-50%) scale(0.8)';
  }

  /**
   * Update floating ball content
   * @private
   */
  private updateBallContent(): void {
    if (!this.ballElement) return;

    // Update the icon - using the safe HTML setter
    safeSetInnerHTML(this.ballElement, this.createBallIcon());

    // Update tooltip text
    this.updateTooltipText();
  }

  /**
   * End the transition animation
   * @private
   */
  private endTransitionAnimation(): void {
    if (!this.ballElement) return;

    this.ballElement.style.transform = 'translateY(-50%) scale(1)';
  }

  /**
   * Update tooltip text
   * @private
   */
  private updateTooltipText(): void {
    if (!this.ballElement) return;

    // Check translation state
    const hasTranslatedContent = this.hasTranslatedContent();
    const isTranslationHidden = document.body.classList.contains(
      'wxt-translation-hidden',
    );

    // Determine tooltip text
    let modeText;
    if (!hasTranslatedContent) {
      modeText = 'Ready to translate';
    } else if (isTranslationHidden) {
      modeText = 'Original mode';
    } else {
      modeText = 'Translation mode';
    }

    this.ballElement.title = `${modeText}`;
  }

  private hasTranslatedContent(): boolean {
    return (
      document.querySelector('.wxt-translation-term') !== null ||
      document.querySelector('.illa-paragraph-translation') !== null
    );
  }

  /**
   * Destroy the floating ball (full resource cleanup)
   */
  destroy(): void {
    this.teardown();
    this.onTranslateCallback = undefined;
  }

  /**
   * Remove the floating ball DOM, listeners and timers while keeping the
   * configuration and translate callback, so it can be re-created later.
   */
  private teardown(): void {
    // Remove the floating ball element
    if (this.ballElement) {
      this.ballElement.remove();
      this.ballElement = null;
    }

    // Remove the menu container
    if (this.menuContainer) {
      this.menuContainer.remove();
      this.menuContainer = null;
    }

    if (this.rootHost) {
      this.rootHost.remove();
      this.rootHost = null;
      this.uiRoot = null;
    }

    // Remove all event listeners
    this.removeAllEventListeners();

    // Clear all timers
    if (this.savePositionTimer) {
      clearTimeout(this.savePositionTimer);
      this.savePositionTimer = null;
    }

    if (this.clickDebounceTimer) {
      clearTimeout(this.clickDebounceTimer);
      this.clickDebounceTimer = null;
    }

    if (this.menuHoverTimer) {
      clearTimeout(this.menuHoverTimer);
      this.menuHoverTimer = null;
    }

    // Reset state
    this.state = {
      isDragging: false,
      isVisible: false,
      isMenuExpanded: false,
      currentPosition: 50,
    };

    // Reset other properties
    this.dragStartY = 0;
    this.ballStartY = 0;
    this.lastClickTime = 0;
  }
}
