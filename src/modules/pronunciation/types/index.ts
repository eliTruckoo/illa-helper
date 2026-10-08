/**
 * Unified type exports
 */

// Export all types
export * from './phonetic.types';
export * from './tts.types';
export * from './ui.types';

// Convenience imports - phonetics
export type {
  PhoneticInfo,
  PhoneticEntry,
  MeaningEntry,
  DefinitionEntry,
  PhoneticResult,
  CacheEntry,
} from './phonetic.types';

// Convenience imports - TTS
export type {
  TTSResult,
  TTSProviderType,
  TTSProviderStatus,
} from './tts.types';

// Convenience imports - UI
export type {
  PronunciationElementData,
  TooltipType,
  TooltipState,
  InteractionEventType,
  InteractionEventHandler,
} from './ui.types';
