# ILLA Helper

This is the context of a browser extension whose goal is to turn web page content into language-learning input without breaking the browsing experience. The core concepts here are not the low-level service classes, but the learning paths and configuration objects that users actually perceive and rely on.

## Language

**User settings**:
The extension's only persisted configuration object, defining translation, pronunciation, website rules and API behavior. It is the single source of truth for runtime configuration.
_Avoid_: partial settings, temporary config, legacy config

**API config**:
A switchable service connection entry in the user settings, containing the protocol family, endpoint, model and request parameters. It is the user-level definition of "how the extension calls an external LLM service".
_Avoid_: channel, node, platform config

**Custom provider**:
A user-configurable OpenAI-compatible interface, not a placeholder for arbitrary protocols. It lets users fill in their own endpoint and model, but must reuse the OpenAI-compatible request pipeline.
_Avoid_: arbitrary custom protocol, catch-all provider, reserved extension point

**OpenAI-compatible preset**:
A user-facing provider shortcut template, such as OpenAI, DeepSeek or SiliconFlow. Presets only supply a default endpoint and model; they do not represent different runtime protocol types.
_Avoid_: separate provider protocol, runtime branch type

**Protocol family**:
The provider-type boundary actually recognized by the storage layer and the runtime, used to decide how requests are adapted. Only a few explicit types should remain, such as `openai-compatible` and `gemini`.
_Avoid_: brand-name provider, UI preset name, marketing name

**Provider adapter layer**:
The boundary layer that converts the unified API config and unified translation intent into each model vendor's actual request format. It handles protocol differences between OpenAI-compatible interfaces and Gemini, but does not own user configuration or UI logic.
_Avoid_: config model, settings page logic, storage structure

**Gemini gateway mode**:
A variant of the Gemini provider's call entry that allows accessing Gemini through a custom endpoint or proxy gateway. It is an internal difference of the Gemini adapter layer, not a separate user-level provider.
_Avoid_: ProxyGemini provider, separate service provider

**False support**:
A state where the UI, copy or config claims to support a provider, but the runtime has no dedicated adapter or no clear working path. It should be resolved into either "truly supported" or "explicitly removed", and must not stay in the system creating wrong expectations.
_Avoid_: reserved option, leave it for now, half support

**Background API request**:
All OpenAI-compatible HTTP requests are issued by the extension background, avoiding Mixed Content when an HTTPS page calls an HTTP endpoint, and avoiding keeping a CORS fork in the content script.
_Avoid_: useBackgroundProxy switch, content script calling the API directly

**Word translation**:
The translation mode that replaces or inserts target-language words in the original page text by ratio. It preserves the page structure and uses a word or phrase as the smallest learning unit.
_Avoid_: full-text translation, paragraph translation

**Paragraph translation**:
The translation mode that generates additional translated content per paragraph. It is not centered on inline word replacement; instead it appends a separate translation result to the paragraph.
_Avoid_: word translation, word-by-word replacement

**Pronunciation tooltip**:
An interactive learning panel attached to a translation result, showing phonetics, definitions and playback actions. It is the main entry for users into the pronunciation learning path.
_Avoid_: hint box, tooltip component

**Website rules**:
The user rule set controlling whether the extension is active on specific websites, including blacklist and whitelist semantics. It decides whether the content script should intervene in a page.
_Avoid_: blacklist storage, legacy site config

**Protected user paths**:
The user-visible operation paths that must remain working during refactoring, including API config management, word translation, paragraph translation, the pronunciation tooltip and website rules taking effect. It is the only external constraint for deciding whether internal implementations may be removed or changed.
_Avoid_: keep features, try not to break, mostly works
