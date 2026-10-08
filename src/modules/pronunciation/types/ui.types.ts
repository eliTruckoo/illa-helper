/**
 * UI type definitions
 */

import { PhoneticInfo } from './phonetic.types';

// Pronunciation element data
export interface PronunciationElementData {
  word: string;
  element: HTMLElement;
  phonetic?: PhoneticInfo;
  tooltip?: HTMLElement;
  isMouseOver?: boolean; // whether the mouse is over the element
  originalText?: string; // Added: original text info, stores the original word before translation
}

// Tooltip type
export type TooltipType = 'phrase' | 'word';

// Tooltip state
export interface TooltipState {
  visible: boolean;
  element: HTMLElement | null;
  type: TooltipType;
}

// Interaction event types
export type InteractionEventType = 'mouseenter' | 'mouseleave' | 'click';

// Interaction event handler
export interface InteractionEventHandler {
  type: InteractionEventType;
  handler: (event: Event) => void;
}
