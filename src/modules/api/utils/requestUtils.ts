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
