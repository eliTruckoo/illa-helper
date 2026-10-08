# Resource & API-Cost Audit — illa-helper

**Date:** 2026-10-08 · **Scope:** whole extension (content script, processing pipeline, API layer, background service worker, storage/messaging, in-page UI, popup/options) · **Method:** six parallel code-reading audits, key claims re-verified against source. No runtime profiling was done; items marked _unverified_ need a measurement.

**Status:** all findings implemented and merged — see sections 9–10. Issues are tracked in beads (`bd show <id>`). Epics: **`illa-helper-ei3`** (freezes), **`illa-helper-bfn`** (memory & lifecycle), **`illa-helper-eq7`** (API cost / dedup).

---

## 1. Executive summary

**Is it well optimized? No.** The extension does a lot of synchronous, page-wide work on the main thread, has no global limit on concurrent API requests, no request timeout, and keeps references to page DOM forever. Several of these together explain "the PC gets stuck sometimes":

| #   | Most likely freeze causes                                                                                                                                                                                                                                                      | Bead             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | `DomWalker` scans the **entire `document.body` synchronously** — per element `getComputedStyle` ×2, subtree `textContent`, `closest()` with 18 selectors, attribute writes interleaved with style reads (layout thrashing). Runs even in lazy mode.                            | `ei3.1`          |
| 2   | In **paragraph mode**, every DOM-mutation batch re-runs a **full-page scan once per changed node** (20 new feed items → 20 full scans).                                                                                                                                        | `ei3.2`          |
| 3   | `detectPageLanguage()` reads **`document.body.innerText`** (forces full layout) on every page load and on _every paragraph_.                                                                                                                                                   | `ei3.3`          |
| 4   | **Web Speech TTS is initialised on every page load** (`getVoices()` in constructor). On Linux this can spawn/poke `speech-dispatcher`, a known source of system-wide stalls. _Unverified on your machine_ — check `pgrep -a speech-dispatcher` and its CPU while opening tabs. | `ei3.5`          |
| 5   | **No global concurrency cap**: 8 parallel requests per tab, no check for hidden tabs → session restore with 10 tabs ≈ 80 concurrent fetches + DOM work.                                                                                                                        | `ei3.6`          |
| 6   | **No default timeout** (`apiRequestTimeout: 0`) and a **null-deref in the background proxy callback** → a hung request leaves the MutationObserver disconnected and lazy loading dead for that tab.                                                                            | `ei3.7`, `ei3.8` |
| 7   | MutationObserver debounce **resets forever** on busy pages while its node `Set` grows unbounded.                                                                                                                                                                               | `ei3.4`          |

**About the cost question ("same word translated many times"):** a word that appears many times does **not** trigger one request per occurrence today. The unit sent to the LLM is a _segment_ (one paragraph, ≤ 400 chars). The real waste is:

1. **The ~400–600-token system prompt is re-sent with every ~100-token segment** → 75–85 % of input tokens are prompt overhead (`eq7.3`, `eq7.4`).
2. **No in-flight dedup** — identical segments in the same batch each get their own request (`eq7.2`).
3. **No cache across reloads, tabs or pages** — a reload re-bills the whole page (`eq7.6`).
4. **Failures are cached as empty results**, so users reload and pay again (`eq7.1`, P0, blocks all cache work).
5. Repeated words cost **output tokens** inside requests that happen anyway (addressed by the optional glossary, `eq7.11`).

Estimated for a 3 000-word article on defaults (gpt-4o-mini, rate 0.3, lazy on): **~70 requests, ~43 k tokens** (~26 k of which is the repeated system prompt). Batching 8 segments/request → **~9 requests, ~54 % fewer tokens, ~35 % lower cost**; a persistent cache makes reloads/revisits **free**. _All figures are code-reading estimates — instrument first (`eq7.10`)._

---

## 2. How the pipeline works today (verified)

```
ContentManager.init
  └─ ProcessingService.processRoot(document.body)          ProcessingService.ts:59,74
       └─ DomWalker → ContentSegmenter (20–400 chars, merge <40)   ContentSegmenter.ts:39-84,153-181
       └─ new ProcessingCoordinator()  (one per call!)       ProcessingService.ts:131
            └─ batches of 8 concurrent segments              ProcessingCoordinator.ts:165-179
                 └─ TextReplacerService.replaceText(segment) TextReplacerService.ts:171-196
                      ├─ per-tab cache: 32-bit hash, 100 entries FIFO, written AFTER await
                      └─ provider.analyzeFullText            system prompt + "Translate to X (original||translation): <text>"
                           ├─ OpenAI-compatible → runtime.sendMessage → ApiProxyService (background fetch)
                           └─ Gemini → SDK called directly from the content script
       ← lines "original||translation" → addPositionsToReplacements → ReplacementBudget → Range wrap
```

- Rate limiter exists but is **off by default** (`requestsPerSecond: 0` → `enabled: false`, `RateLimiterService.ts:130`) and lives per content script.
- `ApiProxyService` defines `defaultTimeout`, `maxRetries`, `retryDelay` (`ApiProxyService.ts:19-21`) — **none are used**. No retries anywhere (no retry storms, but also no recovery).
- Existing caches are all in-memory per tab: segment results (100), AI hover definitions (500, 24 h), phonetics (1000, 24 h). Paragraph mode has **no cache**.

---

## 3. Findings — freezes / CPU (epic `illa-helper-ei3`)

| Sev    | Bead     | Finding                                                                                                                                                                                        | Evidence                                                                                                                                     | Fix                                                                                                                                                   |
| ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | `ei3.1`  | Full-body DomWalker scan in one long task                                                                                                                                                      | `ProcessingService.ts:59,74`; `DomWalker.ts:73,78,176-228,263`; `DomTranslationPolicy.ts:74-85,112-127`                                      | Single pass, WeakMap style cache, no attribute labelling, TreeWalker `FILTER_REJECT`, time-slice with `scheduler.yield()`, viewport-only in lazy mode |
| **P0** | `ei3.2`  | Paragraph mode: `start()` (full scan) per mutated node                                                                                                                                         | `ListenerService.ts:256-258,276-278`; `ParagraphTranslationService.ts:105-121`; O(P²) `ParagraphTranslationSelection.ts:80-82`               | One scoped scan per debounce batch                                                                                                                    |
| P1     | `ei3.3`  | `document.body.innerText` on load + per paragraph                                                                                                                                              | `LanguageService.ts:227`; `ContentManager.ts:318`; `ParagraphTranslationApi.ts:69`                                                           | `<html lang>` → small `textContent` sample, cache per page, skip when target known                                                                    |
| P1     | `ei3.4`  | Debounce starvation, unbounded node Set, heavy callback, observer disconnected across `await`                                                                                                  | `ListenerService.ts:192,223-271`; `DomTranslationPolicy.ts:99-104`                                                                           | maxWait, size cap, cheap callback, no disconnect across await                                                                                         |
| P1     | `ei3.5`  | Web Speech init on every page (speech-dispatcher on Linux)                                                                                                                                     | `PronunciationService.ts:38-43`; `WebSpeechTTSProvider.ts:27,47,54-57`                                                                       | Lazy provider creation on first `speak()`                                                                                                             |
| P1     | `ei3.6`  | No global concurrency cap; hidden tabs translate                                                                                                                                               | `ProcessingCoordinator.ts:165`; `RateLimiterService.ts:130`; no `visibilitychange` anywhere                                                  | Background semaphore (3–4), active tab first, defer hidden tabs                                                                                       |
| P1     | `ei3.7`  | No default timeout, no cancellation                                                                                                                                                            | `defaults.ts:91`; `src/utils/index.ts:81-82`; `ApiProxyService.ts:19-21`                                                                     | 30 s default, AbortController, per-tab port abort on disconnect                                                                                       |
| P1     | `ei3.8`  | Proxy promise never settles if `response` is undefined                                                                                                                                         | `requestUtils.ts:43` (`response.success` without guard)                                                                                      | `await sendMessage` + try/catch + null guard; test Firefox                                                                                            |
| P2     | `ei3.9`  | `getUserSettings()` = storage.sync IPC + JSON round-trip on hot paths (per request, per paragraph ×2, **per word mouseenter**), can write on read, returns shared defaults by reference        | `StorageService.ts:147-176,538-543`; `TooltipInteractionController.ts:181,216,670`; `UniversalApiService.ts:425`                             | In-memory cache + `storage.onChanged` invalidation                                                                                                    |
| P2     | `ei3.10` | Main stylesheet injected 3× (per-instance guard); global `@keyframes spin`                                                                                                                     | `StyleManager.ts:75-85`; `ContentManager.ts:342`; `TextReplacerService.ts:66`; `ParagraphTranslationService.ts:57`                           | Module-level guard / adopted sheet; prefix keyframes                                                                                                  |
| P2     | `ei3.11` | Paint cost: `backdrop-filter: blur(40px)`, infinite shimmer never replaced on error, `filter: blur` per word in learning style, infinite floating-ball pulse, non-passive document `touchmove` | `styles/components/tooltip.ts:42-45,91-92`; `TooltipInteractionController.ts:545-547`; `base.ts:31-51`; `FloatingBallManager.ts:607,802-826` | Remove blur, static loader + error state, cheaper concealment, hover-only animation                                                                   |
| P2     | `ei3.12` | `generateDomPath` O(siblings) per level                                                                                                                                                        | `ProcessingStateManager.ts:107-110`                                                                                                          | WeakMap identity                                                                                                                                      |

**No self-triggering mutation loop was found** — injected nodes are marked synchronously (`data-wxt-*`, `.wxt-translation-term`) before the observer callback runs. **Iframes are not a multiplier** — the content script runs top-frame only (WXT defaults). **Production builds do strip `console.log/warn`** (`wxt.config.ts:68-70`).

---

## 4. Findings — memory & lifecycle (epic `illa-helper-bfn`)

| Sev | Bead    | Finding                                                                                                                                                                                                                                                                               | Evidence                                                                                           |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P1  | `bfn.1` | `SegmentObserver.segmentMap` / `processedSegments` never pruned, elements never `unobserve()`d → detached DOM retained on feeds. **Also a correctness bug:** map keyed by element, so sub-segments of a split long paragraph overwrite each other (only the last part is translated). | `SegmentObserver.ts:29,111`; `LazyLoadingService.ts:56,170,254-256`                                |
| P1  | `bfn.2` | Pronunciation registry `Map<HTMLElement>` with 2 closures per word, never unregistered; every tooltip show iterates the whole map + `querySelectorAll`                                                                                                                                | `TooltipInteractionController.ts:39-91,195-201,321-338,629-633`                                    |
| P2  | `bfn.3` | No `ctx.onInvalidated` → orphaned scripts after update keep observers running; `beforeunload` kills Firefox bfcache; `destroy()` incomplete                                                                                                                                           | `entrypoints/content.ts:12,24`; `ContentManager.ts:262-270`                                        |
| P2  | `bfn.4` | Disabled/blacklisted pages still do 2 storage IPCs + wake the SW before the `isEnabled` check                                                                                                                                                                                         | `ContentManager.ts:220-246,303-307`                                                                |
| P2  | `bfn.5` | GitHub update check on **every MV3 SW cold start** (every page load wakes it); `lastUpdateCheck` stored but never used                                                                                                                                                                | `UpdateCheckService.ts:68-77,414`; `background.ts:269`                                             |
| P2  | `bfn.6` | Context menu recomputed (~9 IPCs) on `title` change of **any** tab; listeners registered only in `onInstalled` → lost after SW restart                                                                                                                                                | `ContextMenuManager.ts:394-452`; `InitializationService.ts:51-52`                                  |
| P2  | `bfn.7` | Options page writes full settings to `storage.sync` on every keystroke/slider tick (no debounce, fires on mount) → can exceed sync quotas, silently losing settings                                                                                                                   | `BasicSettings.vue:588-603`; `AppearanceSettings.vue:143-153`; `TranslationSettings.vue:1125-1137` |
| P3  | `bfn.8` | Floating ball: dead click after re-enable; duplicate menu handlers                                                                                                                                                                                                                    | `FloatingBallManager.ts:114-127,1243-1246,1397,1624`                                               |

Not a problem: the popup (no polling; 200 ms debounced save), background message handlers (`return true` used correctly), no `createObjectURL` leaks.

---

## 5. API cost & deduplication (epic `illa-helper-eq7`)

### 5.1 Where the money goes

| Component                                            | Tokens / request | Share                |
| ---------------------------------------------------- | ---------------- | -------------------- |
| System prompt (`PromptService.ts:23-117`)            | ~400–600         | **75–85 % of input** |
| User prefix + segment text (≤ 400 chars)             | ~100             | 15–25 %              |
| Output (`original\|\|translation` lines at rate 0.3) | ~125–200         | —                    |

The prompt is **below OpenAI's 1 024-token automatic prompt-cache threshold**, so the provider never discounts it. Requests sent after the page's replacement budget is exhausted are still made and then discarded (`ProcessingCoordinator.ts:176` vs `:330`). No `max_tokens` is set.

### 5.2 Approaches researched (two independent agents)

| ID  | Approach                                                                                                                                                                                                                        | Saves                                                                                           | Complexity  | Risk                                                           | Bead                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------- | ---------------------------------- |
| —   | **Stop caching failures**; distinguish `ok` / `empty` / `error`; retry 408/429/5xx with backoff                                                                                                                                 | prevents re-billing on reload                                                                   | S           | none                                                           | **`eq7.1` (P0, blocks all below)** |
| A1  | **In-page segment cache done right**: full key (provider + model + prompt hash + level + rate + target + normalized text), LRU, **in-flight `Map<key, Promise>` coalescing**, store pairs only and recompute positions per node | 0–5 % articles, 10–40 % SPA feeds, 20–50 % listings                                             | S (~80 LOC) | none                                                           | `eq7.2`                            |
| A3  | **Batch 6–10 segments per request** (`<1>…</1>` in, `n\|orig\|\|trans` out) with exact dedup inside the batch; then relax `mergeSmallSegments`, which currently _prevents_ exact dedup                                          | **~70 % input tokens, ~35 % total cost**, 5–10× fewer requests                                  | M–L         | item-ID confusion, rate adherence; needs quality check         | `eq7.3`                            |
| —   | Shorter prompt, "at most N lines", `max_tokens`, skip when budget exhausted, thinking off                                                                                                                                       | 10–30 % (est.)                                                                                  | S           | low                                                            | `eq7.4`                            |
| B1  | **Persistent cross-tab translation memory** in background IndexedDB: `sha256(configFingerprint + normText)` → pairs; L1 Map; TTL 30 d / 3 d for empty; ~20 k entries ≈ 8 MB; incognito = memory only                            | **~100 % on reload/back/session restore**, 30–70 % revisited feeds, 5–20 % same-site navigation | M           | stale if fingerprint incomplete → include actual prompt string | `eq7.6`                            |
| —   | Route Gemini through background (it bypasses the proxy today; also shrinks content bundle)                                                                                                                                      | enables B1 + global cap for Gemini                                                              | M           | —                                                              | `eq7.5`                            |
| B2a | Persist hover definitions; in-flight dedup + negative cache for definitions & dictionary 404s                                                                                                                                   | high for hover users                                                                            | S           | —                                                              | `eq7.7`                            |
| A2  | **Page glossary** (opt-in): reuse exact-surface-form translations locally + per-segment hint "already handled, don't output: w1, w2"                                                                                            | 10–30 % output tokens; consistency                                                              | M           | polysemy, inflection, CJK substrings                           | `eq7.11`                           |
| A4  | Economy mode: skip LLM when glossary already fills the segment's quota                                                                                                                                                          | only at low rates                                                                               | S           | fewer new words (pedagogy)                                     | `eq7.12`                           |
| B2b | Inject user glossary into every prompt                                                                                                                                                                                          | **negative** (adds input tokens)                                                                | —           | —                                                              | _rejected_                         |
| B2c | Global local-only word replacement without LLM                                                                                                                                                                                  | low; breaks i+1 word choice                                                                     | L           | high                                                           | _rejected_                         |

### 5.3 Recommended cache design (A1 + B1 combined)

```ts
// L0: TextReplacerService (per tab)  → L1: background Map → L2: background IndexedDB
key = sha256(fingerprint + '\n' + normalize(text))          // hashed in background (crypto.subtle
                                                            // is unavailable on http:// pages)
fingerprint = sha256(JSON.stringify({
  schema: TM_SCHEMA_VERSION, provider, endpointOrigin, model, temperature,
  customParams, thinking, systemPrompt: getSystemPromptByConfig(...), userPrefix,
}))                                                         // prompt edits auto-invalidate
normalize = s => s.normalize('NFC').replace(/[​-‍﻿]/g, '')
                  .replace(/\s+/g, ' ').trim()              // key only; LLM still gets raw text

processTranslation(text):
  if (L0.has(k)) return withPositions(L0.get(k), text)
  if (inflight.has(k)) return withPositions(await inflight.get(k), text)
  hit = await tm.lookup(fp, [text])                         // batched per coordinator batch
  if (hit) return withPositions(hit.pairs, text)
  res = await callTranslationAPI(text)
  if (res.status !== 'error') { L0.set(k, res.pairs); tm.store(fp, text, res) }
```

Store **pairs only** (`[original, translation][]`) and recompute positions with `addPositionsToReplacements(text, pairs)` so a cached result applies to any DOM node with the same text. If the glossary hint (A2) is ever used, store the _combined_ final pair list, not the hinted raw response.

Privacy: values contain short page fragments (word pairs), keys are hashes; incognito tabs never write to disk; add stats/toggle/clear in Options → Data (`eq7.13`).

---

## 6. Implementation roadmap

**Phase 0 — stop the freezes (do first, mostly small)**
`ei3.5` lazy TTS · `ei3.3` cheap language detection · `ei3.2` paragraph-mode mutation path · `ei3.8` + `ei3.7` proxy null-guard & 30 s timeout · `ei3.4` debounce maxWait · `ei3.9` settings cache · `ei3.10` single stylesheet

**Phase 1 — correctness that cost depends on**
`eq7.1` don't cache errors (P0) · `eq7.10` instrumentation (requests, tokens, dup rate) · `eq7.2` proper in-page cache + in-flight dedup

**Phase 2 — the big main-thread and cost wins**
`ei3.1` DomWalker rewrite (time-sliced, viewport-scoped) · `eq7.3` batching · `eq7.4` prompt/output caps · `ei3.6` global concurrency + hidden-tab deferral (after `eq7.5`)

**Phase 3 — persistence**
`eq7.5` Gemini via background → `eq7.6` translation memory → `eq7.7` hover cache → `eq7.13` cache UI · `eq7.8` paragraph-mode cache

**Phase 4 — memory & lifecycle hygiene**
`bfn.1` – `bfn.8`, `ei3.11`, `ei3.12`, `eq7.9`

**Optional / learning features**
`eq7.11` glossary · `eq7.12` economy mode · `eq7.14` exposure tracking

Dependency edges in beads: `eq7.1` blocks `eq7.2`, `eq7.3`, `eq7.6`; `eq7.2` blocks `eq7.6`, `eq7.8`, `eq7.11`; `eq7.5` blocks `eq7.6`, `ei3.6`; `eq7.6` blocks `eq7.7`, `eq7.13`, `eq7.14`; `eq7.10` blocks `eq7.11`; `eq7.11` blocks `eq7.12`. Run `bd ready` for the current unblocked set.

---

## 7. How to confirm the freeze cause on your machine

1. **Chrome Task Manager** (Shift+Esc): watch per-tab CPU/memory on a long-lived feed tab (Reddit/Twitter) with the extension active vs. disabled.
2. **Linux**: `pgrep -a speech-dispatcher; top -p $(pgrep -d, speech-dispatcher)` while opening several tabs (→ `ei3.5`).
3. **Performance panel**: record a page load on a long Wikipedia article → look for a multi-second task in `walkAndLabel`/`getComputedStyle` (→ `ei3.1`), and record hovering translated words (→ `ei3.9`, `ei3.11`).
4. **Memory panel**: heap snapshot after 10 min of scrolling a feed, filter "Detached" (→ `bfn.1`, `bfn.2`).
5. Check whether you use **paragraph mode** or **automatic trigger** — those paths are the most expensive (`ei3.2`).

---

## 8. Unverified items

- speech-dispatcher stalls (`ei3.5`) — plausible, not measured.
- Firefox behaviour of the callback form of `browser.runtime.sendMessage` (`ei3.8`).
- Overlapping segments from nested inline paragraphs (`eq7.9`) — inferred from code.
- Paint cost of the blur effects (`ei3.11`).
- All savings percentages and token counts — estimates from code + default config; validate with `eq7.10` (`[TranslationStats]` console line).

---

## 9. Implementation status (2026-10-08)

All 34 beads were implemented in parallel git worktrees and merged into `master`. Every merge passed `npm run compile`, lint and `npm run test:regression` (six suites); the final state also builds for Chrome MV3 and Firefox MV2. **Nothing has been verified in a real browser yet** — tracked as `illa-helper-tsk`.

| Track                      | Merge     | Beads                                 | Summary                                                                                                                                                                                                                                                                                 |
| -------------------------- | --------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C — API cost core          | `fb9152e` | eq7.1–.4, eq7.10, ei3.6 (per tab)     | `ok`/`empty`/`error` status, errors never cached; LRU segment cache with full key + in-flight coalescing; batches of ≤ 8 items / 2 500 chars; prompt ~600 chars, line limit + `max_tokens`, no calls after budget is exhausted; per-tab `TranslationStats`                              |
| A — content pipeline       | `9dbc0d9` | ei3.1–.4, ei3.12, bfn.1, eq7.8, eq7.9 | Single-pass time-sliced DomWalker without DOM labelling; `<html lang>` language detection, cached; scoped paragraph rescans; debounce with 750 ms max-wait and capped node set; SegmentObserver releases processed segments; small segments no longer merged                            |
| F — lifecycle & background | `bb7d63e` | bfn.3–.7                              | `ctx.onInvalidated` teardown, no `beforeunload`; enabled/blacklist check before any IPC; update check via `browser.alarms` once per 24 h; context menu listeners at top level, active tab only, diffed updates; debounced options/popup saves                                           |
| B — network                | `507c176` | ei3.6–.8, eq7.5                       | No-hang proxy replies; 30 s default timeout, per-tab cancellation, retries only for 408/429/5xx with backoff + `Retry-After`; global priority limiter (4, active tab first); Gemini via background REST, SDK removed                                                                    |
| E — UI & pronunciation     | `63d28ed` | ei3.5, ei3.9–.11, bfn.2, bfn.8        | Lazy TTS (no `speechSynthesis` until first play); in-memory settings cache with `storage.onChanged`; delegated tooltip listeners, WeakMap data; stylesheet injected once; no `backdrop-filter`/infinite shimmer/per-word blur; floating-ball fixes; hover lookup dedup + negative cache |
| G — glossary (opt-in)      | `aa41205` | eq7.11, eq7.12                        | Page glossary with prompt hint and economy mode, all off by default                                                                                                                                                                                                                     |
| D — persistence            | `d3d4295` | eq7.6, eq7.7, eq7.13, eq7.14          | Background IndexedDB translation memory (segments, paragraphs, hover definitions), incognito memory-only, options card with stats/toggle/clear, word exposure counts                                                                                                                    |

Follow-ups on master: `98c35de` (await segmentation), `0345e46` (remove message listener + abort requests on teardown), `2bb3806` (migrate stored `apiRequestTimeout: 0` to 30 s; eslint ignores `.claude/**`).

## 10. Browser verification checklist (`illa-helper-tsk`)

**Freezes / CPU**

- Long Wikipedia article: Performance panel shows no long task from the DomWalker; paragraphs/translations unchanged.
- Feeds (Reddit/Twitter), word + paragraph mode, lazy on/off: new items translated within ~750 ms, no duplicates, no full-page rescans per item.
- Linux: `speech-dispatcher` does not start until the first pronunciation playback.
- Session restore with many tabs: ≤ 4 concurrent upstream requests, active tab first.
- Stalled endpoint: request fails after 30 s (408); navigating away aborts in-flight fetches.

**Cost**

- `[TranslationStats]` console line (dev build): requests per page ~5–10× lower than before; check batch output quality and rate adherence.
- Reload a translated page → 0 API requests; also after stopping the service worker; model/level change → fresh translation.
- Incognito: works, nothing persisted. Options → Data Management: stats load, clear/toggle work.
- Hover the same word in two tabs → one definition request.
- OpenAI-compatible endpoints accept `max_tokens`; Gemini end-to-end (word mode, connection test, definitions, bad-key error) on Chrome and Firefox.
- Glossary (opt-in): reused translations consistent, never inside longer words, never on CJK pages; measure wrong-sense rate before enabling by default.

**Lifecycle / UI**

- Reload the extension with open tabs: old scripts stop, translations stay.
- Firefox back/forward restores from bfcache.
- Options sliders/inputs save once ~400 ms after the last change; closing right after an edit persists it.
- Context menu correct and clickable after a service-worker restart.
- Tooltips (hotkey on/off, nested phrase tooltips, links), learning-mode mask, floating ball (hover pulse, drag with mouse/touch, disable → enable → click, each menu action fires once), Youdao/Web Speech stop without fallback voice.
- Pages with a wrong `<html lang>` now pick the wrong direction (known trade-off).
