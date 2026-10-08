import {
  UserSettings,
  OriginalWordDisplayMode,
  TranslationPosition,
  ReplacementConfig,
} from '@/src/modules/shared/types';
import { StyleManager } from '@/src/modules/styles';
import { TextProcessorService } from '@/src/modules/core/translation/TextProcessorService';
import { TextReplacerService } from '@/src/modules/core/translation/TextReplacerService';
import { ParagraphTranslationService } from '@/src/modules/core/translation/ParagraphTranslationService';
import { FloatingBallManager } from '@/src/modules/floatingBall';
import { LazyLoadingService } from './services/LazyLoadingService';

/**
 * Content Script main service interface
 */
export interface IContentManager {
  init(): Promise<void>;
  destroy(): void;
}

/**
 * Configuration service interface
 */
export interface IConfigurationService {
  getUserSettings(): Promise<UserSettings>;
  createReplacementConfig(
    settings: UserSettings,
    pageLanguage?: string,
  ): ReplacementConfig;
  updateConfiguration(
    settings: UserSettings,
    styleManager: StyleManager,
    textReplacer: TextReplacerService,
    pageLanguage?: string,
  ): void;
}

/**
 * Processing service interface
 */
export interface IProcessingService {
  processPage(): Promise<void>;
  updateSettings(settings: UserSettings): void;
}

/**
 * Listener service interface
 */
export interface IListenerService {
  setupMessageListeners(): void;
  setupDomObserver(): void;
  destroy(): void;
}

/**
 * Service container type
 */
export interface ServiceContainer {
  styleManager: StyleManager;
  textProcessor: TextProcessorService;
  textReplacer: TextReplacerService;
  floatingBallManager: FloatingBallManager;
  lazyLoadingService?: LazyLoadingService;
  paragraphTranslationService: ParagraphTranslationService;
}

/**
 * Processing parameter type
 */
export interface ProcessingParams {
  originalWordDisplayMode: OriginalWordDisplayMode;
  maxLength: number | undefined;
  translationPosition: TranslationPosition;
  showParentheses: boolean;
}
