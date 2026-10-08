# Elilla Assistant Privacy Policy

_Last updated: 2026-10-08_

Elilla Assistant is a browser extension that replaces words on web pages with translations to help you learn a language. This policy explains what data the extension handles and where it goes.

## Summary

- The developer does not run any server and does not collect, receive, sell or share your data.
- There is no analytics, tracking or advertising.
- Text from the pages you translate is sent directly from your browser to the AI provider **you** configure, using **your** API key.

## Data sent to third parties

The extension only sends data when you use a feature that needs it:

| Data | Sent to | When |
|---|---|---|
| Text from the web page you are viewing, and your target-language settings | The AI translation provider you configure (for example OpenAI, Google Gemini, DeepSeek, SiliconFlow, or any custom OpenAI-compatible endpoint) | When a page or paragraph is translated, or a word definition is requested |
| Single words (never the address of the page) | Free Dictionary API (`api.dictionaryapi.dev`) | When phonetic notation is shown for a word |
| Single words | Youdao Dictionary (`dict.youdao.com`) | When you play a pronunciation with the Youdao voice selected. Like any audio a page loads, your browser may also send the site's domain (not the full address). The browser's built-in voice is used instead if you choose "Web Speech" |
| No personal data (a standard version request) | GitHub API (`api.github.com`) | Chrome and Edge builds only: once a day, to check whether a new version has been released. The Firefox version never contacts GitHub; Firefox Add-ons handles its updates |

Each provider handles that data under its own privacy policy. Check the policy of the AI provider you use before entering its API key.

## Data stored in your browser

- **Settings, including your API keys**, are saved in the browser's extension storage (`storage.sync`). If browser sync is turned on, your browser vendor syncs them between your devices. They are never sent to the developer.
- **Translation cache, word definitions and word-exposure history** are stored locally in the extension's own storage and IndexedDB, so repeated translations don't call the API again. You can view and clear the cache on the Data Management page in the settings.

Uninstalling the extension deletes its local data.

## Permissions

- **Access to all websites**: needed to read and replace text on the pages you browse.
- **Storage**: saves your settings and the translation cache.
- **Context menus, notifications, alarms, web navigation, active tab**: power the right-click menu, error and update notices, the daily update check (Chrome and Edge builds only), and per-site rules.

## Children

The extension is not directed at children under 13 and does not knowingly collect their data.

## Changes and contact

Changes to this policy are published in this file in the [project repository](https://github.com/eliTruckoo/illa-helper). For questions, open an issue at <https://github.com/eliTruckoo/illa-helper/issues>.
