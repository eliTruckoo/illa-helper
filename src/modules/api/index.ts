/**
 * API module unified exports
 */

// Types and interfaces
export { ITranslationProvider } from './types';

// Factories and services
export { ApiServiceFactory } from './factory/ApiServiceFactory';
export {
  UniversalApiService,
  universalApi,
  callAI,
  quickAI,
  type UniversalApiOptions,
  type UniversalApiResult,
} from './services/UniversalApiService';

// Providers
export { GoogleGeminiProvider, OpenAIProvider } from './providers';

// Base classes
export { BaseProvider } from './base/BaseProvider';

// Utility functions
export {
  mergeCustomParams,
  createErrorResponse,
  validateInputs,
} from './utils/apiUtils';
export { addPositionsToReplacements } from './utils/textUtils';
export { sendApiRequest } from './utils/requestUtils';
