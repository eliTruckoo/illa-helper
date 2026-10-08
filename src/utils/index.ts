/**
 * UserLevel utilities
 * Provides UserLevel-related helper functions
 */

import {
  UserLevel,
  USER_LEVEL_OPTIONS,
  ApiConfig,
  ApiConfigItem,
  ApiProtocolFamily,
} from '../modules/shared/types';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sendApiRequest } from '../modules/api/utils/requestUtils';

/**
 * Merge custom parameters into the base parameter object
 * @param baseParams Base parameter object
 * @param customParamsJson Custom parameters as a JSON string
 * @returns The merged parameter object
 */
function mergeCustomParams(baseParams: any, customParamsJson?: string): any {
  const merged = { ...baseParams };

  // Protected system-critical parameters that must not be overridden
  const protectedKeys = ['model', 'messages', 'apiKey'];

  if (!customParamsJson?.trim()) {
    return merged;
  }

  try {
    const customParams = JSON.parse(customParamsJson);

    // Merge custom parameters while protecting system-critical ones
    Object.entries(customParams).forEach(([key, value]) => {
      if (!protectedKeys.includes(key)) {
        merged[key] = value;
      } else {
        console.warn(`Ignoring protected parameter: ${key}`);
      }
    });
  } catch (error) {
    console.warn('Failed to parse custom parameters JSON:', error);
  }

  return merged;
}

/**
 * Get the display name of a UserLevel
 * @param level UserLevel enum value
 * @returns The display name
 */
export function getUserLevelLabel(level: UserLevel): string {
  const option = USER_LEVEL_OPTIONS.find((opt) => opt.value === level);
  return option?.label || 'Unknown';
}

/**
 * Get all UserLevel options, for use in dropdowns and similar components
 * @returns Array of UserLevel options
 */
export function getUserLevelOptions() {
  return USER_LEVEL_OPTIONS;
}

/**
 * API test result interface
 */
export interface ApiTestResult {
  success: boolean;
  message?: string;
  model?: string;
}

/**
 * Get the API timeout
 * @param baseTimeout Base timeout in milliseconds
 * @returns Timeout in milliseconds; undefined (no timeout limit) if 0
 */
export function getApiTimeout(baseTimeout: number): number | undefined {
  return baseTimeout === 0 ? undefined : baseTimeout;
}

export async function testGeminiConnection(
  apiConfig: ApiConfig,
  baseTimeout?: number,
): Promise<ApiTestResult> {
  if (!apiConfig.apiKey) {
    return { success: false, message: 'API Key is not configured.' };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiConfig.apiKey);

    const baseGenerationConfig: any = {
      temperature: apiConfig.temperature,
    };

    let generationConfig = mergeCustomParams(
      baseGenerationConfig,
      apiConfig.customParams,
    );

    // Adapt parameters
    generationConfig = mapParamsForProvider(generationConfig, 'gemini');

    const requestOptions: { timeout?: number; baseUrl?: string } = {};
    const timeout = getApiTimeout(baseTimeout || 0);
    if (timeout) {
      requestOptions.timeout = timeout;
    }
    if (apiConfig.apiEndpoint) {
      requestOptions.baseUrl = apiConfig.apiEndpoint;
    }

    const model = genAI.getGenerativeModel(
      {
        model: apiConfig.model,
        generationConfig,
      },
      requestOptions,
    );

    const result = await model.generateContent(
      'Hello, this is a connection test. Please respond with "OK".',
    );
    const response = result.response;
    const text = response.text();

    if (text.includes('OK')) {
      return {
        success: true,
        message: 'Connection successful.',
        model: apiConfig.model,
      };
    } else {
      return { success: false, message: 'Received an unexpected response.' };
    }
  } catch (error: any) {
    console.error('Gemini connection test failed:', error);
    return {
      success: false,
      message: error.message || 'An unknown error occurred.',
    };
  }
}

/**
 * Unified entry point for API connection tests
 * Automatically selects the appropriate test method based on the protocol family
 * @param userConfig User API configuration object
 * @param baseTimeout Timeout in milliseconds
 * @returns Promise<ApiTestResult> The test result
 */
export async function testApiConnection(
  userConfig: ApiConfigItem,
  baseTimeout?: number,
): Promise<ApiTestResult> {
  const { protocolFamily, config } = userConfig;

  switch (protocolFamily) {
    case ApiProtocolFamily.GEMINI:
      return testGeminiConnection(config, baseTimeout);
    case ApiProtocolFamily.OPENAI_COMPATIBLE:
      return testOpenAICompatibleConnection(config, baseTimeout);
    default:
      return {
        success: false,
        message: `Unsupported API protocol family: ${protocolFamily}`,
      };
  }
}

/**
 * Test the connection to an OpenAI-compatible API
 * @param apiConfig API configuration object
 * @param baseTimeout Timeout in milliseconds
 * @returns Promise<ApiTestResult> The test result
 */
export async function testOpenAICompatibleConnection(
  apiConfig: ApiConfig,
  baseTimeout?: number,
): Promise<ApiTestResult> {
  if (!apiConfig.apiKey || !apiConfig.apiEndpoint) {
    return {
      success: false,
      message: 'API Key or Endpoint is not configured.',
    };
  }

  try {
    let requestBody: any = {
      model: apiConfig.model,
      temperature: apiConfig.temperature,
      messages: [
        {
          role: 'user',
          content:
            'Hello, this is a connection test. Please respond with "OK" and output JSON format.',
        },
      ],
      max_tokens: 10,
    };

    // Only add the enable_thinking field when the config allows passing thinking parameters
    if (apiConfig.includeThinkingParam) {
      requestBody.enable_thinking = apiConfig.enable_thinking;
    }

    // Merge custom parameters
    requestBody = mergeCustomParams(requestBody, apiConfig.customParams);

    const response = await sendApiRequest(
      requestBody,
      apiConfig,
      getApiTimeout(baseTimeout || 0) || 0,
    );

    if (response.ok) {
      const data = await response.json();

      return {
        success: true,
        message: `status: ${response.status}`,
        model: data.model || apiConfig.model,
      };
    } else {
      const errorData = await response.json().catch(() => null);
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

      if (errorData?.error?.message) {
        errorMessage = errorData.error.message;
      } else if (errorData?.message) {
        errorMessage = errorData.message;
      }

      return {
        success: false,
        message: errorMessage,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Network connection error',
    };
  }
}

/**
 * Clean Markdown formatting from an AI response
 * @param content Raw content returned by the AI
 * @returns The cleaned JSON string
 */
export function cleanMarkdownFromResponse(content: string): string {
  if (!content || typeof content !== 'string') {
    return content;
  }

  // Remove Markdown code block markers
  let cleaned = content.trim();

  // Remove leading ```json or ```
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');

  // Remove trailing ```
  cleaned = cleaned.replace(/\n?\s*```\s*$/i, '');

  // Remove other possible Markdown formatting
  cleaned = cleaned.replace(/^\s*```[\s\S]*?\n/, ''); // Remove leading code block
  cleaned = cleaned.replace(/\n```\s*$/, ''); // Remove trailing code block

  // Remove any extra whitespace
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Safely set an element's HTML content, avoiding Firefox's innerHTML security warning
 * Uses DOMParser to avoid direct innerHTML assignment
 * @param element Target DOM element
 * @param htmlContent HTML content string
 * @returns Whether the content was set successfully
 */
export function safeSetInnerHTML(
  element: HTMLElement,
  htmlContent: string,
): boolean {
  if (!element || htmlContent == null) {
    return false;
  }

  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(htmlContent, 'text/html');

    // Clear the target element
    element.textContent = '';

    // Move the parsed content into the target element
    const bodyContent = parsed.body;
    if (bodyContent) {
      // Move all child nodes of body into the target element
      while (bodyContent.firstChild) {
        element.appendChild(bodyContent.firstChild);
      }
    }

    return true;
  } catch (error) {
    console.error('Failed to set HTML content:', error);
    return false;
  }
}

/**
 * Extract and parse JSON from a string that may contain a Markdown code block.
 * @param text Raw string containing JSON.
 * @returns The parsed JavaScript object.
 * @throws An error if the JSON is invalid or cannot be extracted.
 */
export function extractAndParseJson(text: string): any {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid input: text must be a non-empty string.');
  }

  // Match a JSON code block in Markdown
  const jsonBlockMatch = text.match(/```(json)?\s*([\s\S]+?)\s*```/);

  let jsonString;
  if (jsonBlockMatch && jsonBlockMatch[2]) {
    // Extract the JSON string from the Markdown code block
    jsonString = jsonBlockMatch[2];
  } else {
    // If no code block is found, assume the whole string is JSON
    // Try to find the content between the first '{' and the last '}'
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonString = text.substring(firstBrace, lastBrace + 1);
    } else {
      jsonString = text; // As a last resort
    }
  }

  try {
    // Clean and parse JSON
    return JSON.parse(jsonString.trim());
  } catch (error) {
    console.error('Failed to parse JSON:', error);
    console.error('Original text:', text);
    console.error('Extracted JSON string:', jsonString);
    throw new Error('The response does not contain valid JSON.');
  }
}

/**
 * Map OpenAI-style parameters to a specific provider's format (e.g. Google Gemini).
 * @param params - Object containing OpenAI-style parameters.
 * @param provider - Identifier of the target provider ('gemini', etc.).
 * @returns Parameter object mapped for the target provider.
 */
export function mapParamsForProvider(params: any, provider: 'gemini'): any {
  if (provider !== 'gemini') {
    return params; // Currently only implemented for Gemini
  }

  const mapping: { [key: string]: string } = {
    max_tokens: 'maxOutputTokens',
    top_p: 'topP',
    stop: 'stopSequences',
    frequency_penalty: 'frequencyPenalty',
    presence_penalty: 'presencePenalty',
  };

  const mappedParams: { [key: string]: any } = {};

  for (const key in params) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const mappedKey = mapping[key] || key;
      mappedParams[mappedKey] = params[key];
    }
  }

  // Special handling for stopSequences: ensure it is a string array
  if (
    mappedParams.stopSequences &&
    !Array.isArray(mappedParams.stopSequences)
  ) {
    mappedParams.stopSequences = [String(mappedParams.stopSequences)];
  }

  return mappedParams;
}
