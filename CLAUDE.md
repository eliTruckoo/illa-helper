# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**illa-helper** is a browser extension for immersive language learning based on the "i+1" comprehensible input theory. It intelligently replaces words on web pages with translations based on user proficiency level, creating a natural language learning environment while browsing.

Built with WXT (WebExtension Toolkit) + Vue 3 + TypeScript + Vite. Supports Chrome, Edge, Firefox.

## Common Commands

```bash
npm run dev              # Dev server (Chrome), hot reload
npm run dev:firefox      # Dev server (Firefox)
npm run build            # Production build (Chrome)
npm run build:firefox    # Production build (Firefox)
npm run zip              # Package for Chrome store
npm run zip:firefox      # Package for Firefox store
npm run zip:all          # Package all browsers

npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier format
npm run check            # format + lint:fix combined
npm run compile          # TypeScript type check (vue-tsc --noEmit)
```

No test framework is configured. Validation is done via `npm run compile` (type check) and `npm run lint`.

## Environment Setup

Copy `.env.example` to `.env`. Minimum required: `VITE_WXT_DEFAULT_API_KEY`. Variables are injected at build time via Vite.

## Architecture

### Entry Points (`entrypoints/`)

| Entry | Role |
|-------|------|
| `background.ts` | Service worker. Initializes singleton services, routes runtime messages, handles extension install/update events. |
| `content.ts` | Content script. Creates `ContentManager` which orchestrates DOM scanning, translation injection, and cleanup. |
| `popup/` | Vue 3 app. Quick toggle and status display. |
| `options/` | Vue 3 app. Full settings UI with multiple tab components. |

### Module Architecture (`src/modules/`)

The codebase follows a service-oriented architecture with clear module boundaries:

```
src/modules/
├── core/                    # Shared infrastructure
│   ├── messaging/           # MessagingService (singleton) - inter-component communication
│   ├── storage/             # StorageService (singleton) - config persistence with versioning
│   ├── translation/         # TextProcessorService, TextReplacerService, ParagraphTranslationService,
│   │                        #   LanguageService, PromptService
│   └── i18n/                # Internationalization setup
├── api/                     # AI translation backend
│   ├── factory/             # ApiServiceFactory - creates provider by config type
│   ├── providers/           # OpenAIProvider, GoogleGeminiProvider (extend BaseProvider)
│   ├── services/            # UniversalApiService - unified API with retry logic
│   └── utils/               # Request helpers, structured text parser
├── content/                 # Content script services
│   ├── ContentManager.ts    # Main coordinator - owns all content-side services
│   ├── ConfigurationService # Loads and watches user config
│   ├── ProcessingService    # Triggers translation pipeline
│   ├── ListenerService      # DOM mutation and message listeners
│   ├── LazyLoadingService   # IntersectionObserver-based lazy translation
│   └── utils/               # domUtils, SegmentObserver
├── processing/              # Translation pipeline
│   ├── ContentSegmenter     # Splits page into translatable segments
│   ├── ProcessingCoordinator # Orchestrates segment processing
│   └── ProcessingStateManager # Tracks what's been processed
├── pronunciation/           # Pronunciation ecosystem
│   ├── services/            # PronunciationService, TTSService
│   ├── phonetic/            # PhoneticProviderFactory, DictionaryApiProvider
│   ├── tts/                 # TTSProviderFactory, YoudaoTTSProvider, WebSpeechTTSProvider
│   └── translation/         # AITranslationProvider (AI definitions)
├── background/services/     # ApiProxyService, NotificationService, CommandService,
│                            #   InitializationService, UpdateCheckService
├── floatingBall/            # FloatingBallManager - configurable floating UI widget
├── contextMenu/             # ContextMenuManager - browser right-click menu
├── infrastructure/ratelimit/ # RateLimiterService
├── shared/                  # Shared types, constants, utils
│   ├── types/               # storage.ts, core.ts, api.ts, ui.ts
│   └── constants/defaults.ts # Default configuration values
└── styles/                  # Component styles, themes, constants
```

### Data Flow

```
User Settings (Popup/Options)
  → MessagingService → Background Script → StorageService
  → MessagingService → Content Script → ContentManager
  → ProcessingCoordinator → ContentSegmenter → ApiServiceFactory → Provider
  → TextReplacerService → DOM injection
```

### Key Design Patterns

- **Singleton services**: StorageService, MessagingService, all background services. Instantiated once and shared.
- **Factory pattern**: `ApiServiceFactory` (selects OpenAI/Gemini provider), `PhoneticProviderFactory`, `TTSProviderFactory`. Adding a new provider means implementing the interface and registering in the factory.
- **Event-driven messaging**: `MessagingService` wraps `browser.runtime.sendMessage` / `browser.tabs.sendMessage`. Message types defined in `core/messaging/types.ts` (e.g., `SETTINGS_UPDATED`, `WEBSITE_MANAGEMENT_UPDATED`, `CONTEXT_MENU_ACTION`).

### Content Script Pipeline

`ContentManager` is the root coordinator in the content script. It initializes:
1. `ConfigurationService` - loads user settings from storage
2. `ListenerService` - watches for DOM mutations and incoming messages
3. `ProcessingService` - when triggered, uses `ContentSegmenter` to split visible text into segments, then `ProcessingCoordinator` sends them through the API for translation
4. `LazyLoadingService` - uses IntersectionObserver to translate only visible segments
5. `TextReplacerService` - uses Range API to safely replace text nodes in the DOM

### Browser-Specific Notes

- Firefox requires explicit addon ID in manifest (`browser_specific_settings.gecko.id` in `wxt.config.ts`)
- Firefox uses MV2; Chrome/Edge use MV3
- Production builds strip `console.log` and `console.warn` via `vite-plugin-remove-console`

### i18n

5 UI languages supported. Locale files in `src/i18n/locales/`. Uses `@intlify/unplugin-vue-i18n` for compile-time optimization. All user-facing strings must go through Vue I18n.

### UI Stack

Tailwind CSS v4 + Reka UI (headless components) + Lucide icons. Shared UI components live in `entrypoints/options/components/ui/`. Styles in `src/modules/styles/`.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
