/**
 * UI-related type definitions
 * Includes interfaces for the floating ball, hotkeys, UI configuration, etc.
 */

// Hotkey configuration interface
export interface TooltipHotkey {
  enabled: boolean; // Whether the hotkey requirement is enabled
  modifierKeys: string[]; // Modifier keys array ['ctrl', 'alt', 'shift']
  key?: string; // Optional additional key
  description?: string; // Hotkey description
}

// Floating ball configuration interface
export interface FloatingBallConfig {
  enabled: boolean; // Whether the floating ball is enabled
  position: number; // Vertical position percentage (0-100)
  opacity: number; // Opacity (0.1-1.0)
}
