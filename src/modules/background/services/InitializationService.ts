/**
 * Initialization service - handles initialization on extension install and startup
 */

import { browser } from 'wxt/browser';
import { StorageService } from '../../core/storage';
import { ContextMenuManager } from '../../contextMenu';
import { WebsiteManager } from '../../options/website-management/manager';
import { DEFAULT_SETTINGS } from '../../shared/constants/defaults';
import { InitializationResult, BACKGROUND_CONSTANTS } from '../types';

export class InitializationService {
  private static instance: InitializationService | null = null;
  private storageService: StorageService;
  private contextMenuManager: ContextMenuManager;
  private websiteManager: WebsiteManager;

  private constructor() {
    this.storageService = StorageService.getInstance();
    this.websiteManager = new WebsiteManager();
    this.contextMenuManager = new ContextMenuManager(this.websiteManager);
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): InitializationService {
    if (!InitializationService.instance) {
      InitializationService.instance = new InitializationService();
    }
    return InitializationService.instance;
  }

  /**
   * Register event listeners that must exist on every background start.
   * Call synchronously at top level of the background script: listeners added
   * only from runtime.onInstalled are lost once the MV3 service worker
   * restarts. Idempotent.
   */
  public registerEventListeners(): void {
    this.contextMenuManager.registerListeners();
  }

  /**
   * Handle the extension install event
   */
  public async handleInstallation(
    details: chrome.runtime.InstalledDetails,
  ): Promise<InitializationResult> {
    const result: InitializationResult = {
      success: true,
      errors: [],
      warnings: [],
    };

    try {
      if (details.reason === 'install') {
        await this.performFirstTimeSetup(result);
      }

      await this.initializeMenus(result);
      await this.initializeContextMenu(result);
    } catch (error) {
      result.success = false;
      result.errors.push(
        `Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    return result;
  }

  /**
   * First-install setup
   */
  private async performFirstTimeSetup(
    result: InitializationResult,
  ): Promise<void> {
    try {
      await this.storageService.saveUserSettings(DEFAULT_SETTINGS);
      console.log('Default settings saved');
    } catch (error) {
      result.errors.push('Failed to save default settings' + error);
      // Fallback
      try {
        await browser.storage.sync.set(DEFAULT_SETTINGS);
        result.warnings.push('Used the fallback storage method');
      } catch (error) {
        result.errors.push('Fallback storage method also failed' + error);
      }
    }
  }

  /**
   * Initialize the context menu
   */
  private async initializeMenus(result: InitializationResult): Promise<void> {
    try {
      await this.createContextMenus();
      console.log('Context menu initialized');
    } catch (error) {
      result.errors.push('Failed to initialize context menu' + error);
    }
  }

  /**
   * Initialize the menu manager
   */
  private async initializeContextMenu(
    result: InitializationResult,
  ): Promise<void> {
    try {
      await this.contextMenuManager.init();
      console.log('Menu manager initialized');
    } catch (error) {
      result.errors.push('Failed to initialize menu manager' + error);
    }
  }

  /**
   * Create the context menu structure
   */
  private async createContextMenus(): Promise<void> {
    await browser.contextMenus.removeAll();

    // Main menu item
    await browser.contextMenus.create({
      id: BACKGROUND_CONSTANTS.MENU_PARENT_ID,
      title: 'Elilla Assistant',
      contexts: ['page'],
    });

    // Separator
    await browser.contextMenus.create({
      id: 'illa-separator',
      type: 'separator',
      parentId: BACKGROUND_CONSTANTS.MENU_PARENT_ID,
      contexts: ['page'],
    });

    // Other menu items...
    const menuItems = [
      {
        id: 'illa-add-blacklist-domain',
        title: 'Add domain to blacklist',
        visible: false,
      },
      {
        id: 'illa-add-blacklist-exact',
        title: 'Add current page to blacklist',
        visible: false,
      },
      {
        id: 'illa-remove-blacklist',
        title: 'Remove from blacklist',
        visible: false,
      },
      {
        id: 'illa-add-whitelist-domain',
        title: 'Add domain to whitelist',
        visible: false,
      },
      {
        id: 'illa-add-whitelist-exact',
        title: 'Add current page to whitelist',
        visible: false,
      },
      {
        id: 'illa-remove-whitelist',
        title: 'Remove from whitelist',
        visible: false,
      },
    ];

    for (const item of menuItems) {
      await browser.contextMenus.create({
        id: item.id,
        title: item.title,
        parentId: BACKGROUND_CONSTANTS.MENU_PARENT_ID,
        contexts: ['page'],
        visible: item.visible,
      });
    }

    // Settings separator and settings menu
    await browser.contextMenus.create({
      id: 'illa-settings-separator',
      type: 'separator',
      parentId: BACKGROUND_CONSTANTS.MENU_PARENT_ID,
      contexts: ['page'],
    });

    await browser.contextMenus.create({
      id: 'illa-open-settings',
      title: 'Website management settings',
      parentId: BACKGROUND_CONSTANTS.MENU_PARENT_ID,
      contexts: ['page'],
    });
  }

  /**
   * Destroy the service
   */
  public destroy(): void {
    console.log('[InitializationService] Service destroyed');
    InitializationService.instance = null;
  }
}
