/**
 * Messaging service
 * Handles communication between parts of the extension: tab messages, background script communication, context menu actions
 *
 * Features:
 * - Tab message sending
 * - Background script communication
 * - Context menu action handling
 * - Message listening and routing
 * - Error handling and retry mechanism
 */

import { browser } from 'wxt/browser';
import { UserSettings, ContextMenuMessage } from '../../shared/types/storage';
import { ContextMenuActionType, UrlPatternType } from '../../shared/types/core';
import {
  MessagingServiceConfig,
  MessageSendResult,
  TabQueryOptions,
  MessageSendOptions,
  MessageListener,
  MessageType,
  Message,
  SettingsUpdateMessage,
  WebsiteManagementUpdateMessage,
  ContextMenuActionMessage,
  NotificationMessage,
} from './types';

// ==================== Messaging Service Class ====================

/**
 * Messaging service
 * Singleton that provides unified messaging
 */
export class MessagingService {
  private static instance: MessagingService;

  // Configuration and state
  private readonly config: MessagingServiceConfig;
  private messageListeners: Map<string, MessageListener[]> = new Map();
  private messageHistory: Message[] = [];
  private maxHistorySize = 100;

  /**
   * Private constructor to prevent external instantiation
   */
  private constructor(config: MessagingServiceConfig = {}) {
    this.config = {
      enableLogging: true,
      defaultTimeout: 5000,
      maxRetries: 3,
      enableBroadcast: false,
      ...config,
    };
  }

  /**
   * Get the service instance
   * @param config Optional service configuration
   * @returns MessagingService instance
   */
  public static getInstance(config?: MessagingServiceConfig): MessagingService {
    if (!MessagingService.instance) {
      MessagingService.instance = new MessagingService(config);
    }
    return MessagingService.instance;
  }

  // ==================== Message Listener Management ====================

  /**
   * Add a message listener
   * @param messageType Message type
   * @param listener Listener function
   */
  public addMessageListener(
    messageType: string,
    listener: MessageListener,
  ): void {
    if (!this.messageListeners.has(messageType)) {
      this.messageListeners.set(messageType, []);
    }
    this.messageListeners.get(messageType)!.push(listener);
  }

  /**
   * Remove a message listener
   * @param messageType Message type
   * @param listener Listener function
   */
  public removeMessageListener(
    messageType: string,
    listener: MessageListener,
  ): void {
    const listeners = this.messageListeners.get(messageType);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Handle a received message
   * @param message Message object
   * @param sender Sender info
   */
  private async handleMessage(message: Message, sender?: any): Promise<any> {
    this.addToHistory(message);

    if (this.config.enableLogging) {
      console.log(
        '[MessagingService] Received message:',
        message.type,
        message,
      );
    }

    const listeners = this.messageListeners.get(message.type);
    if (listeners && listeners.length > 0) {
      const results = await Promise.allSettled(
        listeners.map((listener) => listener(message, sender)),
      );

      // Handle listener results
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(
            `[MessagingService] Listener ${index} failed:`,
            result.reason,
          );
        }
      });

      return results[0].status === 'fulfilled' ? results[0].value : undefined;
    }
  }

  /**
   * Add a message to history
   * @param message Message object
   */
  private addToHistory(message: Message): void {
    message.timestamp = Date.now();
    message.id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.messageHistory.push(message);

    // Enforce the history size limit
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }
  }

  // ==================== Tab Communication ====================

  /**
   * Query tabs
   * @param options Query options
   * @returns Array of tabs
   */
  private async queryTabs(options: TabQueryOptions = {}): Promise<any[]> {
    try {
      return await browser.tabs.query({
        active: true,
        currentWindow: true,
        ...options,
      });
    } catch (error) {
      console.error('[MessagingService] Failed to query tabs:', error);
      return [];
    }
  }

  /**
   * Send a message to a tab
   * @param tabId Tab ID
   * @param message Message object
   * @param options Send options
   * @returns Send result
   */
  public async sendToTab(
    tabId: number,
    message: Message,
    options: MessageSendOptions = {},
  ): Promise<MessageSendResult> {
    try {
      const response = await browser.tabs.sendMessage(tabId, message);

      if (this.config.enableLogging) {
        console.log(
          '[MessagingService] Sent to tab successfully:',
          tabId,
          message.type,
        );
      }

      return { success: true, response };
    } catch (error) {
      const errorMessage = `Failed to send message to tab ${tabId}: ${error}`;
      console.error('[MessagingService]', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Broadcast a message to all active tabs
   * @param message Message object
   * @param options Send options
   * @returns Array of send results
   */
  public async broadcastToTabs(
    message: Message,
    options: MessageSendOptions = {},
  ): Promise<MessageSendResult[]> {
    const tabs = await this.queryTabs();
    const results: MessageSendResult[] = [];

    for (const tab of tabs) {
      if (tab.id) {
        const result = await this.sendToTab(tab.id, message, options);
        results.push(result);
      }
    }

    return results;
  }

  // ==================== Runtime Communication ====================

  /**
   * Send a message to the runtime (background script)
   * @param message Message object
   * @param options Send options
   * @returns Send result
   */
  public async sendToRuntime(
    message: Message,
    options: MessageSendOptions = {},
  ): Promise<MessageSendResult> {
    try {
      const response = await browser.runtime.sendMessage(message);

      if (this.config.enableLogging) {
        console.log(
          '[MessagingService] Sent to runtime successfully:',
          message.type,
        );
      }

      return { success: true, response };
    } catch (error) {
      const errorMessage = `Failed to send message to runtime: ${error}`;
      console.error('[MessagingService]', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  // ==================== Advanced Message Methods ====================

  /**
   * Notify that settings were updated
   * @param settings New settings
   * @returns Send result
   */
  public async notifySettingsChanged(
    settings: UserSettings,
  ): Promise<MessageSendResult[]> {
    const message: SettingsUpdateMessage = {
      type: MessageType.SETTINGS_UPDATED,
      settings,
    };

    this.addToHistory(message);

    if (this.config.enableBroadcast) {
      return await this.broadcastToTabs(message);
    } else {
      const tabs = await this.queryTabs({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        const result = await this.sendToTab(tabs[0].id, message);
        return [result];
      }
      return [{ success: false, error: 'No active tabs found' }];
    }
  }

  /**
   * Send a context menu action message to the background script
   * @param action Action type
   * @param url Target URL
   * @param pattern URL pattern
   * @param patternType Pattern type
   * @param description Optional description
   * @returns Send result
   */
  public async sendContextMenuAction(
    action: ContextMenuActionType,
    url: string,
    pattern: string,
    patternType: UrlPatternType,
    description?: string,
  ): Promise<MessageSendResult> {
    const contextMessage: ContextMenuMessage = {
      type: action,
      url,
      pattern,
      patternType,
      description,
    };

    const message: ContextMenuActionMessage = {
      type: MessageType.CONTEXT_MENU_ACTION,
      data: contextMessage,
    };

    return await this.sendToRuntime(message);
  }

  /**
   * Notify that website management settings were updated
   * @returns Array of send results
   */
  public async notifyWebsiteManagementChanged(): Promise<MessageSendResult[]> {
    const message: WebsiteManagementUpdateMessage = {
      type: MessageType.WEBSITE_MANAGEMENT_UPDATED,
    };

    this.addToHistory(message);

    if (this.config.enableBroadcast) {
      return await this.broadcastToTabs(message);
    } else {
      const tabs = await this.queryTabs({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        const result = await this.sendToTab(tabs[0].id, message);
        return [result];
      }
      return [{ success: false, error: 'No active tabs found' }];
    }
  }

  /**
   * Send a notification message
   * @param title Notification title
   * @param message Notification content
   * @param level Notification level
   * @returns Array of send results
   */
  public async sendNotification(
    title: string,
    message: string,
    level: 'info' | 'warning' | 'error' | 'success' = 'info',
  ): Promise<MessageSendResult[]> {
    const notificationMessage: NotificationMessage = {
      type: MessageType.NOTIFICATION,
      title,
      message,
      level,
    };

    this.addToHistory(notificationMessage);
    return await this.broadcastToTabs(notificationMessage);
  }

  // ==================== Utility Methods ====================

  /**
   * Get message history
   * @param limit Maximum number to return
   * @returns Array of message history
   */
  public getMessageHistory(limit?: number): Message[] {
    if (limit && limit > 0) {
      return this.messageHistory.slice(-limit);
    }
    return [...this.messageHistory];
  }

  /**
   * Clear message history
   */
  public clearMessageHistory(): void {
    this.messageHistory = [];
  }

  /**
   * Get service status
   */
  public getStatus() {
    return {
      config: this.config,
      listenerCount: Array.from(this.messageListeners.values()).reduce(
        (sum, listeners) => sum + listeners.length,
        0,
      ),
      historySize: this.messageHistory.length,
      isHealthy: true,
    };
  }
}

// ==================== Exports ====================

// Singleton instance export
export const messagingService = MessagingService.getInstance();

// Default export
export default MessagingService;
