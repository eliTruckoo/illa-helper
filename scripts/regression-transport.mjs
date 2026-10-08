// Regression checks for the network transport (background proxy replies, retry policy,
// global request limiter, Gemini REST request building).
// Imported from regression-main.mjs, which sets up the browser/DOM globals.
import assert from 'node:assert/strict';

const { sendViaBackground, toProxyResponse } = await import(
  '../src/modules/api/utils/requestUtils.ts'
);

// ---------- ei3.8: the proxy call never hangs ----------

const originalSendMessage = globalThis.browser.runtime.sendMessage;
const proxyRequest = {
  url: 'https://example.test/v1/chat/completions',
  method: 'POST',
  headers: {},
  body: '{}',
};

globalThis.browser.runtime.sendMessage = async () => undefined;
let proxyResponse = await sendViaBackground(proxyRequest);
assert.equal(
  proxyResponse.ok,
  false,
  'an undefined reply must resolve ok:false',
);
assert.equal(proxyResponse.status, 500);

globalThis.browser.runtime.sendMessage = async () => {
  throw new Error(
    'Could not establish connection. Receiving end does not exist.',
  );
};
proxyResponse = await sendViaBackground(proxyRequest);
assert.equal(
  proxyResponse.ok,
  false,
  'a rejected sendMessage must resolve ok:false',
);
assert.match(proxyResponse.statusText, /Receiving end does not exist/);

globalThis.browser.runtime.sendMessage = async () => ({
  success: true,
  data: { choices: [{ message: { content: 'hi' } }] },
});
proxyResponse = await sendViaBackground(proxyRequest);
assert.equal(proxyResponse.ok, true);
assert.equal((await proxyResponse.json()).choices[0].message.content, 'hi');

proxyResponse = toProxyResponse({
  success: false,
  error: {
    message: 'HTTP 429',
    status: 429,
    statusText: 'Too Many Requests',
    retryAfter: 2000,
  },
});
assert.equal(proxyResponse.ok, false);
assert.equal(
  proxyResponse.status,
  429,
  'upstream status must be passed through',
);
assert.equal(proxyResponse.headers.get('retry-after'), '2');
assert.equal((await proxyResponse.json()).error.message, 'HTTP 429');

globalThis.browser.runtime.sendMessage = originalSendMessage;

// ---------- ei3.7: retry policy and timeouts ----------

const {
  isRetryableStatus,
  parseRetryAfter,
  computeBackoffDelay,
  getRetryDecision,
  resolveRequestTimeout,
  DEFAULT_RETRY_POLICY,
} = await import('../src/modules/infrastructure/ratelimit/retryPolicy.ts');

for (const status of [408, 429, 500, 502, 503, 504]) {
  assert.equal(isRetryableStatus(status), true, `${status} is transient`);
}
for (const status of [400, 401, 403, 404, 413, 422, undefined]) {
  assert.equal(isRetryableStatus(status), false, `${status} is never retried`);
}

assert.equal(parseRetryAfter('2'), 2000);
assert.equal(parseRetryAfter('0'), 0);
assert.equal(parseRetryAfter(null), undefined);
assert.equal(parseRetryAfter('soon'), undefined);
const now = Date.parse('2026-01-01T00:00:00Z');
assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now), 5000);

assert.equal(
  computeBackoffDelay(0, DEFAULT_RETRY_POLICY, () => 0),
  500,
);
assert.equal(
  computeBackoffDelay(0, DEFAULT_RETRY_POLICY, () => 1),
  1000,
);
assert.equal(
  computeBackoffDelay(1, DEFAULT_RETRY_POLICY, () => 1),
  2000,
);
assert.equal(
  computeBackoffDelay(10, DEFAULT_RETRY_POLICY, () => 1),
  DEFAULT_RETRY_POLICY.maxDelay,
  'backoff is capped',
);

assert.deepEqual(getRetryDecision(401, 0), { retry: false, delayMs: 0 });
assert.deepEqual(getRetryDecision(429, 0, 1500), {
  retry: true,
  delayMs: 1500,
});
assert.equal(
  getRetryDecision(429, 0, 60000).retry,
  false,
  'a Retry-After beyond the limit gives up instead of blocking',
);
assert.equal(getRetryDecision(503, 1).retry, true);
assert.equal(getRetryDecision(503, 2).retry, false, 'at most 2 retries');

assert.equal(resolveRequestTimeout(undefined, 30000, 300000), 30000);
assert.equal(resolveRequestTimeout(-1, 30000, 300000), 30000);
assert.equal(resolveRequestTimeout(0, 30000, 300000), 300000);
assert.equal(resolveRequestTimeout(5000, 30000, 300000), 5000);

const { getApiTimeout } = await import('../src/utils/index.ts');
assert.equal(getApiTimeout(undefined), 30000);
assert.equal(getApiTimeout(0), 0);
assert.equal(getApiTimeout(12000), 12000);

const { ApiProxyService } = await import(
  '../src/modules/background/services/ApiProxyService.ts'
);
const proxy = ApiProxyService.getInstance();
proxy.updateConfig({ retryDelay: 1, maxRetryDelay: 2 });

const originalFetch = globalThis.fetch;
const jsonResponse = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    statusText: `status ${status}`,
    headers,
  });
const apiMessage = (data = {}) => ({
  type: 'api-request',
  data: {
    url: 'https://example.test/v1',
    method: 'POST',
    headers: {},
    body: '{}',
    ...data,
  },
});
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  return fetchCalls === 1
    ? jsonResponse(503, { error: { message: 'overloaded' } })
    : jsonResponse(200, { ok: true });
};
let proxyResult = await proxy.handleApiRequest(apiMessage());
assert.equal(proxyResult.success, true, '503 is retried');
assert.equal(fetchCalls, 2);

fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  return jsonResponse(401, { error: { message: 'bad key' } });
};
proxyResult = await proxy.handleApiRequest(apiMessage());
assert.equal(fetchCalls, 1, '401 is never retried');
assert.equal(proxyResult.error.status, 401);
assert.match(proxyResult.error.message, /bad key/);

fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  return jsonResponse(429, {}, { 'Retry-After': '0' });
};
proxyResult = await proxy.handleApiRequest(apiMessage());
assert.equal(fetchCalls, 3, '429 is retried at most twice');
assert.equal(proxyResult.error.status, 429);
assert.equal(proxyResult.error.retryAfter, 0);

const hangingFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    fetchCalls++;
    init.signal.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError')),
    );
  });

fetchCalls = 0;
globalThis.fetch = hangingFetch;
proxyResult = await proxy.handleApiRequest(apiMessage({ timeout: 20 }));
assert.equal(proxyResult.error.code, 'timeout', 'a hung request times out');
assert.equal(fetchCalls, 1, 'timeouts are not retried');
assert.equal(
  proxy.getActiveRequestCount(),
  0,
  'finished requests are released',
);

const tabRequest = proxy.handleApiRequest(apiMessage({ clientId: 'doc-1' }), {
  tab: { id: 7, active: true },
});
await tick();
assert.equal(proxy.getActiveRequestCount(), 1);
proxy.cancelTabRequests(7);
proxyResult = await tabRequest;
assert.equal(proxyResult.error.code, 'aborted', 'closing the tab aborts it');

const clientRequest = proxy.handleApiRequest(
  apiMessage({ clientId: 'doc-2' }),
  { tab: { id: 8 } },
);
await tick();
proxy.cancelClientRequests('doc-2');
proxyResult = await clientRequest;
assert.equal(
  proxyResult.error.code,
  'aborted',
  'a disconnected document port aborts its requests',
);
assert.equal(proxy.getActiveRequestCount(), 0);

// ---------- ei3.6: global priority semaphore ----------

const { PriorityLimiter, REQUEST_PRIORITY } = await import(
  '../src/modules/infrastructure/ratelimit/PriorityLimiter.ts'
);

const limiter = new PriorityLimiter(2);
const order = [];
const releases = [];
const take = (name, priority, tag) =>
  limiter.acquire({ priority, tag }).then((release) => {
    order.push(name);
    releases.push(release);
  });
const granted = [
  take('a', 1),
  take('b', 1),
  take('bg-1', REQUEST_PRIORITY.BACKGROUND, { tabId: 2 }),
  take('bg-2', REQUEST_PRIORITY.BACKGROUND, { tabId: 3 }),
  take('fg', REQUEST_PRIORITY.FOREGROUND, { tabId: 1 }),
];
await tick(1);
assert.deepEqual(order, ['a', 'b'], 'never more than maxConcurrent');
assert.equal(limiter.pendingCount, 3);
limiter.reprioritize((tag) => tag?.tabId === 3, REQUEST_PRIORITY.FOREGROUND);
const releaseA = releases.shift();
releaseA();
releaseA(); // a double release must not free an extra slot
releases.shift()();
await tick(1);
assert.deepEqual(
  order,
  ['a', 'b', 'bg-2', 'fg'],
  'foreground before background, FIFO within a priority (bg-2 was promoted)',
);
assert.equal(limiter.activeCount, 2);
releases.shift()();
releases.shift()();
await Promise.all(granted);
assert.deepEqual(order.at(-1), 'bg-1');
releases.shift()();
assert.equal(limiter.activeCount, 0);

const abortable = new AbortController();
const blocker = await limiter.acquire();
const blocker2 = await limiter.acquire();
const queued = limiter.acquire({ signal: abortable.signal });
abortable.abort();
await assert.rejects(queued, { name: 'AbortError' });
assert.equal(limiter.pendingCount, 0, 'an aborted waiter leaves the queue');
blocker();
blocker2();

// The proxy never runs more than maxConcurrentRequests fetches at once,
// and the active tab's queued request starts before background tabs'.
proxy.updateConfig({ maxConcurrentRequests: 2 });
let inFlight = 0;
let maxInFlight = 0;
const startedUrls = [];
const pendingFetches = [];
globalThis.fetch = (url) =>
  new Promise((resolve) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    startedUrls.push(url);
    pendingFetches.push(() => {
      inFlight--;
      resolve(jsonResponse(200, { ok: true }));
    });
  });
const proxied = [
  proxy.handleApiRequest(apiMessage({ url: 'bg-a' }), {
    tab: { id: 11, windowId: 1, active: false },
  }),
  proxy.handleApiRequest(apiMessage({ url: 'bg-b' }), {
    tab: { id: 12, windowId: 1, active: false },
  }),
  proxy.handleApiRequest(apiMessage({ url: 'bg-c' }), {
    tab: { id: 13, windowId: 1, active: false },
  }),
  proxy.handleApiRequest(apiMessage({ url: 'active' }), {
    tab: { id: 14, windowId: 1, active: true },
  }),
];
await tick();
assert.equal(proxy.getConcurrencyStats().queued, 2);
pendingFetches.shift()();
await tick();
assert.equal(startedUrls[2], 'active', 'the active tab jumps the queue');
proxy.setActiveTab(1, 13);
while (pendingFetches.length > 0) {
  pendingFetches.shift()();
  await tick();
}
assert.ok((await Promise.all(proxied)).every((result) => result.success));
assert.equal(maxInFlight, 2, 'global concurrency cap holds');
assert.deepEqual(proxy.getConcurrencyStats(), { running: 0, queued: 0 });

globalThis.fetch = originalFetch;

// ---------- eq7.5: Gemini goes through the background proxy ----------

const { buildGeminiRequest, toGeminiContentResponse, generateGeminiContent } =
  await import('../src/modules/api/utils/requestUtils.ts');

const geminiConfig = {
  apiKey: 'gemini-key',
  apiEndpoint: '',
  model: 'gemini-2.5-flash',
  temperature: 0.2,
};
const geminiRequest = buildGeminiRequest(geminiConfig, 'system\n\nuser', {
  generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
  timeout: 15000,
});
assert.equal(
  geminiRequest.url,
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
);
assert.equal(geminiRequest.headers['x-goog-api-key'], 'gemini-key');
assert.ok(
  !geminiRequest.url.includes('gemini-key'),
  'the key must not be put in the URL',
);
assert.equal(geminiRequest.timeout, 15000);
assert.deepEqual(JSON.parse(geminiRequest.body), {
  contents: [{ role: 'user', parts: [{ text: 'system\n\nuser' }] }],
  generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
});
assert.equal(
  buildGeminiRequest(
    {
      ...geminiConfig,
      apiEndpoint: 'https://proxy.example/',
      model: 'tunedModels/x',
    },
    'p',
  ).url,
  'https://proxy.example/v1beta/tunedModels/x:generateContent',
  'a custom endpoint is the base URL, like the SDK baseUrl',
);

const geminiPayload = {
  candidates: [
    {
      content: { parts: [{ text: 'Hello ' }, { text: 'world' }] },
      finishReason: 'MAX_TOKENS',
    },
  ],
  usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
};
const geminiResponse = toGeminiContentResponse(geminiPayload);
assert.equal(geminiResponse.text(), 'Hello world');
assert.equal(geminiResponse.candidates[0].finishReason, 'MAX_TOKENS');
assert.equal(geminiResponse.usageMetadata.promptTokenCount, 3);
assert.equal(toGeminiContentResponse({}).text(), '');
assert.throws(
  () =>
    toGeminiContentResponse({
      promptFeedback: { blockReason: 'SAFETY' },
    }).text(),
  /blocked due to SAFETY/,
);
assert.throws(
  () =>
    toGeminiContentResponse({
      candidates: [{ finishReason: 'RECITATION', content: { parts: [] } }],
    }).text(),
  /RECITATION/,
);

let sentMessage;
globalThis.browser.runtime.sendMessage = async (message) => {
  sentMessage = message;
  return { success: true, data: geminiPayload };
};
const geminiResult = await generateGeminiContent(geminiConfig, 'hi', {
  generationConfig: { temperature: 0.2 },
});
assert.equal(sentMessage.type, 'api-request', 'Gemini uses the proxy path');
assert.equal(sentMessage.data.method, 'POST');
assert.equal(geminiResult.response.text(), 'Hello world');

globalThis.browser.runtime.sendMessage = async () => ({
  success: false,
  error: {
    message: 'HTTP 400: API key not valid',
    status: 400,
    statusText: 'Bad Request',
    code: 'http',
  },
});
await assert.rejects(
  generateGeminiContent(geminiConfig, 'hi'),
  (error) => error.status === 400 && /API key not valid/.test(error.message),
  'HTTP errors are thrown like the SDK did',
);
globalThis.browser.runtime.sendMessage = originalSendMessage;

console.log('transport regression passed');
