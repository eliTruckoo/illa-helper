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

export class ContextMenuManager {
  private websiteManager: WebsiteManager;

  constructor(websiteManager: WebsiteManager) {
    this.websiteManager = websiteManager;
  }

  /**
   * Initialize the menu manager
   */
  async init(): Promise<void> {
    try {
      // Listen for menu click events
      browser.contextMenus.onClicked.addListener(
        this.handleMenuClick.bind(this),
      );

      // Listen for tab update events and update menu state dynamically
      browser.tabs.onUpdated.addListener(this.handleTabUpdate.bind(this));
      browser.tabs.onActivated.addListener(this.handleTabActivated.bind(this));

      // Listen for navigation events so the menu also updates on SPA route changes
      browser.webNavigation.onCommitted.addListener(
        this.handleNavigation.bind(this),
      );

      // Initialize the menu state for the current tab
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs[0]?.id && tabs[0]?.url) {
        await this.updateMenuState(tabs[0].id, tabs[0].url);
      }
    } catch (error) {
      console.error('Failed to initialize menu manager:', error);
    }
  }

  /**
   * Update menu state
   */
  private async updateMenuState(tabId: number, url: string): Promise<void> {
    console.log(
      `[ContextMenu] Updating menu state - TabID: ${tabId}, URL: ${url}`,
    );

    if (!url || !url.startsWith('http')) {
      console.log(`[ContextMenu] Invalid URL, hiding all menus: ${url}`);
      await this.hideAllDynamicMenus();
      return;
    }

    try {
      // Validate URL
      const validation = validateUrlForRule(url);
      if (!validation.valid) {
        console.log(
          `[ContextMenu] URL validation failed, hiding all menus: ${validation.error || 'unknown reason'}`,
        );
        await this.hideAllDynamicMenus();
        return;
      }

      // Get current website status
      const websiteStatus = await this.websiteManager.getWebsiteStatus(url);
      const domain = extractDomain(url);

      console.log(
        `[ContextMenu] Website status - Domain: ${domain}, Status: ${websiteStatus}`,
      );

      // Update menu visibility and titles based on website status
      await this.updateMenuVisibility(url, domain, websiteStatus);
    } catch (error) {
      console.error('[ContextMenu] Failed to update menu state:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        url,
        tabId,
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Do not hide the menu immediately; retry once first
      try {
        console.log('[ContextMenu] Retrying to get website status...');
        const websiteStatus = await this.websiteManager.getWebsiteStatus(url);
        const domain = extractDomain(url);
        await this.updateMenuVisibility(url, domain, websiteStatus);
      } catch (retryError) {
        console.error(
          '[ContextMenu] Retry failed, hiding all menus:',
          retryError,
        );
        await this.hideAllDynamicMenus();
      }
    }
  }

  /**
   * Update menu visibility based on website status
   */
  private async updateMenuVisibility(
    url: string,
    domain: string,
    websiteStatus: 'blacklisted' | 'whitelisted' | 'normal',
  ): Promise<void> {
    // Hide all dynamic menu items first
    await this.hideAllDynamicMenus();

    try {
      // Show the relevant action options for the current status
      if (websiteStatus === 'blacklisted') {
        // Currently blacklisted: show remove option and add-to-whitelist options
        await browser.contextMenus.update('illa-remove-blacklist', {
          visible: true,
          title: `Remove ${domain} from blacklist`,
        });
        await browser.contextMenus.update('illa-add-whitelist-domain', {
          visible: true,
          title: `Add ${domain} to whitelist`,
        });
        await browser.contextMenus.update('illa-add-whitelist-exact', {
          visible: true,
          title: 'Add current page to whitelist',
        });
      } else if (websiteStatus === 'whitelisted') {
        // Currently whitelisted: show remove option and add-to-blacklist options
        await browser.contextMenus.update('illa-remove-whitelist', {
          visible: true,
          title: `Remove ${domain} from whitelist`,
        });
        await browser.contextMenus.update('illa-add-blacklist-domain', {
          visible: true,
          title: `Add ${domain} to blacklist`,
        });
        await browser.contextMenus.update('illa-add-blacklist-exact', {
          visible: true,
          title: 'Add current page to blacklist',
        });
      } else {
        // Normal status: show add options
        await browser.contextMenus.update('illa-add-blacklist-domain', {
          visible: true,
          title: `Add ${domain} to blacklist`,
        });
        await browser.contextMenus.update('illa-add-blacklist-exact', {
          visible: true,
          title: 'Add current page to blacklist',
        });
        await browser.contextMenus.update('illa-add-whitelist-domain', {
          visible: true,
          title: `Add ${domain} to whitelist`,
        });
        await browser.contextMenus.update('illa-add-whitelist-exact', {
          visible: true,
          title: 'Add current page to whitelist',
        });
      }
    } catch (error) {
      console.error('Failed to update menu visibility:', error);
    }
  }

  /**
   * Hide all dynamic menu items
   */
  private async hideAllDynamicMenus(): Promise<void> {
    const dynamicMenuIds = [
      'illa-add-blacklist-domain',
      'illa-add-blacklist-exact',
      'illa-remove-blacklist',
      'illa-add-whitelist-domain',
      'illa-add-whitelist-exact',
      'illa-remove-whitelist',
    ];

    for (const menuId of dynamicMenuIds) {
      try {
        await browser.contextMenus.update(menuId, { visible: false });
      } catch (error) {
        console.error('Failed to update menu visibility:', error);
        // Ignore update failure errors
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
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs[0]?.id && tabs[0]?.url) {
        await this.updateMenuState(tabs[0].id, tabs[0].url);
      }
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
   * Handle tab update events
   */
  private async handleTabUpdate(
    tabId: number,
    changeInfo: any,
    tab: any,
  ): Promise<void> {
    // Update when the URL changes, loading completes, or the title changes (SPA apps)
    if (
      changeInfo.url ||
      (changeInfo.status === 'complete' && tab.url) ||
      changeInfo.title
    ) {
      console.log(
        `[ContextMenu] Tab updated - TabID: ${tabId}, URL: ${tab.url}, Status: ${changeInfo.status}`,
      );
      await this.updateMenuState(tabId, tab.url!);
    }
  }

  /**
   * Handle tab activation events
   */
  private async handleTabActivated(activeInfo: any): Promise<void> {
    try {
      const tab = await browser.tabs.get(activeInfo.tabId);
      if (tab.url) {
        await this.updateMenuState(activeInfo.tabId, tab.url);
      }
    } catch (error) {
      // Ignore errors from failing to get tab info
      console.error('Failed to handle tab activation event:', error);
    }
  }

  /**
   * Handle navigation events (for SPA apps)
   */
  private async handleNavigation(details: any): Promise<void> {
    // Only handle main-frame navigation events
    if (details.frameId === 0 && details.url) {
      console.log(
        `[ContextMenu] Navigation event - URL: ${details.url}, TabID: ${details.tabId}`,
      );
      await this.updateMenuState(details.tabId, details.url);
    }
  }
}
