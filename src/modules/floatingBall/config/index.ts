/**
 * Floating ball configuration
 */

import type { FloatingBallConfig } from '../../shared/types/ui';

// Default floating ball configuration
export const DEFAULT_FLOATING_BALL_CONFIG: FloatingBallConfig = {
  enabled: true,
  position: 50, // Middle position
  opacity: 0.8, // 80% opacity
};

// Floating ball style configuration - custom blue theme
export const FLOATING_BALL_STYLES = {
  size: 34, // Floating ball size (px)
  iconSize: 20, // Icon size (px)
  borderRadius: '50%', // Circular
  zIndex: 10000, // Stacking level
  right: '0px', // Stick to the right edge
  // Primary color: custom blue
  background: '#6A88E0',
  // Hover: brighter blue
  hoverBackground: '#7B96E5',
  // Active: red
  activeBackground: '#AA466E',
  // Main shadow
  boxShadow: '0 4px 12px rgba(106, 136, 224, 0.25)',
  // Hover shadow
  hoverBoxShadow: '0 6px 16px rgba(106, 136, 224, 0.35)',
  // Active shadow
  activeBoxShadow: '0 6px 16px rgba(76, 175, 80, 0.3)',
  transition: 'all 0.2s ease',
  hoverScale: 1.05,
};

// Menu style configuration
export const MENU_STYLES = {
  itemSize: 30, // Menu item size (px) - slightly smaller
  itemIconSize: 16, // Menu item icon size (px)
  expandRadius: 0, // No circular radius needed for vertical layout
  itemSpacing: 8, // Menu item spacing (px) - vertical spacing
  background: 'rgba(106, 136, 224, 0.15)', // Semi-transparent theme-color background
  hoverBackground: 'rgba(106, 136, 224, 0.25)', // Increase opacity on hover
  border: '1px solid rgba(106, 136, 224, 0.2)', // Semi-transparent theme-color border
  boxShadow:
    '0 8px 24px rgba(106, 136, 224, 0.2), 0 4px 8px rgba(0, 0, 0, 0.1)', // Double shadow
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  zIndex: 9999,
};

// Drag configuration
export const DRAG_CONFIG = {
  threshold: 5, // Drag trigger threshold (px)
  minPosition: 5, // Minimum position (%)
  maxPosition: 95, // Maximum position (%)
  animationDuration: 300, // Animation duration (ms)
};

// Menu action configuration - uses SVG icons
export const MENU_ACTIONS = [
  {
    id: 'translate',
    label: 'Translate',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>',
    color: '#6A88E0',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h10"/><path d="M7 12h10"/><path d="M7 17h10"/></svg>',
    color: '#6A88E0',
  },
  {
    id: 'options',
    label: 'Options',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    color: '#6A88E0',
  },
  {
    id: 'close',
    label: 'Close',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
    color: '#EF4444',
  },
] as const;
