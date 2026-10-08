/**
 * Command service - handles extension commands
 */

import { browser } from 'wxt/browser';
import { StorageService } from '../../core/storage';
import {
  ExtensionCommand,
  CommandHandlerResult,
  CommandServiceConfig,
  ConfigValidationResult,
  EXTENSION_COMMANDS,
} from '../types';

export class CommandService {
  private static instance: CommandService | null = null;
  private config: CommandServiceConfig;
  private storageService: StorageService;

  private constructor() {
    this.config = {
      enabledCommands: ['translate-page'],
      requiresValidation: true,
    };
    this.storageService = StorageService.getInstance();
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): CommandService {
    if (!CommandService.instance) {
      CommandService.instance = new CommandService();
    }
    return CommandService.instance;
  }

  /**
   * Initialize the command listener
   */
  public initialize(): void {
    browser.commands.onCommand.addListener(this.handleCommand.bind(this));
    console.log('[CommandService] Command listener initialized');
  }

  /**
   * Handle extension commands
   */
  private async handleCommand(command: string): Promise<void> {
    console.log(`[CommandService] Received command: ${command}`);

    if (!this.isCommandEnabled(command as ExtensionCommand)) {
      console.warn(`[CommandService] Command not enabled: ${command}`);
      return;
    }

    try {
      const result = await this.executeCommand(command as ExtensionCommand);
      if (!result.success && result.error) {
        console.error(
          `[CommandService] Command execution failed: ${result.error}`,
        );
      }
    } catch (error) {
      console.error(`[CommandService] Command execution error:`, error);
    }
  }

  /**
   * Execute a specific command
   */
  private async executeCommand(
    command: ExtensionCommand,
  ): Promise<CommandHandlerResult> {
    switch (command) {
      case EXTENSION_COMMANDS.TRANSLATE_PAGE:
        return this.handleTranslatePageCommand();
      default:
        return {
          success: false,
          error: `Unknown command: ${command}`,
        };
    }
  }

  /**
   * Handle the translate-page command
   */
  private async handleTranslatePageCommand(): Promise<CommandHandlerResult> {
    try {
      // Validate the API configuration
      if (this.config.requiresValidation) {
        const validation = await this.validateApiConfiguration();
        if (!validation.isValid) {
          return {
            success: false,
            error: 'Invalid API configuration',
          };
        }
      }

      // Get the current active tab
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tabs[0]?.id) {
        return {
          success: false,
          error: 'Unable to get the current tab',
        };
      }

      // Send the translate command to the content script
      await browser.tabs.sendMessage(tabs[0].id, {
        type: 'translate-page-command',
      });
      return {
        success: true,
      };
    } catch (error) {
      console.error('[CommandService] Translate-page command failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Validate the API configuration
   */
  private async validateApiConfiguration(): Promise<ConfigValidationResult> {
    try {
      const settings = await this.storageService.getUserSettings();

      // Check the active config in the multi-config system
      const activeConfig = settings.apiConfigs?.find(
        (config) => config.id === settings.activeApiConfigId,
      );

      const isValid = !!activeConfig?.config?.apiKey;

      if (!isValid) {
        return {
          isValid: false,
          errors: ['API key is not set'],
        };
      }

      return {
        isValid: true,
        activeConfig: {
          id: activeConfig.id,
          protocolFamily: activeConfig.protocolFamily,
          hasApiKey: !!activeConfig.config.apiKey,
        },
        errors: [],
      };
    } catch (error) {
      console.error('[CommandService] Config validation failed:', error);
      return {
        isValid: false,
        errors: ['An error occurred during config validation'],
      };
    }
  }

  /**
   * Check whether a command is enabled
   */
  private isCommandEnabled(command: ExtensionCommand): boolean {
    return this.config.enabledCommands.includes(command);
  }

  /**
   * Enable a command
   */
  public enableCommand(command: ExtensionCommand): void {
    if (!this.config.enabledCommands.includes(command)) {
      this.config.enabledCommands.push(command);
      console.log(`[CommandService] Command enabled: ${command}`);
    }
  }

  /**
   * Disable a command
   */
  public disableCommand(command: ExtensionCommand): void {
    const index = this.config.enabledCommands.indexOf(command);
    if (index > -1) {
      this.config.enabledCommands.splice(index, 1);
      console.log(`[CommandService] Command disabled: ${command}`);
    }
  }

  /**
   * Get the list of enabled commands
   */
  public getEnabledCommands(): ExtensionCommand[] {
    return [...this.config.enabledCommands];
  }

  /**
   * Set whether validation is required
   */
  public setRequiresValidation(requiresValidation: boolean): void {
    this.config.requiresValidation = requiresValidation;
    console.log(
      `[CommandService] Validation requirement set to: ${requiresValidation}`,
    );
  }

  /**
   * Manually execute a command (for use by other services)
   */
  public async executeManualCommand(
    command: ExtensionCommand,
  ): Promise<CommandHandlerResult> {
    console.log(`[CommandService] Manually executing command: ${command}`);

    if (!this.isCommandEnabled(command)) {
      return {
        success: false,
        error: `Command not enabled: ${command}`,
      };
    }

    return this.executeCommand(command);
  }

  /**
   * Get the list of available commands
   */
  public getAvailableCommands(): ExtensionCommand[] {
    return Object.values(EXTENSION_COMMANDS) as ExtensionCommand[];
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<CommandServiceConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
    console.log('[CommandService] Config updated:', this.config);
  }

  /**
   * Get the current configuration
   */
  public getConfig(): CommandServiceConfig {
    return { ...this.config };
  }

  /**
   * Get command statistics
   */
  public getCommandStats(): {
    enabledCommands: number;
    totalCommands: number;
    requiresValidation: boolean;
  } {
    return {
      enabledCommands: this.config.enabledCommands.length,
      totalCommands: this.getAvailableCommands().length,
      requiresValidation: this.config.requiresValidation,
    };
  }

  /**
   * Destroy the service
   */
  public destroy(): void {
    // The Chrome extensions API provides no way to remove listeners
    // Only the instance is cleaned up here
    console.log('[CommandService] Service destroyed');
    CommandService.instance = null;
  }
}
