/**
 * Notification service - handles all extension notifications
 */

import { browser } from 'wxt/browser';
import {
  NotificationConfig,
  NotificationServiceConfig,
  NotificationError,
  BACKGROUND_CONSTANTS,
} from '../types';

export class NotificationService {
  private static instance: NotificationService | null = null;
  private config: NotificationServiceConfig;

  private constructor() {
    this.config = {
      defaultIconUrl: BACKGROUND_CONSTANTS.WARNING_ICON_PATH,
      defaultTimeout: BACKGROUND_CONSTANTS.NOTIFICATION_TIMEOUT,
      sessionStorageKey: BACKGROUND_CONSTANTS.SESSION_KEY_API_NOTIFICATION,
    };
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Show a basic notification
   */
  public async showNotification(
    notificationConfig: NotificationConfig,
  ): Promise<string> {
    try {
      const notificationId = await browser.notifications.create({
        type: 'basic',
        iconUrl:
          notificationConfig.iconUrl || browser.runtime.getURL('/warning.png'),
        title: notificationConfig.title,
        message: notificationConfig.message,
      });
      return notificationId || '';
    } catch (error) {
      console.error('Failed to create notification:', error);
      throw new NotificationError(
        `Failed to create notification: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { notificationConfig },
      );
    }
  }

  /**
   * Show API configuration error notification
   */
  public async showApiConfigError(
    source: 'user_action' | 'page_load',
  ): Promise<void> {
    const notificationConfig: NotificationConfig = {
      type: 'basic',
      title: '[Elilla Assistant] API configuration error',
      message:
        'API key is not set. Click the extension icon to open the settings page and configure it.',
      iconUrl: browser.runtime.getURL('/warning.png'),
    };

    try {
      if (source === 'user_action') {
        await this.showNotification(notificationConfig);
      } else {
        const hasShown = await this.hasShownSessionNotification();
        if (!hasShown) {
          await this.showNotification(notificationConfig);
          await this.markSessionNotificationShown();
        }
      }
    } catch (error) {
      console.error(
        'Failed to show API configuration error notification:',
        error,
      );
      throw error;
    }
  }

  /**
   * Show a success notification
   */
  public async showSuccessNotification(
    title: string,
    message: string,
    iconUrl?: string,
  ): Promise<string> {
    return this.showNotification({
      type: 'basic',
      title,
      message,
      iconUrl: iconUrl || browser.runtime.getURL('/icon/48.png'),
    });
  }

  /**
   * Show an error notification
   */
  public async showErrorNotification(
    title: string,
    message: string,
    error?: Error,
  ): Promise<string> {
    return this.showNotification({
      type: 'basic',
      title,
      message: error ? `${message}: ${error.message}` : message,
      iconUrl: browser.runtime.getURL('/warning.png'),
    });
  }

  /**
   * Show a warning notification
   */
  public async showWarningNotification(
    title: string,
    message: string,
  ): Promise<string> {
    const config: NotificationConfig = {
      type: 'basic',
      title,
      message,
      iconUrl: browser.runtime.getURL('/warning.png'),
      priority: 1,
    };

    return this.showNotification(config);
  }

  /**
   * Show a notification with progress
   */
  public async showProgressNotification(
    title: string,
    message: string,
    progress: number,
  ): Promise<string> {
    const options = {
      type: 'progress' as chrome.notifications.TemplateType,
      title,
      message,
      iconUrl: browser.runtime.getURL('/icon/48.png'),
      priority: 1,
      progress: Math.max(0, Math.min(100, progress)), // ensure progress is between 0 and 100
    } as chrome.notifications.NotificationCreateOptions;

    try {
      const notificationId = await browser.notifications.create(options);
      console.log(
        `Progress notification created: ${notificationId}, progress: ${progress}%`,
      );
      return notificationId || '';
    } catch (error) {
      console.error('Failed to create progress notification:', error);
      throw new NotificationError(
        `Failed to create progress notification: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { title, message, progress },
      );
    }
  }

  /**
   * Update progress notification
   */
  public async updateProgressNotification(
    notificationId: string,
    progress: number,
    message?: string,
  ): Promise<void> {
    try {
      const updateOptions: chrome.notifications.NotificationOptions = {
        progress: Math.max(0, Math.min(100, progress)),
      };

      if (message) {
        updateOptions.message = message;
      }

      await browser.notifications.update(notificationId, updateOptions);
      console.log(
        `Progress notification updated: ${notificationId}, progress: ${progress}%`,
      );
    } catch (error) {
      console.error('Failed to update progress notification:', error);
      throw new NotificationError(
        `Failed to update progress notification: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { notificationId, progress, message },
      );
    }
  }

  /**
   * Clear notification
   */
  public async clearNotification(notificationId: string): Promise<void> {
    try {
      await browser.notifications.clear(notificationId);
      console.log(`Notification cleared: ${notificationId}`);
    } catch (error) {
      console.error('Failed to clear notification:', error);
      throw new NotificationError(
        `Failed to clear notification: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { notificationId },
      );
    }
  }

  /**
   * Clear all notifications
   */
  public async clearAllNotifications(): Promise<void> {
    try {
      const notifications = await browser.notifications.getAll();
      const clearPromises = Object.keys(notifications).map((id) =>
        this.clearNotification(id),
      );
      await Promise.all(clearPromises);
      console.log('All notifications cleared');
    } catch (error) {
      console.error('Failed to clear all notifications:', error);
      throw new NotificationError(
        `Failed to clear all notifications: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Check whether the session notification has been shown
   */
  private async hasShownSessionNotification(): Promise<boolean> {
    try {
      const result = await browser.storage.session.get(
        this.config.sessionStorageKey,
      );
      return !!result[this.config.sessionStorageKey];
    } catch (error) {
      console.error('Failed to check session notification state:', error);
      return false;
    }
  }

  /**
   * Mark the session notification as shown
   */
  private async markSessionNotificationShown(): Promise<void> {
    try {
      await browser.storage.session.set({
        [this.config.sessionStorageKey]: true,
      });
    } catch (error) {
      console.error('Failed to mark session notification state:', error);
    }
  }

  /**
   * Reset session notification state
   */
  public async resetSessionNotificationStatus(): Promise<void> {
    try {
      await browser.storage.session.remove(this.config.sessionStorageKey);
    } catch (error) {
      console.error('Failed to reset session notification state:', error);
    }
  }

  /**
   * Set up notification click listener
   */
  public setNotificationClickListener(
    callback: (notificationId: string) => void,
  ): void {
    browser.notifications.onClicked.addListener(callback);
  }

  /**
   * Set up notification button click listener
   */
  public setNotificationButtonClickListener(
    callback: (notificationId: string, buttonIndex: number) => void,
  ): void {
    if (browser.notifications.onButtonClicked) {
      browser.notifications.onButtonClicked.addListener(callback);
    }
  }

  /**
   * Set up notification close listener
   */
  public setNotificationCloseListener(
    callback: (notificationId: string, byUser: boolean) => void,
  ): void {
    browser.notifications.onClosed.addListener(callback);
  }

  /**
   * Update config
   */
  public updateConfig(newConfig: Partial<NotificationServiceConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current config
   */
  public getConfig(): NotificationServiceConfig {
    return { ...this.config };
  }

  /**
   * Verify notification permission
   */
  public async checkNotificationPermission(): Promise<boolean> {
    try {
      // Extensions have notification permission by default, but check to make sure it is available
      return browser.notifications !== undefined;
    } catch (error) {
      console.error('Failed to check notification permission:', error);
      return false;
    }
  }

  /**
   * Destroy the service (clean up resources)
   */
  public destroy(): void {
    // Clean up possible listeners (if any)
    console.log('Notification service destroyed');
    NotificationService.instance = null;
  }
}
