/**
 * Messaging service entry point
 * Exports all messaging-related functionality
 */

// Service class exports
export {
  default as MessagingService,
  messagingService,
} from './MessagingService';

// Type definition exports
export type {
  MessagingServiceConfig,
  MessageSendResult,
  TabQueryOptions,
  MessageSendOptions,
  MessageListener,
  Message,
  BaseMessage,
  SettingsUpdateMessage,
  WebsiteManagementUpdateMessage,
  ContextMenuActionMessage,
  NotificationMessage,
  ErrorMessage,
  UserSettings,
  ContextMenuMessage,
  ContextMenuActionType,
  UrlPatternType,
} from './types';

export { MessageType } from './types';

// Default export
export { messagingService as default } from './MessagingService';
