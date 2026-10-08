/**
 * Context menu manager
 * Manages browser context menu state updates; no longer creates or deletes menu items dynamically
 */

import { browser } from 'wxt/browser';

import { WebsiteManager } from '../options/website-management/manager';
import {
  extractDomain,
  generateDomainPattern,
  generateExactPattern,
  generateRuleDescription,
  validateUrlForRule,
} from '../options/website-management/utils';
import type {
  ContextMenuActionType,
  UrlPatternType,
} from '../shared/types/core';
import { createDebouncedTask } from '@/src/utils/debounce';
import {
  MenuState,
  computeMenuState,
  diffMenuState,
  hiddenMenuState,
} from './menuState';

/** Debounce of menu refreshes triggered by tab/navigation events */
const MENU_REFRESH_DEBOUNCE_MS = 150;
/** Storage key of the website rules (see WebsiteManager) */
const WEBSITE_RULES_STORAGE_KEY = 'website-management-settings';

export class ContextMenuManager {
  private websiteManager: WebsiteManager;
  private listenersRegistered = false;
  /** Last state applied via contextMenus.update(), per menu item */
  private appliedState: MenuState = {};
  /** Tab whose URL the menu currently reflects */
  private activeTabId?: number;
  private refreshTask = createDebouncedTask(() => {
    void this.refreshActiveTab();
  }, MENU_REFRESH_DEBOUNCE_MS);

  constructor(websiteManager: WebsiteManager) {
    this.websiteManager = websiteManager;
  }

  /**
   * Register the menu click, tab and navigation listeners.
   *
   * Must be called synchronously at background startup (not only from
   * runtime.onInstalled): an MV3 service worker restarted by one of these
   * events only dispatches it to listeners registered in its first turn.
   * Idempotent.
   */
  registerListeners(): void {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    browser.contextMenus.onClicked.addListener(this.handleMenuClick.bind(this));
    browser.tabs.onUpdated.addListener(this.handleTabUpdate.bind(this));
    browser.tabs.onActivated.addListener(this.handleTabActivated.bind(this));
    browser.windows?.onFocusChanged?.addListener(
      this.handleWindowFocusChanged.bind(this),
    );
    // Main-frame navigations (redirects, reloads) of the active tab
    browser.webNavigation?.onCommitted?.addListener(
      this.handleNavigation.bind(this),
    );
    // Rules changed elsewhere (options page, popup, other menu action)
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes[WEBSITE_RULES_STORAGE_KEY]) {
        this.websiteManager.clearCache();
        this.scheduleRefresh();
      }
    });
  }

  /**
   * Initialize the menu manager after the menu items were (re)created.
   */
  async init(): Promise<void> {
    try {
      this.registerListeners();

      // Menu items were just recreated with their default state
      this.appliedState = {};
      this.refreshTask.cancel();
      await this.refreshActiveTab();
    } catch (error) {
      console.error('Failed to initialize menu manager:', error);
    }
  }

  /**
   * Request a (debounced) refresh of the menu for the active tab
   */
  private scheduleRefresh(): void {
    this.refreshTask.schedule();
  }

  /**
   * Update the menu for the active tab of the last focused window
   */
  private async refreshActiveTab(): Promise<void> {
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (tab?.id === undefined) return;
      this.activeTabId = tab.id;
      await this.updateMenuState(tab.id, tab.url ?? '');
    } catch (error) {
      console.error('[ContextMenu] Failed to refresh menu state:', error);
    }
  }

  /**
   * Update menu state
   */
  private async updateMenuState(tabId: number, url: string): Promise<void> {
    if (!url || !url.startsWith('http')) {
      await this.applyMenuState(hiddenMenuState());
      return;
    }

    // Validate URL
    const validation = validateUrlForRule(url);
    if (!validation.valid) {
      await this.applyMenuState(hiddenMenuState());
      return;
    }

    const domain = extractDomain(url);
    let websiteStatus: 'blacklisted' | 'whitelisted' | 'normal';
    try {
      websiteStatus = await this.websiteManager.getWebsiteStatus(url);
    } catch (error) {
      console.error('[ContextMenu] Failed to get website status:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        url,
        tabId,
      });
      try {
        // Retry once before hiding the menu
        websiteStatus = await this.websiteManager.getWebsiteStatus(url);
      } catch (retryError) {
        console.error(
          '[ContextMenu] Retry failed, hiding all menus:',
          retryError,
        );
        await this.applyMenuState(hiddenMenuState());
        return;
      }
    }

    await this.applyMenuState(computeMenuState(websiteStatus, domain));
  }

  /**
   * Apply a menu state, calling contextMenus.update() only for items whose
   * visibility or title actually changed.
   */
  private async applyMenuState(desired: MenuState): Promise<void> {
    for (const [menuId, next] of diffMenuState(this.appliedState, desired)) {
      try {
        await browser.contextMenus.update(menuId, next);
        this.appliedState[menuId] = {
          visible: next.visible,
          title: next.title ?? this.appliedState[menuId]?.title,
        };
      } catch (error) {
        // Unknown state now: force an update next time
        delete this.appliedState[menuId];
        console.error('Failed to update menu visibility:', error);
      }
    }
  }

  /**
   * Handle menu click events
   */
  private async handleMenuClick(info: any, tab: any): Promise<void> {
    console.log(
      `[ContextMenu] Menu click event - MenuID: ${info.menuItemId}, URL: ${tab?.url}`,
    );

    if (!tab?.url) {
      console.warn('[ContextMenu] Missing tab URL information');
      this.showNotification(
        'Operation failed',
        'Unable to get current page information',
      );
      return;
    }

    try {
      const url = tab.url;
      const domain = extractDomain(url);

      // Verify the current URL matches the URL when the menu was shown
      console.log(
        `[ContextMenu] Handling right-clicked page - URL: ${url}, Domain: ${domain}`,
      );

      // Parse menu ID
      if (info.menuItemId === 'illa-open-settings') {
        console.log('[ContextMenu] Opening settings page');
        const optionsUrl = browser.runtime.getURL(
          '/options.html#website-management',
        );
        await browser.tabs.create({ url: optionsUrl });
        return;
      }

      // Handle add/remove actions
      if (typeof info.menuItemId === 'string') {
        console.log(
          `[ContextMenu] Handling menu action - Action: ${info.menuItemId}, Domain: ${domain}`,
        );
        await this.processMenuAction(info.menuItemId, url, domain);
      }
    } catch (error) {
      console.error('[ContextMenu] Failed to handle menu click:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        menuItemId: info.menuItemId,
        url: tab?.url,
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.showNotification(
        'Operation failed',
        'An error occurred while handling the menu action',
      );
    }
  }

  /**
   * Handle menu action
   */
  private async processMenuAction(
    menuItemId: string,
    url: string,
    domain: string,
  ): Promise<void> {
    let action: ContextMenuActionType;
    let patternType: UrlPatternType;
    let pattern: string;

    // Parse menu ID
    if (menuItemId.includes('add-blacklist-domain')) {
      action = 'add-to-blacklist';
      patternType = 'domain';
      pattern = generateDomainPattern(domain);
    } else if (menuItemId.includes('add-blacklist-exact')) {
      action = 'add-to-blacklist';
      patternType = 'exact';
      pattern = generateExactPattern(url);
    } else if (menuItemId.includes('add-whitelist-domain')) {
      action = 'add-to-whitelist';
      patternType = 'domain';
      pattern = generateDomainPattern(domain);
    } else if (menuItemId.includes('add-whitelist-exact')) {
      action = 'add-to-whitelist';
      patternType = 'exact';
      pattern = generateExactPattern(url);
    } else if (menuItemId.includes('remove-blacklist')) {
      action = 'remove-from-blacklist';
      patternType = 'domain';
      pattern = generateDomainPattern(domain);
    } else if (menuItemId.includes('remove-whitelist')) {
      action = 'remove-from-whitelist';
      patternType = 'domain';
      pattern = generateDomainPattern(domain);
    } else {
      return; // Unknown menu item
    }

    // Execute action
    await this.executeAction(action, pattern, patternType, url);
  }

  /**
   * Execute website management action
   */
  private async executeAction(
    action: ContextMenuActionType,
    pattern: string,
    patternType: UrlPatternType,
    url: string,
  ): Promise<void> {
    console.log(
      `[ContextMenu] Executing action - Action: ${action}, Pattern: ${pattern}, Type: ${patternType}`,
    );

    try {
      const type = action.includes('blacklist') ? 'blacklist' : 'whitelist';
      const description = generateRuleDescription(pattern, type);

      if (action.startsWith('add-to-')) {
        // Add rule
        console.log(
          `[ContextMenu] Adding rule - Type: ${type}, Pattern: ${pattern}`,
        );
        await this.websiteManager.addRule(pattern, type, description);

        const actionText = type === 'blacklist' ? 'blacklist' : 'whitelist';
        const patternText = patternType === 'domain' ? 'website' : 'page';
        this.showNotification(
          'Rule added',
          `Added the ${patternText} to the ${actionText}`,
        );
      } else if (action.startsWith('remove-from-')) {
        // Remove rule: find matching rules and delete them
        console.log(
          `[ContextMenu] Removing rule - Type: ${type}, Pattern: ${pattern}`,
        );
        const rules = await this.websiteManager.getRulesByType(type);
        const domain = extractDomain(url);
        const domainPattern = generateDomainPattern(domain);

        // Find matching rules: the domain menu only removes the current domain rule.
        const matchingRules = rules.filter((rule) => {
          return rule.pattern === pattern || rule.pattern === domainPattern;
        });

        console.log(
          `[ContextMenu] Found matching rules - Count: ${matchingRules.length}`,
        );

        for (const rule of matchingRules) {
          await this.websiteManager.removeRule(rule.id);
        }

        const actionText = type === 'blacklist' ? 'blacklist' : 'whitelist';
        const patternText =
          matchingRules.length > 0 ? 'related rules' : 'matching rules';
        this.showNotification(
          'Rule removed',
          `Removed ${patternText} from the ${actionText}`,
        );
      }

      // Refresh menu state after the action completes
      console.log('[ContextMenu] Action complete, refreshing menu state');
      this.refreshTask.cancel();
      await this.refreshActiveTab();
    } catch (error) {
      console.error('[ContextMenu] Failed to execute action:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        action,
        pattern,
        patternType,
        url,
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.showNotification(
        'Operation failed',
        'An error occurred while executing the action',
      );
    }
  }

  /**
   * Show notification
   */
  private showNotification(title: string, message: string): void {
    browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/48.png'),
      title: title,
      message: message,
    });
  }

  /**
   * Handle tab update events.
   * Only URL changes and load completion of the active tab matter; title
   * changes (and any change in background tabs) are ignored.
   */
  private handleTabUpdate(
    tabId: number,
    changeInfo: { url?: string; status?: string },
    tab: { active?: boolean },
  ): void {
    if (!tab.active) return;
    if (changeInfo.url || changeInfo.status === 'complete') {
      this.scheduleRefresh();
    }
  }

  /**
   * Handle tab activation events
   */
  private handleTabActivated(activeInfo: { tabId: number }): void {
    this.activeTabId = activeInfo.tabId;
    this.scheduleRefresh();
  }

  /**
   * Handle window focus changes (the active tab differs per window)
   */
  private handleWindowFocusChanged(windowId: number): void {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    this.scheduleRefresh();
  }

  /**
   * Handle main-frame navigation events of the active tab
   */
  private handleNavigation(details: { frameId: number; tabId: number }): void {
    if (details.frameId !== 0) return;
    // Unknown active tab (fresh service worker): let the refresh find out
    if (this.activeTabId !== undefined && details.tabId !== this.activeTabId)
      return;
    this.scheduleRefresh();
  }
}
