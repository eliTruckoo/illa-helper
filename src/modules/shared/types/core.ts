/**
 * Core base type definitions
 * Basic enums and core types used across the project
 */

// User language level enum - CEFR standard
export enum UserLevel {
  A1 = 1, // Beginner
  A2 = 2, // Elementary
  B1 = 3, // Intermediate
  B2 = 4, // Upper intermediate
  C1 = 5, // Advanced
  C2 = 6, // Proficient
}

/**
 * UserLevel option config, including CEFR standard and specific guidance
 */
export const USER_LEVEL_OPTIONS = [
  {
    value: UserLevel.A1,
    label: 'A1',
  },
  {
    value: UserLevel.A2,
    label: 'A2',
  },
  {
    value: UserLevel.B1,
    label: 'B1',
  },
  {
    value: UserLevel.B2,
    label: 'B2',
  },
  {
    value: UserLevel.C1,
    label: 'C1',
  },
  {
    value: UserLevel.C2,
    label: 'C2',
  },
];

// Translation style enum
export enum TranslationStyle {
  DEFAULT = 'default',
  SUBTLE = 'subtle',
  BOLD = 'bold',
  ITALIC = 'italic',
  UNDERLINED = 'underlined',
  HIGHLIGHTED = 'highlighted',
  DOTTED = 'dotted',
  LEARNING = 'learning',
  CUSTOM = 'custom',
}

// Trigger mode enum
export enum TriggerMode {
  AUTOMATIC = 'automatic',
  MANUAL = 'manual',
}

// Original text display mode enum
export enum OriginalWordDisplayMode {
  VISIBLE,
  LEARNING,
  HIDDEN,
}

// Translation position enum
export enum TranslationPosition {
  BEFORE = 'before',
  AFTER = 'after',
}

// Translation mode enum
export enum TranslationMode {
  WORD = 'word', // Word/phrase translation mode (current)
  PARAGRAPH = 'paragraph', // Paragraph translation mode (new)
}

// Context menu action types
export type ContextMenuActionType =
  | 'add-to-blacklist'
  | 'add-to-whitelist'
  | 'remove-from-blacklist'
  | 'remove-from-whitelist';

// URL pattern types
export type UrlPatternType = 'domain' | 'exact';

// Lazy loading config interface - simplified
export interface LazyLoadingConfig {
  /** Whether lazy loading is enabled */
  enabled: boolean;
  /** Preload distance (viewport percentage, 0.5 means half a screen ahead) */
  preloadDistance: number;
}
