/**
 * Background service type definitions
 */

import { UserSettings } from '../shared/types/storage';

// ================================
// Message type definitions
// ================================

export interface ShowNotificationMessage {
  type: 'show-notification';
  options: chrome.notifications.NotificationOptions;
}

export interface OpenPopupMessage {
  type: 'open-popup';
}

export interface OpenOptionsMessage {
  type: 'open-options';
}

export interface ValidateConfigurationMessage {
  type: 'validate-configuration';
  source: 'user_action' | 'page_load';
}

export interface ApiRequestMessage {
  type: 'api-request';
  data: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    /** Per-attempt timeout in ms; omitted = proxy default, 0 = unlimited (capped) */
    timeout?: number;
    /** Id of the requesting document's lifetime port (aborted on disconnect) */
    clientId?: string;
  };
}

export interface TranslatePageMessage {
  type: 'translate-page-command';
}

export interface SettingsUpdatedMessage {
  type: 'settings_updated';
  settings: UserSettings;
}

export interface ApiConfigUpdatedMessage {
  type: 'api_config_updated';
  settings: UserSettings;
}

export interface ManualTranslateMessage {
  type: 'MANUAL_TRANSLATE';
}

export type BackgroundMessage =
  | ShowNotificationMessage
  | OpenPopupMessage
  | OpenOptionsMessage
  | ValidateConfigurationMessage
  | ApiRequestMessage
  | TranslatePageMessage
  | SettingsUpdatedMessage
  | ApiConfigUpdatedMessage
  | ManualTranslateMessage;

// ================================
// API response type definitions
// ================================

export interface ApiSuccessResponse {
  success: true;
  data: any;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    status?: number;
    statusText?: string;
    /** Failure kind: upstream HTTP error, timeout, cancellation or network error */
    code?: 'http' | 'timeout' | 'aborted' | 'network';
    /** Server-requested retry delay in ms (Retry-After), if any */
    retryAfter?: number;
  };
}

export type ApiResponse = ApiSuccessResponse | ApiErrorResponse;

// ================================
// Notification types
// ================================

export interface NotificationConfig {
  type: 'basic' | 'image' | 'list' | 'progress';
  title: string;
  message: string;
  iconUrl?: string;
  imageUrl?: string;
  priority?: number;
}

export interface ApiConfigNotificationOptions {
  source: 'user_action' | 'page_load';
  title: string;
  message: string;
  iconUrl: string;
}

// ================================
// Command types
// ================================

export type ExtensionCommand = 'translate-page';

export interface CommandHandlerResult {
  success: boolean;
  error?: string;
}

// ================================
// Initialization types
// ================================

export interface InitializationConfig {
  shouldCreateMenus: boolean;
  shouldInitializeStorage: boolean;
  shouldInitializeContextMenu: boolean;
}

export interface InitializationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

// ================================
// Context menu types
// ================================

export interface ContextMenuItemConfig {
  id: string;
  title: string;
  type?: 'normal' | 'checkbox' | 'radio' | 'separator';
  parentId?: string;
  contexts: chrome.contextMenus.ContextType[];
  visible?: boolean;
  enabled?: boolean;
}

export interface ContextMenuStructure {
  items: ContextMenuItemConfig[];
}

// ================================
// Config validation types
// ================================

export interface ConfigValidationResult {
  isValid: boolean;
  activeConfig?: {
    id: string;
    protocolFamily: string;
    hasApiKey: boolean;
  };
  errors: string[];
}

// ================================
// Service config types
// ================================

export interface NotificationServiceConfig {
  defaultIconUrl: string;
  defaultTimeout: number;
  sessionStorageKey: string;
}

export interface ApiProxyServiceConfig {
  /** Per-attempt timeout when the caller does not specify one (ms) */
  defaultTimeout: number;
  /** Safety ceiling used when the caller asks for "unlimited" (0) (ms) */
  unlimitedTimeoutCeiling: number;
  /** Retries after the first attempt (408/429/5xx only) */
  maxRetries: number;
  /** Base delay of the exponential backoff (ms) */
  retryDelay: number;
  /** Upper bound of a computed backoff delay (ms) */
  maxRetryDelay: number;
  /** A longer Retry-After gives up instead of waiting (ms) */
  maxRetryAfter: number;
  /** Global cap on concurrent upstream requests across all tabs */
  maxConcurrentRequests: number;
}

export interface CommandServiceConfig {
  enabledCommands: ExtensionCommand[];
  requiresValidation: boolean;
}

export interface BackgroundServiceConfig {
  notification: NotificationServiceConfig;
  apiProxy: ApiProxyServiceConfig;
  command: CommandServiceConfig;
  initialization: InitializationConfig;
}

// ================================
// Error type definitions
// ================================

export class BackgroundServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: any,
  ) {
    super(message);
    this.name = 'BackgroundServiceError';
  }
}

export class ApiProxyError extends BackgroundServiceError {
  constructor(message: string, context?: any) {
    super(message, 'API_PROXY_ERROR', context);
    this.name = 'ApiProxyError';
  }
}

export class NotificationError extends BackgroundServiceError {
  constructor(message: string, context?: any) {
    super(message, 'NOTIFICATION_ERROR', context);
    this.name = 'NotificationError';
  }
}

export class ConfigurationError extends BackgroundServiceError {
  constructor(message: string, context?: any) {
    super(message, 'CONFIGURATION_ERROR', context);
    this.name = 'ConfigurationError';
  }
}

// ================================
// Constants
// ================================

export const BACKGROUND_CONSTANTS = {
  NOTIFICATION_TIMEOUT: 5000,
  API_REQUEST_TIMEOUT: 30000,
  API_UNLIMITED_TIMEOUT_CEILING: 300000,
  API_CLIENT_PORT_PREFIX: 'illa-api-client:',
  SESSION_KEY_API_NOTIFICATION: 'apiKeyNotificationShown',
  MENU_PARENT_ID: 'illa-website-management',
  WARNING_ICON_PATH: '/warning.png',
  OPTIONS_PATH: '/options.html',
  POPUP_PATH: '/popup.html',
} as const;

export const MESSAGE_TYPES = {
  SHOW_NOTIFICATION: 'show-notification',
  OPEN_POPUP: 'open-popup',
  OPEN_OPTIONS: 'open-options',
  VALIDATE_CONFIG: 'validate-configuration',
  API_REQUEST: 'api-request',
  TRANSLATE_PAGE: 'translate-page-command',
  SETTINGS_UPDATED: 'settings_updated',
  API_CONFIG_UPDATED: 'api_config_updated',
  MANUAL_TRANSLATE: 'MANUAL_TRANSLATE',
} as const;

export const EXTENSION_COMMANDS = {
  TRANSLATE_PAGE: 'translate-page',
} as const;
