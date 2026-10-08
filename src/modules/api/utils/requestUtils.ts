/**
 * Request handling utility functions
 */

import { ApiConfig } from '../../shared/types/api';
import { BackgroundProxyResponse } from '../types';

/**
 * Payload of an `api-request` message handled by the background proxy
 */
export interface ProxyRequestData {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Per-attempt timeout in ms; omitted = proxy default, 0 = unlimited */
  timeout?: number;
  /** Lifetime port id of this document (filled in by sendViaBackground) */
  clientId?: string;
}

/** Must match BACKGROUND_CONSTANTS.API_CLIENT_PORT_PREFIX */
const API_CLIENT_PORT_PREFIX = 'illa-api-client:';

let clientId: string | undefined;
let clientPort: { disconnect(): void } | null = null;

/**
 * Lazily open a port to the background that lives as long as this document.
 * When it disconnects (navigation, reload, tab close, frame removal) the
 * background aborts every request sent with this client id.
 */
function ensureClientPort(): string | undefined {
  if (clientPort && clientId) return clientId;
  try {
    if (typeof browser?.runtime?.connect !== 'function') return undefined;
    const id = createClientId();
    const port = browser.runtime.connect({ name: API_CLIENT_PORT_PREFIX + id });
    port.onDisconnect.addListener(() => {
      // Background restarted or we disconnected: reconnect on next request
      if (clientPort === port) {
        clientPort = null;
        clientId = undefined;
      }
    });
    clientPort = port;
    clientId = id;
    return id;
  } catch {
    return undefined;
  }
}

function createClientId(): string {
  try {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall through to the non-crypto id
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Abort every API request this document still has in flight
 * (e.g. when translation is disabled or the content script is torn down).
 */
export function cancelPendingApiRequests(): void {
  const port = clientPort;
  clientPort = null;
  clientId = undefined;
  try {
    port?.disconnect();
  } catch {
    // Port already gone
  }
}

/**
 * Background proxy reply, including the optional transport details the proxy adds
 */
type ProxyReply = BackgroundProxyResponse & {
  error?: {
    /** 'timeout' | 'aborted' | 'network' | 'http' */
    code?: string;
    /** Server-requested retry delay in ms (Retry-After) */
    retryAfter?: number;
  };
};

/**
 * Send an API request.
 * The extension may run in an HTTPS page context, so everything goes through the background script to avoid Mixed Content and CORS divergence.
 */
export async function sendApiRequest(
  requestBody: any,
  apiConfig: ApiConfig,
  timeout?: number,
): Promise<Response> {
  return sendViaBackground({
    url: apiConfig.apiEndpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiConfig.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    timeout,
  });
}

/**
 * Send a request through the background proxy.
 * Always resolves: any transport failure (no listener, service worker restart,
 * closed port, undefined reply) becomes an ok:false Response-like object.
 */
export async function sendViaBackground(
  data: ProxyRequestData,
): Promise<Response> {
  let reply: unknown;
  try {
    // Promise-based API: works on Chrome MV3 and on Firefox's promise-only API
    reply = await browser.runtime.sendMessage({
      type: 'api-request',
      data: { ...data, clientId: ensureClientPort() },
    });
  } catch (error: any) {
    return createProxyErrorResponse(
      500,
      `Background proxy unavailable: ${error?.message || String(error)}`,
    );
  }
  return toProxyResponse(reply);
}

/**
 * Convert a background proxy reply into a Response-like object
 */
export function toProxyResponse(reply: unknown): Response {
  const response = reply as ProxyReply | undefined | null;

  if (!response || typeof response !== 'object') {
    return createProxyErrorResponse(
      500,
      'Background proxy returned no response',
    );
  }

  if (response.success === true) {
    const data = response.data;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: createHeaders(),
      json: async () => data,
      text: async () =>
        typeof data === 'string' ? data : JSON.stringify(data ?? null),
    } as Response;
  }

  const error = response.error || {};
  return createProxyErrorResponse(
    error.status || 500,
    error.statusText || error.message || 'Internal Server Error',
    error,
  );
}

function createProxyErrorResponse(
  status: number,
  statusText: string,
  error: ProxyReply['error'] = { message: statusText },
): Response {
  const body = { error: { ...error, message: error?.message || statusText } };
  return {
    ok: false,
    status,
    statusText,
    headers: createHeaders(error?.retryAfter),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function createHeaders(retryAfterMs?: number): Headers {
  const init: Record<string, string> = {};
  if (typeof retryAfterMs === 'number' && retryAfterMs >= 0) {
    init['retry-after'] = String(Math.ceil(retryAfterMs / 1000));
  }
  return typeof Headers === 'function'
    ? new Headers(init)
    : (init as unknown as Headers);
}

// ================================
// Google Gemini (REST, via the background proxy)
// ================================

/** Default Gemini REST base URL (same as the official SDK) */
export const GEMINI_DEFAULT_BASE_URL =
  'https://generativelanguage.googleapis.com';
const GEMINI_API_VERSION = 'v1beta';

/** Finish reasons for which the SDK's text() throws instead of returning text */
const GEMINI_BLOCKED_FINISH_REASONS = ['RECITATION', 'SAFETY', 'LANGUAGE'];

export interface GeminiGenerateOptions {
  /** Gemini generationConfig (already mapped to Gemini parameter names) */
  generationConfig?: Record<string, any>;
  /** Per-attempt timeout in ms; omitted = proxy default, 0 = unlimited */
  timeout?: number;
}

/**
 * Subset of the SDK's EnhancedGenerateContentResponse used by callers
 */
export interface GeminiContentResponse {
  candidates?: any[];
  promptFeedback?: any;
  usageMetadata?: any;
  /** Text of the first candidate; throws if the response was blocked */
  text(): string;
}

/**
 * Build the generateContent REST request equivalent to
 * `genAI.getGenerativeModel({ model, generationConfig }, { baseUrl }).generateContent(prompt)`
 */
export function buildGeminiRequest(
  apiConfig: ApiConfig,
  prompt: string,
  options: GeminiGenerateOptions = {},
): ProxyRequestData {
  const baseUrl = (
    apiConfig.apiEndpoint?.trim() || GEMINI_DEFAULT_BASE_URL
  ).replace(/\/+$/, '');
  const model = apiConfig.model.includes('/')
    ? apiConfig.model
    : `models/${apiConfig.model}`;

  const body: Record<string, any> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };
  if (options.generationConfig) {
    body.generationConfig = options.generationConfig;
  }

  return {
    url: `${baseUrl}/${GEMINI_API_VERSION}/${model}:generateContent`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiConfig.apiKey,
    },
    body: JSON.stringify(body),
    timeout: options.timeout,
  };
}

/**
 * Wrap a raw generateContent JSON payload with an SDK-compatible text() helper
 */
export function toGeminiContentResponse(data: any): GeminiContentResponse {
  const payload = data && typeof data === 'object' ? data : {};
  return {
    candidates: payload.candidates,
    promptFeedback: payload.promptFeedback,
    usageMetadata: payload.usageMetadata,
    text: () => {
      const candidates: any[] = payload.candidates || [];
      if (candidates.length === 0) {
        if (payload.promptFeedback) {
          throw new Error(
            `Text not available. ${formatGeminiBlockMessage(payload)}`,
          );
        }
        return '';
      }
      const first = candidates[0];
      if (GEMINI_BLOCKED_FINISH_REASONS.includes(first?.finishReason)) {
        throw new Error(formatGeminiBlockMessage(payload));
      }
      const parts: any[] = first?.content?.parts || [];
      return parts
        .map((part) => {
          if (part.text) return part.text;
          if (part.executableCode) {
            const { language, code } = part.executableCode;
            return `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
          }
          if (part.codeExecutionResult) {
            return `\n\`\`\`\n${part.codeExecutionResult.output}\n\`\`\`\n`;
          }
          return '';
        })
        .join('');
    },
  };
}

function formatGeminiBlockMessage(payload: any): string {
  const candidates: any[] = payload.candidates || [];
  if (candidates.length === 0 && payload.promptFeedback) {
    const feedback = payload.promptFeedback;
    let message = 'Response was blocked';
    if (feedback.blockReason) message += ` due to ${feedback.blockReason}`;
    if (feedback.blockReasonMessage) {
      message += `: ${feedback.blockReasonMessage}`;
    }
    return message;
  }
  const first = candidates[0];
  let message = `Candidate was blocked due to ${first?.finishReason}`;
  if (first?.finishMessage) message += `: ${first.finishMessage}`;
  return message;
}

/**
 * Call Gemini generateContent through the background proxy (same path as
 * OpenAI-compatible requests: global concurrency cap, timeout, retries,
 * cancellation). Throws on HTTP/transport errors, like the SDK did.
 */
export async function generateGeminiContent(
  apiConfig: ApiConfig,
  prompt: string,
  options: GeminiGenerateOptions = {},
): Promise<{ response: GeminiContentResponse }> {
  const response = await sendViaBackground(
    buildGeminiRequest(apiConfig, prompt, options),
  );

  if (!response.ok) {
    const errorBody: any = await response.json().catch(() => null);
    const detail = errorBody?.error?.message;
    const error: Error & { status?: number } = new Error(
      `Gemini API request failed: [${response.status} ${response.statusText}]` +
        (detail && detail !== response.statusText ? ` ${detail}` : ''),
    );
    error.status = response.status;
    throw error;
  }

  return { response: toGeminiContentResponse(await response.json()) };
}
