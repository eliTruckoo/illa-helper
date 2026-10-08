/**
 * Floating ball feature type definitions
 */

// Floating ball config interface
export interface FloatingBallConfig {
  enabled: boolean; // Whether the floating ball is enabled
  position: number; // Vertical position percentage (0-100)
  opacity: number; // Opacity (0.1-1.0)
}

// Floating ball event type
export type FloatingBallEventType = 'translate' | 'drag' | 'click' | 'menu';

// Floating ball action type
export type FloatingBallActionType =
  | 'translate' // Trigger translation
  | 'settings' // Open settings
  | 'close' // Close floating ball
  | 'toggle_menu' // Toggle menu
  | 'options'; // Open options

// Floating ball state
export interface FloatingBallState {
  isDragging: boolean;
  isVisible: boolean;
  isMenuExpanded: boolean; // Added: whether the menu is expanded
  currentPosition: number;
}
