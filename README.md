# Elilla Assistant

<div align="center">
<img src="public/icon/128.png" width="100" height="100" />

[![License](https://img.shields.io/github/license/eliTruckoo/illa-helper?style=flat-square&color=42c88c)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/eliTruckoo/illa-helper?style=flat-square&color=blueviolet)](https://github.com/eliTruckoo/illa-helper/releases)

</div>

A Firefox extension for learning a language while you browse. It replaces some of the words on a page with translations chosen for your level, based on the "comprehensible input" (i+1) idea: text a little above your level, not too far above it.

Elilla Assistant is a fork of [illa-helper](https://github.com/xiao-zaiyi/illa-helper) by Xiao Zaiyi.

## What this fork does differently

The fork reworks how illa-helper uses the API and the browser: fewer, cheaper AI requests, and no more freezing tabs.

Compared with upstream illa-helper v1.8.2 on two long Wikipedia articles (`npm run bench:tokens`, gpt-4o-mini prices):

| Page view                         | Requests     | Tokens       | API cost     |
| --------------------------------- | ------------ | ------------ | ------------ |
| First visit                       | −46 to −86 % | −51 to −65 % | −25 to −37 % |
| Revisit, 10 % of the content new  | −90 %        | −95 %        | −93 %        |
| Reload or revisit, unchanged page | none         | none         | free         |

The first-visit ranges cover 2 to 8 paragraphs per request, depending on how many come into view at once. When paragraphs arrive one at a time, the number of requests stays about the same, but cost still drops by a third. The benchmark simulates the model's answers instead of calling a real API.

**Lower API cost**

- Up to 8 paragraphs go into one request, with a system prompt a third to half of the old size.
- Each paragraph gets a word limit and an output cap, so the model doesn't return more than gets used.
- Repeated paragraphs are translated once; nothing is requested once the page's word budget is used up.
- Failed requests are never cached, so a reload after an error doesn't pay twice.

**Translation memory**

- Translations and word definitions are stored on your device for 30 days and shared across tabs, so reloads, back navigation and session restore cost nothing.
- Options → Data Management shows cache stats and lets you turn the memory off or clear it. Incognito tabs keep it in memory only.

**No more freezes**

- The page scan runs in small chunks instead of blocking the tab.
- Language detection no longer forces a layout of the whole page.
- On feeds, only new content is rescanned.
- At most 4 requests run at once across all tabs, with the active tab first.
- Requests time out after 30 s, and only rate-limit and server errors are retried.

**Lighter tabs**

- Memory is released on long-lived and single-page-app tabs.
- The speech engine starts only on the first playback.
- The stylesheet is added once per page, and tooltips are cheaper to draw.
- No GitHub update check in Firefox builds; Firefox Add-ons handles updates.

**Changed features**

- The popup has a "Don't translate this site" button; model settings moved to Options.
- Hidden display mode drops the parentheses and shows the original word on hover.
- Paragraph mode respects the replacement rate.
- New opt-in Page Glossary and Economy Mode reuse translations already on the page to save more tokens.
- Gemini requests now go through the background, like every other provider.
- The interface is English-only, and the extension is published for Firefox only.

The full audit and implementation status are in [docs/RESOURCE_AUDIT.md](./docs/RESOURCE_AUDIT.md).

<div align="center">
  <img src="images/Demo.gif" alt="Translated words on a web page with a pronunciation tooltip" style="max-width:80%; border-radius:8px"/>
</div>

## Install

**Firefox Add-ons:** listing coming soon. Until then, download the latest package from [GitHub Releases](https://github.com/eliTruckoo/illa-helper/releases) or [build it from source](#build-from-source).

Requires Firefox 140 or newer and an API key for an OpenAI-compatible service (OpenAI, DeepSeek, SiliconFlow, …) or Google Gemini. Enter the key in Options after installing.

## Features

- Replaces 1–100 % of the words on a page with translations picked for your level (A1–C2) and context, into 20+ target languages (quality depends on the model).
- Word mode or whole-paragraph translation, translated as you scroll.
- Several display styles, including a learning mode that hides each translation until you hover it.
- Hover tooltips with phonetics, AI definitions and pronunciation (Youdao TTS or the browser's speech engine).
- Floating button, context menu, keyboard shortcuts, site blacklist and whitelist, multiple API configurations, settings import and export.

## Privacy

- The text of the paragraphs being translated, and words you hover for AI definitions, are sent to the API you configure.
- Words you hover are sent to dictionaryapi.dev for phonetics (without the page address), and to Youdao when you play their pronunciation.
- The extension never contacts GitHub or the developer; Firefox Add-ons handles updates.
- Translations, definitions and word counts stay on your device and can be cleared in Options → Data Management. The cache settings are not part of settings exports.

The full policy is in [PRIVACY.md](./PRIVACY.md).

## Build from source

Requires Node.js 18 or newer.

```bash
git clone https://github.com/eliTruckoo/illa-helper.git
cd illa-helper
npm install
npm run build:firefox      # output: .output/firefox-mv2
npm run zip:firefox        # zip for Firefox Add-ons
```

To load it, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and select `.output/firefox-mv2/manifest.json`. Firefox removes temporary add-ons when it restarts. `npm run dev:firefox` starts a dev build with hot reload.

Optional: copy `.env.example` to `.env` to pre-fill the API endpoint, key and model. These values are compiled into the bundle, so keep the key empty in builds you share.

The code still builds for Chrome and Edge (`npm run build`, output `.output/chrome-mv3`), but releases target Firefox only.

## Development

```bash
npm run compile            # type check
npm run lint               # ESLint
npm run test:regression    # regression suites (Node + linkedom)
npm run bench:tokens       # token/cost benchmark against upstream
```

Architecture notes are in [docs/ARCHITECTURE_AND_FEATURES.md](./docs/ARCHITECTURE_AND_FEATURES.md). Bug reports and pull requests are welcome in [GitHub Issues](https://github.com/eliTruckoo/illa-helper/issues).

## Troubleshooting

- **Nothing gets translated:** check the API key, endpoint and model in Options, and make sure the site isn't turned off ("Don't translate this site" or the blacklist). Errors appear in the page's developer console.
- **"The storage API will not work with a temporary addon ID":** load the Firefox build (`npm run build:firefox`), which sets an add-on ID.
- **Poor translations:** adjust your level or replacement rate, use a stronger model, or set the temperature between 0.1 and 0.3.
- **Want fresh translations:** clear the translation cache in Options → Data Management. Changing the model, level, rate or prompt starts fresh automatically.

## License

[MIT](./LICENSE). Based on illa-helper by Xiao Zaiyi; the license keeps both copyright notices.
