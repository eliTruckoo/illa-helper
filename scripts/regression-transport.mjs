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

console.log('transport regression passed');
