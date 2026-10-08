/**
 * Background Script - uses a modern service architecture
 */

import { browser } from 'wxt/browser';
import { StorageService } from '@/src/modules/core/storage';
import { NotificationService } from '@/src/modules/background/services/NotificationService';
import {
  ApiProxyService,
  ApiRequestSender,
} from '@/src/modules/background/services/ApiProxyService';
import { CommandService } from '@/src/modules/background/services/CommandService';
import { InitializationService } from '@/src/modules/background/services/InitializationService';
import { UpdateCheckService } from '@/src/modules/background/services/UpdateCheckService';
import {
  MESSAGE_TYPES,
  BACKGROUND_CONSTANTS,
} from '@/src/modules/background/types';
import { MessageType } from '@/src/modules/core/messaging/types';

export default defineBackground(() => {
  // Service instances
  const storageService = StorageService.getInstance();
  const notificationService = NotificationService.getInstance();
  const apiProxyService = ApiProxyService.getInstance();
  const commandService = CommandService.getInstance();
  const initializationService = InitializationService.getInstance();
  const updateCheckService = UpdateCheckService.getInstance();

  // Legacy managers removed - now managed uniformly in InitializationService

  // Register context menu / tab listeners synchronously on every start, so
  // they survive MV3 service worker restarts (not only after onInstalled)
  initializationService.registerEventListeners();

  // Abort in-flight API requests whose tab or document went away
  apiProxyService.registerLifecycleListeners();

  /**
   * Initialize all services
   */
  async function initializeServices(): Promise<void> {
    try {
      // Initialize command service
      commandService.initialize();

      // Initialize update check service
      await updateCheckService.init();

      console.log('[Background] All services initialized');
    } catch (error) {
      console.error('[Background] Service initialization failed:', error);
    }
  }

  /**
   * Handle extension install event
   */
  browser.runtime.onInstalled.addListener(async (details) => {
    try {
      const result = await initializationService.handleInstallation(details);

      if (result.success) {
        console.log('[Background] Install handled successfully');
        if (result.warnings.length > 0) {
          console.warn('[Background] Install warnings:', result.warnings);
        }
      } else {
        console.error('[Background] Install handling failed:', result.errors);
      }
    } catch (error) {
      console.error('[Background] Install handling error:', error);
    }
  });

  /**
   * Handle runtime messages
   */
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(`[Background] Received message: ${message.type}`);

    switch (message.type) {
      case MESSAGE_TYPES.SHOW_NOTIFICATION:
        handleShowNotification(message);
        return false;

      case MESSAGE_TYPES.OPEN_POPUP:
        handleOpenPopup();
        return false;

      case MESSAGE_TYPES.OPEN_OPTIONS:
        handleOpenOptions();
        return false;

      case MESSAGE_TYPES.VALIDATE_CONFIG:
        handleValidateConfiguration(message, sendResponse);
        return true; // Keep the message channel open

      case MESSAGE_TYPES.API_REQUEST:
        handleApiRequest(message, sender, sendResponse);
        return true; // Keep the message channel open

      case MessageType.CONTEXT_MENU_ACTION:
        handleContextMenuAction(message, sendResponse);
        return true; // Keep the message channel open

      // Handle update-check related messages
      case 'CHECK_UPDATE':
      case 'CLEAR_UPDATE_BADGE':
      case 'DISMISS_UPDATE':
      case 'GET_UPDATE_INFO':
        handleUpdateMessage(message, sendResponse);
        return true; // Keep the message channel open

      default:
        console.warn(`[Background] Unknown message type: ${message.type}`);
        return false;
    }
  });

  /**
   * Handle show-notification message
   */
  async function handleShowNotification(message: any): Promise<void> {
    try {
      await notificationService.showNotification({
        type: 'basic',
        title: message.options.title || 'Notification',
        message: message.options.message || '',
        iconUrl: message.options.iconUrl,
      });
    } catch (error) {
      console.error('[Background] Failed to show notification:', error);
    }
  }

  /**
   * Handle open-popup message
   */
  async function handleOpenPopup(): Promise<void> {
    try {
      browser.action.openPopup();
    } catch (error) {
      console.error('[Background] Unable to open popup:', error);
      // Fall back to opening the options page
      const optionsUrl = browser.runtime.getURL(
        BACKGROUND_CONSTANTS.OPTIONS_PATH,
      );
      browser.tabs.create({ url: optionsUrl });
    }
  }

  /**
   * Handle open-options-page message
   */
  async function handleOpenOptions(): Promise<void> {
    const optionsUrl = browser.runtime.getURL(
      BACKGROUND_CONSTANTS.OPTIONS_PATH,
    );
    browser.tabs.create({ url: optionsUrl });
  }

  /**
   * Handle validate-config message
   */
  function handleValidateConfiguration(
    message: any,
    sendResponse: (response: boolean) => void,
  ): void {
    (async () => {
      try {
        const settings = await storageService.getUserSettings();

        // Check the active config in the multi-config system
        const activeConfig = settings.apiConfigs?.find(
          (config) => config.id === settings.activeApiConfigId,
        );
        const isConfigValid = !!activeConfig?.config?.apiKey;

        if (isConfigValid) {
          sendResponse(true);
          return;
        }

        // Show a notification when the config is invalid
        await notificationService.showApiConfigError(message.source);
        sendResponse(false);
      } catch (error) {
        console.error('[Background] Config validation failed:', error);
        sendResponse(false);
      }
    })();
  }

  /**
   * Handle API request message
   */
  function handleApiRequest(
    message: any,
    sender: ApiRequestSender,
    sendResponse: (response: any) => void,
  ): void {
    (async () => {
      try {
        const response = await apiProxyService.handleApiRequest(
          message,
          sender,
        );
        sendResponse(response);
      } catch (error) {
        console.error('[Background] API request handling failed:', error);
        sendResponse({
          success: false,
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    })();
  }

  /**
   * Handle context menu action message
   */
  function handleContextMenuAction(
    message: any,
    sendResponse: (response: any) => void,
  ): void {
    (async () => {
      try {
        console.log('[Background] Handling context menu action:', message.data);

        // Get the ContextMenuManager instance via InitializationService
        // Return success for now, since the actual handling logic is already in ContextMenuManager
        sendResponse({
          success: true,
          message: 'Context menu action handled',
        });
      } catch (error) {
        console.error(
          '[Background] Context menu action handling failed:',
          error,
        );
        sendResponse({
          success: false,
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    })();
  }

  /**
   * Handle update-check related messages
   */
  function handleUpdateMessage(
    message: any,
    sendResponse: (response: any) => void,
  ): void {
    (async () => {
      try {
        const handled = await updateCheckService.handleMessage(
          message,
          sendResponse,
        );
        if (!handled) {
          sendResponse({
            success: false,
            error: { message: 'Unknown update message type' },
          });
        }
      } catch (error) {
        console.error('[Background] Update message handling failed:', error);
        sendResponse({
          success: false,
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    })();
  }

  // Initialize services
  initializeServices();
});
