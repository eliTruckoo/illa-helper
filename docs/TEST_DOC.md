# Immersive Language Helper - Usage Guide and Test Document

## 📋 Table of Contents

- [UniversalApiService: General AI Service](#universalapiservice-general-ai-service)
- [API Reference and Usage Examples](#api-reference-and-usage-examples)
- [Testing Guide](#testing-guide)
- [Debugging Tips](#debugging-tips)
- [Troubleshooting](#troubleshooting)
- [Performance Optimization Tips](#performance-optimization-tips)

---

## 🚀 UniversalApiService: General AI Service

### Overview

`UniversalApiService` is a general-purpose LLM API calling service. It wraps the underlying API call logic and exposes a simple interface, so you can easily use AI models in any business scenario.

### Core Features

- 🚀 **Minimal usage**: Call the AI with a single line of code
- 🔄 **Unified interface**: Supports multiple providers (OpenAI, Google Gemini, etc.)
- ⚙️ **Flexible configuration**: Supports custom parameters and configuration
- 🛡️ **Error handling**: Thorough error handling
- 💬 **Chat conversations**: Supports multi-turn conversations
- 📊 **Token statistics**: Provides detailed usage statistics

### Quick Start

#### Basic Import

```typescript
import { callAI, quickAI, universalApi } from '@/src/modules/api';
```

#### 1. The Simplest Call

```typescript
// Call directly with the default configuration
const result = await callAI('Explain what artificial intelligence is');
console.log(result.content);
```

#### 2. Quick Call (with a System Prompt)

```typescript
const result = await quickAI(
  'Analyze the sentiment of this text',
  'You are a professional sentiment analyst'
);
console.log(result.content);
```

#### 3. Call with Configuration

```typescript
const result = await callAI('Write a poem about spring', {
  systemPrompt: 'You are a poet',
  temperature: 0.8,
  maxTokens: 500
});
```

### Detailed Usage

#### Using a Class Instance

```typescript
// Get the singleton instance
const api = universalApi;

// Basic call
const result = await api.call('Your prompt', {
  systemPrompt: 'System prompt',
  temperature: 0.7,
  maxTokens: 1000
});

// Chat conversation
const messages = [
  { role: 'system', content: 'You are an AI assistant' },
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hello! How can I help you?' },
  { role: 'user', content: 'Please introduce TypeScript' }
];

const chatResult = await api.chat(messages, {
  temperature: 0.7
});
```

#### Configuration Options

```typescript
interface UniversalApiOptions {
  systemPrompt?: string;        // System prompt
  temperature?: number;         // Model temperature (0-2)
  maxTokens?: number;          // Maximum output tokens
  configId?: string;           // Specific API config ID
  forceProvider?: TranslationProvider; // Force a specific provider
  timeout?: number;            // Request timeout (milliseconds)
  customParams?: string;       // Custom parameters as a JSON string
  rawResponse?: boolean;       // Whether to return the raw response
}
```

#### Return Value

```typescript
interface UniversalApiResult {
  success: boolean;            // Whether the call succeeded
  prompt: string;             // Original prompt
  content: string;            // AI-generated content
  model?: string;             // Model name used
  provider?: string;          // Provider name used
  usage?: {                   // Token usage statistics
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  rawData?: any;             // Raw response data
  error?: string;            // Error message
}
```

### Business Scenario Examples

#### 1. Text Analysis

```typescript
const sentiment = await callAI(
  'Please analyze the sentiment of the following text: This product is amazing!',
  {
    systemPrompt: 'You are a professional text sentiment analyst',
    temperature: 0.3
  }
);
```

#### 2. Content Generation

```typescript
const content = await callAI(
  'Write a product introduction for a smartwatch',
  {
    systemPrompt: 'You are a professional product copywriter',
    temperature: 0.8,
    maxTokens: 500
  }
);
```

#### 3. Code Explanation

```typescript
const explanation = await quickAI(
  `Explain this code:\n${codeSnippet}`,
  'You are a programming teacher who explains code in simple language'
);
```

#### 4. Email Reply

```typescript
const reply = await callAI(
  `Help me reply to this email:\n${originalEmail}`,
  {
    systemPrompt: 'You are a professional customer service agent; replies should be polite and professional',
    temperature: 0.6
  }
);
```

#### 5. SEO Title Generation

```typescript
const titles = await callAI(
  'Generate 5 SEO-friendly titles for the topic "improving work efficiency"',
  {
    systemPrompt: 'You are an SEO expert; titles should attract clicks and include keywords',
    temperature: 0.8
  }
);
```

#### 6. Data Analysis Advice

```typescript
const advice = await callAI(
  'I have 1 million rows of user behavior data to analyze; give me processing advice',
  {
    systemPrompt: 'You are a data analysis expert',
    temperature: 0.5
  }
);
```

### Advanced Features

#### 1. Specifying a Provider

```typescript
const result = await callAI('Write a poem', {
  forceProvider: TranslationProvider.GoogleGemini,
  temperature: 0.9
});

console.log(`Provider used: ${result.provider}`);
```

#### 2. Getting Detailed Statistics

```typescript
const result = await callAI('Explain machine learning', {
  rawResponse: true
});

console.log(`Token usage: ${result.usage?.totalTokens}`);
console.log(`Raw response:`, result.rawData);
```

#### 3. Multi-turn Conversation Management

```typescript
let conversation = [
  { role: 'system', content: 'You are a programming assistant' }
];

// Round 1
conversation.push({ role: 'user', content: 'What are React Hooks?' });
let result = await universalApi.chat(conversation);
conversation.push({ role: 'assistant', content: result.content });

// Round 2
conversation.push({ role: 'user', content: 'Give an example of useState' });
result = await universalApi.chat(conversation);
```

#### 4. Error Handling

```typescript
const result = await callAI('Your prompt');

if (!result.success) {
  console.error('Call failed:', result.error);
  // Error handling logic
  return;
}

// Handle success
console.log(result.content);
```

#### 5. Checking API Status

```typescript
// Check whether the API is available
const isAvailable = await universalApi.isAvailable();

// Get the list of available models
const models = await universalApi.getAvailableModels();
console.log('Available models:', models);
```

### Best Practices

#### 1. Temperature Recommendations

- **Creative tasks** (poems, stories): `temperature: 0.8-1.0`
- **Analytical tasks** (data analysis, sentiment analysis): `temperature: 0.2-0.5`
- **Q&A tasks** (explanation, teaching): `temperature: 0.5-0.7`
- **Code-related** (code explanation, refactoring): `temperature: 0.3-0.6`

#### 2. System Prompt Optimization

```typescript
// ✅ A good system prompt
const goodPrompt = 'You are a senior front-end engineer skilled in React and TypeScript. Answer questions in concise, professional language.';

// ❌ A prompt that is not specific enough
const badPrompt = 'You are a programmer';
```

#### 3. Error Handling Pattern

```typescript
async function safeCallAI(prompt: string, options?: UniversalApiOptions) {
  try {
    const result = await callAI(prompt, options);
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    return result.content;
  } catch (error) {
    console.error('AI call failed:', error);
    return 'Sorry, an error occurred while processing your request. Please try again later.';
  }
}
```

#### 4. Performance Optimization

```typescript
// For simple calls that do not need detailed information
const result = await quickAI(prompt, systemPrompt);

// For complex calls that need control
const result = await callAI(prompt, {
  systemPrompt,
  temperature: 0.7,
  maxTokens: 1000,
  timeout: 30000
});
```

### Differences from the Translation API

| Feature | UniversalApiService | Translation API |
|---------|---------------------|-----------------|
| Purpose | General AI calls | Dedicated to translation |
| System prompt | Fully customizable | Fixed translation prompt |
| Return format | Raw AI response | Structured translation result |
| Use cases | Any AI task | Text translation and replacement |

---

## 🔌 API Reference and Usage Examples

### Using the API Service (Refactored Modular Architecture)

#### Importing and Creating a Translation Service
```typescript
// Recommended: use the new modular API
import { ApiServiceFactory } from '@/src/modules/api';

// Create a translation provider instance
const provider = ApiServiceFactory.createProvider(activeConfig);

// Translate text
const result = await provider.analyzeFullText(text, settings);
```

#### Using a Specific Provider Directly
```typescript
// Import a specific provider directly
import { GoogleGeminiProvider, OpenAIProvider } from '@/src/modules/api';

// Create a Gemini provider directly
const geminiProvider = new GoogleGeminiProvider(config);
const result = await geminiProvider.analyzeFullText(text, settings);

// Create an OpenAI provider directly  
const openaiProvider = new OpenAIProvider(config);
const result = await openaiProvider.analyzeFullText(text, settings);
```

#### Extending with a New Translation Provider
```typescript
import { BaseProvider } from '@/src/modules/api';
import { ApiConfig, UserSettings, FullTextAnalysisResponse } from '@/src/modules/types';

// Create a custom provider
class CustomProvider extends BaseProvider {
  protected getProviderName(): string {
    return 'Custom Provider';
  }

  protected async doAnalyzeFullText(
    text: string,
    settings: UserSettings,
  ): Promise<FullTextAnalysisResponse> {
    // Implement custom translation logic
    return {
      original: text,
      processed: '',
      replacements: []
    };
  }
}

// Use it in the factory
// The corresponding creation logic must be added to ApiServiceFactory
```

### User Settings API

#### Getting User Settings
```typescript
import { StorageManager } from '@/src/modules/storageManager';

const storageManager = new StorageManager();
const settings = await storageManager.getUserSettings();
```

#### Saving User Settings
```typescript
import { UserLevel, TranslationStyle } from '@/src/modules/types';

await storageManager.saveUserSettings({
  userLevel: UserLevel.INTERMEDIATE,
  replacementRate: 0.3,
  translationStyle: TranslationStyle.HIGHLIGHTED
});
```

#### Settings Update Notifications
```typescript
import { notifySettingsChanged } from '@/src/modules/messaging';

await notifySettingsChanged(newSettings);
```

### Pronunciation Service API

#### Initializing the Pronunciation Service
```typescript
import { PronunciationService, DEFAULT_PRONUNCIATION_CONFIG } from '@/src/modules/pronunciation';

const pronunciationService = new PronunciationService({
  ...DEFAULT_PRONUNCIATION_CONFIG,
  uiConfig: {
    tooltipEnabled: true,
    showPhonetic: true,
    showPlayButton: true
  }
});
```

#### Adding Pronunciation to an Element
```typescript
await pronunciationService.addPronunciationToElement(
  element,           // HTML element
  'hello world',     // Word or phrase
  false             // Whether it is a phrase
);
```

#### Speech Synthesis
```typescript
// Use the default TTS
const result = await pronunciationService.speakText('Hello World');

// Specify an accent
const result = await pronunciationService.speakTextWithAccent('Hello', 'en-GB');
```

#### Getting Phonetics
```typescript
const phoneticResult = await pronunciationService.getPhonetic('hello');
console.log(phoneticResult.phonetics[0].text); // "/həˈloʊ/"
```

### Utility Function API

#### API-related Utility Functions
```typescript
import { 
  mergeCustomParams, 
  createErrorResponse, 
  validateInputs 
} from '@/src/modules/api';

// Merge custom API parameters
const mergedParams = mergeCustomParams(baseParams, '{"temperature": 0.5}');

// Create an error response
const errorResponse = createErrorResponse('original text');

// Validate input parameters
const isValid = validateInputs('text content', 'api-key');
```

#### Text Processing Utility Functions
```typescript
import { addPositionsToReplacements } from '@/src/modules/api';

// Add position information to replacements
const replacementsWithPosition = addPositionsToReplacements(
  originalText,
  [{ original: 'hello', translation: 'hola' }]
);
```

---

## 🧪 Testing Guide

### UniversalApiService Tests

#### Running the Full Test Suite

```typescript
import { UniversalApiTest, quickFunctionTest } from '@/src/modules/api/examples/UniversalApiTest';

// Run all tests
await UniversalApiTest.runAllTests();

// Quick functionality check
await quickFunctionTest();
```

#### Test Coverage

- ✅ Basic call functionality
- ✅ Google Gemini provider test
- ✅ OpenAI provider test
- ✅ Chat conversation functionality
- ✅ Raw response retrieval
- ✅ Error handling verification
- ✅ API availability check
- ✅ Model list retrieval

#### Individual Test Examples

```typescript
// Test a basic call
const basicResult = await UniversalApiTest.testBasicCall();

// Test a specific provider
const geminiResult = await UniversalApiTest.testGoogleGeminiProvider();

// Test error handling
const errorTest = await UniversalApiTest.testErrorHandling();
```

### Manual Test Checklist

#### Core Functionality Tests
- [ ] Basic translation works on different types of websites
- [ ] Smart language detection correctly identifies the page source language
- [ ] Smart multilingual mode translates accurately (test Chinese, English, Japanese, Korean, etc.)
- [ ] General AI calls work (various business scenarios)

#### Pronunciation System Tests
- [ ] Pronunciation feature shows phonetics correctly (Dictionary API)
- [ ] TTS playback works (test both Youdao TTS and Web Speech TTS)
- [ ] Tooltip positioning and interaction respond correctly (no boundary overflow)
- [ ] Two-level learning experience works (phrase → word interaction)

#### UI and Style Tests
- [ ] All 7 translation styles display correctly (including the blur effect for learning mode)
- [ ] Theme adaptation works (automatic dark/light switching)
- [ ] Responsive design works on different devices
- [ ] UniversalApiService UI calls work

#### Settings and Configuration Tests
- [ ] Settings saving and cross-device sync work
- [ ] 20+ languages have the correct translation direction
- [ ] API config switching works
- [ ] Custom parameter configuration takes effect

#### Performance and Stability Tests
- [ ] Performance is good (large pages, dynamic content, caching)
- [ ] Memory usage is reasonable (no leaks during long use)
- [ ] Error recovery works
- [ ] Network error handling works

---

## 🐛 Debugging Tips

### Basic Debug Setup

#### Enabling Debug Mode
```typescript
// Enable debug logging
localStorage.setItem('wxt-debug', 'true');

// View detailed console output
console.log('Debug mode enabled');
```

#### Checking the API Configuration
```typescript
// Check the current API configuration
const settings = await browser.storage.sync.get('user_settings');
console.log('Current settings:', JSON.parse(settings.user_settings));

// Verify the API configuration is valid
const isAvailable = await universalApi.isAvailable();
console.log('API Available:', isAvailable);

// Get the model list
const models = await universalApi.getAvailableModels();
console.log('Available models:', models);
```

#### Debugging UniversalApiService

```typescript
// Test a basic call
const debugResult = await callAI('Test call', {
  rawResponse: true,
  systemPrompt: 'Answer briefly'
});

console.log('Debug result:', {
  success: debugResult.success,
  provider: debugResult.provider,
  model: debugResult.model,
  usage: debugResult.usage,
  error: debugResult.error,
  rawData: debugResult.rawData
});
```

### Pronunciation System Debugging

#### Checking the Pronunciation Service Status
```typescript
// Check the TTS service status
const ttsStatus = pronunciationService.getTTSProviderStatus();
console.log('TTS Status:', ttsStatus);

// Check browser TTS support
if ('speechSynthesis' in window) {
  console.log('Web Speech API supported');
  console.log('Available voices:', speechSynthesis.getVoices());
} else {
  console.warn('Web Speech API not supported');
}

// Check the cache status
console.log('Pronunciation cache status:', pronunciationService.getCacheStatus());
```

#### Debugging Phonetic Retrieval
```typescript
// Test phonetic retrieval
try {
  const phoneticResult = await pronunciationService.getPhonetic('hello');
  console.log('Phonetic result:', phoneticResult);
} catch (error) {
  console.error('Phonetic fetch failed:', error);
}
```

### Network Request Debugging

#### API Request Monitoring
```typescript
// Monitor API requests
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  console.log('API Request:', args[0], args[1]);
  const response = await originalFetch(...args);
  console.log('API Response:', response.status, response.statusText);
  return response;
};
```

#### Request Performance Analysis
```typescript
// Test request performance
const startTime = performance.now();
const result = await callAI('Performance test');
const endTime = performance.now();
console.log(`Request took ${endTime - startTime} milliseconds`);
```

### Memory and Performance Debugging

#### Memory Usage Monitoring
```typescript
// Check memory usage
if (performance.memory) {
  console.log('Memory usage:', {
    used: Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB',
    total: Math.round(performance.memory.totalJSHeapSize / 1048576) + ' MB',
    limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576) + ' MB'
  });
}
```

#### Performance Metrics Monitoring
```typescript
// Monitor key performance metrics
const performanceMetrics = {
  translationTime: 0,
  tooltipResponseTime: 0,
  apiCallSuccessRate: 0,
  cacheHitRate: 0
};

// Measure time before and after key operations
const measurePerformance = async (operation: string, fn: Function) => {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  console.log(`${operation} took ${duration.toFixed(2)}ms`);
  return result;
};
```

---

## 🛠️ Troubleshooting

### Common Problems and Solutions

#### 1. UniversalApiService Issues

**Symptom**: AI calls fail and return an error message
**Steps**:
```typescript
// 1. Check API availability
const isAvailable = await universalApi.isAvailable();
console.log('API availability:', isAvailable);

// 2. Check the model list
const models = await universalApi.getAvailableModels();
console.log('Available models:', models);

// 3. Test a simple call
const testResult = await callAI('Hello', { 
  rawResponse: true,
  timeout: 10000 
});
console.log('Test result:', testResult);
```

**Common solutions**:
- Check that the API key is configured correctly
- Verify that the network connection is working
- Confirm that the selected model is available
- Check that the request parameters are valid

#### 2. API Configuration Issues

**Symptom**: Translation does not work and an API configuration error notification is shown
**Solution**:
```typescript
// Check the API configuration
const settings = await browser.storage.sync.get('user_settings');
const userSettings = JSON.parse(settings.user_settings);
console.log('API Config:', userSettings.apiConfigs);

// Verify the API key format
const activeConfig = userSettings.apiConfigs.find(
  config => config.id === userSettings.activeApiConfigId
);

if (!activeConfig?.config?.apiKey) {
  console.error('API key is not configured');
} else if (activeConfig.provider === 'OpenAI' && 
           !activeConfig.config.apiKey.startsWith('sk-')) {
  console.error('OpenAI API key format is incorrect');
}
```

#### 3. Pronunciation Feature Not Working

**Symptom**: The tooltip is shown but phonetics or TTS do not work
**Solution**:
```typescript
// Check the TTS service status
const ttsStatus = pronunciationService.getTTSProviderStatus();
console.log('TTS Status:', ttsStatus);

// Check browser TTS support
if ('speechSynthesis' in window) {
  console.log('Web Speech API supported');
  const voices = speechSynthesis.getVoices();
  console.log('Available voices:', voices.length);
} else {
  console.warn('Web Speech API not supported');
}

// Check the Dictionary API connection
try {
  const testPhonetic = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/test');
  if (testPhonetic.ok) {
    console.log('Dictionary API accessible');
  }
} catch (error) {
  console.error('Dictionary API not accessible:', error);
}
```

#### 4. Style Display Problems

**Symptom**: Translated text styles are incorrect or conflicting
**Solution**:
```typescript
// Check style injection
const styleSheets = document.querySelectorAll('style[data-wxt]');
console.log('WXT stylesheets:', styleSheets.length);

// Check for style conflicts
const conflictingStyles = document.querySelectorAll('[class*="wxt-"]');
console.log('WXT styled elements:', conflictingStyles.length);

// Re-inject styles
if (styleSheets.length === 0) {
  console.log('Styles were not injected correctly, trying to reinitialize');
  // Reinitialize the style manager
}
```

#### 5. Settings Fail to Save

**Symptom**: Configuration changes do not take effect or are lost
**Solution**:
```typescript
// Check storage permissions
try {
  await browser.storage.sync.set({test: 'value'});
  await browser.storage.sync.remove('test');
  console.log('Storage permissions OK');
} catch (error) {
  console.error('Storage permission denied:', error);
}

// Check the storage quota
const storageData = await browser.storage.sync.get(null);
const dataSize = JSON.stringify(storageData).length;
console.log('Storage usage:', dataSize, 'bytes');

if (dataSize > 102400) { // 100KB limit for sync storage
  console.warn('Storage quota exceeded');
}
```

#### 6. Performance Problems

**Symptom**: The page responds slowly and memory usage is too high
**Solution**:
```typescript
// Check memory usage
const checkMemory = () => {
  if (performance.memory) {
    const memory = performance.memory;
    console.log('Memory usage:', {
      used: (memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB',
      total: (memory.totalJSHeapSize / 1048576).toFixed(2) + ' MB'
    });
  }
};

// Check the cache status
const cacheStats = pronunciationService.getCacheStatus();
console.log('Cache statistics:', cacheStats);

// Clear the cache
if (cacheStats.size > 1000) {
  pronunciationService.clearCache();
  console.log('Cache cleared due to size limit');
}
```

#### 7. Network Connection Problems

**Symptom**: API calls time out or the connection fails
**Solution**:
```typescript
// Test the network connection
const testConnection = async () => {
  try {
    // Test the basic network connection
    const response = await fetch('https://httpbin.org/get', {
      method: 'GET',
      timeout: 5000
    });
    
    if (response.ok) {
      console.log('Network connection OK');
    }
  } catch (error) {
    console.error('Network connection error:', error);
  }
};

// Test the API endpoint connection
const testApiEndpoint = async (endpoint: string) => {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test' }),
      timeout: 10000
    });
    
    console.log(`API endpoint ${endpoint} status:`, response.status);
  } catch (error) {
    console.error(`API endpoint ${endpoint} connection failed:`, error);
  }
};
```

### Error Code Reference

| Error Code | Meaning | Solution |
|------------|---------|----------|
| `API_KEY_MISSING` | API key not configured | Configure a valid API key in settings |
| `API_KEY_INVALID` | API key invalid | Check the key format and validity |
| `NETWORK_ERROR` | Network connection failed | Check the network connection and firewall settings |
| `TIMEOUT_ERROR` | Request timed out | Increase the timeout or check the network |
| `QUOTA_EXCEEDED` | API quota exceeded | Check API usage and billing |
| `MODEL_NOT_FOUND` | Model does not exist | Check that the model name is correct |
| `INVALID_REQUEST` | Invalid request parameters | Check the request parameter format |

---

## ⚡ Performance Optimization Tips

### UniversalApiService Performance Optimization

#### 1. Request Optimization

```typescript
// Use an appropriate temperature
const optimizedCall = await callAI(prompt, {
  temperature: 0.3,    // Use a lower temperature for analytical tasks
  maxTokens: 500,      // Limit output length
  timeout: 15000       // Set a reasonable timeout
});

// Process multiple requests in a batch
const batchRequests = await Promise.allSettled([
  callAI(prompt1, options1),
  callAI(prompt2, options2),
  callAI(prompt3, options3)
]);
```

#### 2. Caching Strategy

```typescript
// Implement request caching
const cache = new Map();

const cachedCallAI = async (prompt: string, options: UniversalApiOptions) => {
  const cacheKey = JSON.stringify({ prompt, options });
  
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  
  const result = await callAI(prompt, options);
  cache.set(cacheKey, result);
  
  return result;
};
```

### Translation System Performance Optimization

#### 1. DOM Operation Optimization
```typescript
// Batch DOM updates
const fragment = document.createDocumentFragment();
// Add all elements to the fragment
element.appendChild(fragment);

// Use the Range API for precise replacement
const range = document.createRange();
range.setStart(textNode, startOffset);
range.setEnd(textNode, endOffset);
```

#### 2. Asynchronous Processing Optimization
```typescript
// Load phonetics and meaning in parallel
const [phoneticResult, aiTranslation] = await Promise.allSettled([
  pronunciationService.getPhonetic(word),
  universalApi.call(`Explain the meaning of the word "${word}"`, {
    systemPrompt: 'You are an English dictionary; explain English words concisely',
    maxTokens: 100
  })
]);
```
