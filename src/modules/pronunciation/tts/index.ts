/**
 * Unified exports for the TTS module
 * Includes the TTS interface, implementations and factory
 */

export { ITTSProvider, TTSProviderConfig } from './ITTSProvider';
export type { TTSResult } from '../types';
export { WebSpeechTTSProvider } from './WebSpeechTTSProvider';
export { YoudaoTTSProvider } from './YoudaoTTSProvider';
export { TTSProviderFactory } from './TTSProviderFactory';
