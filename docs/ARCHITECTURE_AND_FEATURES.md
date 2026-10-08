# Architecture And Features

ILLA Helper is a WXT + Vue 3 browser extension that turns web page content into language learning material. The current architecture is bounded by user-visible paths: API configuration, word translation, paragraph translation, the pronunciation popover, and website rules.

## Current Runtime Model

- API configuration stores only the protocol family. The only protocol families are `openai-compatible` and `gemini`.
- OpenAI, DeepSeek, and SiliconFlow are OpenAI-compatible presets in the settings page, not runtime providers.
- A custom Gemini endpoint is an internal capability of the Gemini protocol family; there is no separate ProxyGemini provider.
- Anthropic support has been removed; the UI, storage, and runtime keep no fake support for it.
- OpenAI-compatible HTTP requests are all issued from the extension background to avoid Mixed Content and CORS divergence.
- Import/export accepts only the current `3.0` format; legacy format migration is no longer built in.

## Main Modules

- `entrypoints/options/components/translation/TranslationSettings.vue`: API configuration and translation settings UI.
- `src/modules/shared/ApiConfigHelpers.ts`: API presets, protocol family labels, and config sanitization.
- `src/modules/core/storage/StorageService.ts`: User settings read/write and current-format validation.
- `src/modules/api/factory/ApiServiceFactory.ts`: Creates the translation provider based on the protocol family.
- `src/modules/api/providers`: Adapter layer for OpenAI-compatible and Gemini.
- `src/modules/content/ContentManager.ts`: Content script lifecycle and service assembly.
- `src/modules/content/services/ConfigurationService.ts`: Resolves user settings into page runtime config.
- `src/modules/core/translation/LanguageService.ts`: Page language detection and target language resolution.
- `src/modules/core/translation/TextReplacerService.ts`: Word translation replacement pipeline.
- `src/modules/core/translation/ParagraphTranslationService.ts`: Paragraph translation pipeline.
- `src/modules/options/website-management`: Website blacklist/whitelist rule management.

## Design Notes

The current code no longer keeps legacy compatibility branches in the main path. Old configs, old provider names, deprecated interfaces, and sample code are not part of the runtime. If user data needs to be preserved in the future, use a one-off migration tool instead of putting compatibility logic back into the business pipeline.