// Word-mode token and cost benchmark: upstream baseline (2a6c3d6) vs the current pipeline.
//
// Sends real articles through
// - the upstream pipeline: frozen copy of its prompt below, one request per segment,
//   small segments merged (old ContentSegmenter default)
// - the current pipeline: PromptService, batch chunker, per-segment replacement limits,
//   exact dedup, no requests for segments without a replacement limit
// and counts tokens with o200k_base (gpt-4o-mini's tokenizer).
//
// The model answer is simulated: in both pipelines every segment returns as many picks as
// its replacement limit allows, so output differences come from the answer format alone.
// Segments follow the ContentSegmenter rules (20-400 chars); long paragraphs are split at
// sentence ends, approximating the text-node splits real HTML (links, <em>) produces.
// Wikipedia articles change over time, so absolute numbers drift slightly between runs.
//
// Revisits (reload, back, session restore, revisit within the TTL): the baseline only had a
// per-tab in-memory cache, so it pays the full first-visit price again. The current pipeline
// answers remembered segments from the persistent translation memory with one lookup per
// wave and batches only the new segments of that wave; new segments are spread over the page.
//
// Usage: npm run bench:tokens -- [options] [Wikipedia_title | file.txt ...]
//   --target <code>    target language (default de)
//   --level <1-6>      UserLevel, A1 = 1 ... C2 = 6 (default 3 = B1)
//   --rate <0-1>       replacement rate (default 0.3)
//   --price-in <usd>   input price per 1M tokens (default 0.15, gpt-4o-mini)
//   --price-out <usd>  output price per 1M tokens (default 0.6, gpt-4o-mini)
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: 'string', default: 'de' },
    level: { type: 'string', default: '3' },
    rate: { type: 'string', default: '0.3' },
    'price-in': { type: 'string', default: '0.15' },
    'price-out': { type: 'string', default: '0.6' },
  },
});

const DEFAULT_SOURCES = ['Second-language_acquisition', 'Photosynthesis'];
/** Segments handed to the coordinator at once; lazy loading drains whatever entered the viewport meanwhile */
const BATCH_FILLS = [1, 2, 3, 4, 8];
/** Share of segments that changed since the page was translated last */
const REVISIT_NEW_SHARES = [0, 0.1, 0.3];
/** Batch fill for revisits: typical lazy-loading reading */
const REVISIT_BATCH_FILL = 4;
/** Two chat messages plus reply priming */
const CHAT_OVERHEAD_TOKENS = 9;

const config = {
  targetLanguage: options.target,
  userLevel: Number(options.level),
  replacementRate: Number(options.rate),
};
const priceIn = Number(options['price-in']);
const priceOut = Number(options['price-out']);

// LanguageService reads browser APIs lazily; a minimal stub is enough for display names.
globalThis.browser = {
  runtime: {
    id: 'benchmark-tokens',
    onMessage: { addListener: () => undefined },
    sendMessage: async () => true,
  },
  storage: { sync: { get: async () => ({}), set: async () => undefined } },
};

const { promptService, getSystemPromptByConfig, getBatchSystemPromptByConfig } =
  await import('../src/modules/core/translation/PromptService.ts');
const { languageService } = await import(
  '../src/modules/core/translation/LanguageService.ts'
);
const { calculateReplacementLimit } = await import(
  '../src/modules/processing/ReplacementBudget.ts'
);
const { chunkBatchItems } = await import(
  '../src/modules/core/translation/BatchTranslationExecutor.ts'
);
const { normalizeSegmentText } = await import(
  '../src/modules/core/translation/SegmentTranslationCache.ts'
);
const { TRANSLATION_BATCH_MAX_ITEMS, TRANSLATION_BATCH_MAX_CHARS } =
  await import('../src/modules/processing/ProcessingContracts.ts');

const countTokens = (text) => encode(text).length;

// ---------- upstream baseline: frozen copy of 2a6c3d6 PromptService + OpenAIProvider user message ----------

const BASELINE_LEVEL_GUIDANCE = {
  1: 'A1 (Beginner): Select very basic words only.',
  2: 'A2 (Elementary): Select simple everyday words.',
  3: 'B1 (Intermediate): Select common phrases and verbs.',
  4: 'B2 (Upper-Intermediate): Select nuanced vocabulary.',
  5: 'C1 (Advanced): Select advanced idioms and terms.',
  6: 'C2 (Proficient): Select rare or specialized words.',
};

function baselineSystemPrompt({ targetLanguage, userLevel, replacementRate }) {
  const langName = languageService.getTargetLanguageDisplayName(targetLanguage);

  const taskAndRules = [
    `Task: User is learning ${langName}. Given any input text, intelligently select high-value words/phrases (e.g., key nouns, verbs, idioms) for learning, and provide their direct ${langName} translations.`,
    '    ',
    '## Strict Rules',
    "1. Select based on context: Prioritize words that aid learning, avoid fillers (e.g., 'a', 'the', 'is').",
    '2. Preserve original code, proper nouns, HTML tags unchanged.',
    `3. Skip any text already in ${langName}.`,
    "4. Output ONLY the selected original||translation pairs. Rigorous ban on any additions, explanations, or prefixes (e.g., no 'Here is the translation:').",
    '5. Output that does not meet the requirements, directly return the empty string.',
    '6. Consider the context of the text when translating.',
    '',
  ].join('\n');

  let ratioPart = '';
  if (replacementRate > 0 && replacementRate <= 1) {
    const percentage = Math.round(replacementRate * 100);
    const lower = Math.max(0, percentage - 3);
    const upper = Math.min(100, percentage + 3);
    ratioPart = `Select at most ~${percentage}% of the eligible words/phrases (${lower}%-${upper}% range). This is a hard upper bound: if unsure, output fewer items, not more. Focus on quality over quota; choose natural whole words/phrases.`;
  }
  const level =
    BASELINE_LEVEL_GUIDANCE[userLevel] || BASELINE_LEVEL_GUIDANCE[3];
  const userConfig = `User Level: ${level}\n${ratioPart}`.trim();

  const countHint =
    replacementRate > 0 && replacementRate <= 0.2
      ? 'For low replacement rates, output only one or two high-value items.'
      : 'Adjust the number of output lines to the configured replacement rate.';
  const examples = [
    `Examples (Target: ${langName}):`,
    '        Input: "The quick brown fox jumps over the lazy dog."',
    '        Output:',
    '        fox||translation_text',
    '        jumps||translation_text',
    '',
    `        ${countHint}`,
  ].join('\n');

  return [
    'You are an AI translator for language learners. Strictly follow instructions: select suitable words/phrases from input text based on user level and ratio, then output ONLY their translations in the specified format. No extra text allowed.',
    taskAndRules,
    userConfig,
    'MANDATORY FORMAT: Output ONLY lines of "original||translation". One per line. No JSON, quotes, extras, or other formats. Violating this will fail the task.',
    examples,
  ]
    .filter((component) => component.trim() !== '')
    .join('\n\n');
}

const baselineUserPrompt = (text) =>
  `Translate to ${languageService.getTargetLanguageDisplayName(config.targetLanguage)} (original||translation): ${text}`;

// ---------- page -> segments ----------

async function loadSource(source) {
  if (fs.existsSync(source)) {
    return { title: source, text: fs.readFileSync(source, 'utf8') };
  }
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    format: 'json',
    titles: source,
  }).toString();
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'elilla-assistant-benchmark/1.0 (local dev script)',
    },
  });
  if (!response.ok) {
    throw new Error(
      `Wikipedia request for "${source}" failed: ${response.status}`,
    );
  }
  const page = Object.values((await response.json()).query.pages)[0];
  if (!page.extract) {
    throw new Error(`Wikipedia has no article "${source}"`);
  }
  return { title: page.title, text: page.extract };
}

/** Lines as paragraphs; Wikipedia headings unwrapped, trailing reference sections dropped */
function toParagraphs(text) {
  const end = text.search(
    /\n== (See also|References|Notes|Further reading|External links) ==/,
  );
  return (end > 0 ? text.slice(0, end) : text)
    .split('\n')
    .map((line) => line.replace(/^=+\s*|\s*=+$/g, '').trim())
    .filter(Boolean);
}

function splitLongParagraph(text, maxLength = 400) {
  if (text.length <= maxLength) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const parts = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxLength) {
      parts.push(current);
      current = '';
    }
    current += sentence;
  }
  if (current) parts.push(current);
  return parts;
}

/** ContentSegmenter: drop < 20 chars, split > 400; the baseline also merged neighbours until >= 40 chars */
function toSegments(paragraphs, mergeSmallSegments) {
  const segments = paragraphs
    .filter((paragraph) => paragraph.length >= 20)
    .flatMap((paragraph) => splitLongParagraph(paragraph));
  if (!mergeSmallSegments) return segments;

  const merged = [];
  let group = [];
  segments.forEach((segment, index) => {
    group.push(segment);
    if (group.join('').length >= 40 || index === segments.length - 1) {
      merged.push(group.join(''));
      group = [];
    }
  });
  return merged;
}

// ---------- simulated model answers ----------

/** The longest distinct words, as many as the segment's replacement limit; translations of similar length */
function simulatedPicks(text) {
  const limit = calculateReplacementLimit(text, config.replacementRate) ?? 0;
  const words = [...new Set(text.match(/\p{L}[\p{L}'-]{3,}/gu) ?? [])];
  return words.sort((a, b) => b.length - a.length).slice(0, limit);
}

const singleAnswer = (text) =>
  simulatedPicks(text)
    .map((word) => `${word}||${word}`)
    .join('\n');

const batchItemAnswer = (text, id) => {
  const picks = simulatedPicks(text);
  return picks.length > 0
    ? picks.map((word) => `${id}|${word}||${word}`).join('\n')
    : `${id}|-`;
};

// ---------- cost models ----------

function baselineCost(segments) {
  const systemTokens = countTokens(baselineSystemPrompt(config));
  const cost = { requests: 0, input: 0, output: 0, systemTokens: 0 };
  for (const text of segments) {
    cost.requests++;
    cost.systemTokens += systemTokens;
    cost.input +=
      systemTokens +
      countTokens(baselineUserPrompt(text)) +
      CHAT_OVERHEAD_TOKENS;
    cost.output += countTokens(singleAnswer(text));
  }
  return cost;
}

/**
 * `newTexts`: segments not in the translation memory (all of them when omitted). Waves still
 * hold every visible segment; remembered ones are answered by the lookup, misses are chunked.
 */
function currentCost(segments, batchFill, newTexts) {
  const singleSystemTokens = countTokens(getSystemPromptByConfig(config));
  const batchSystemTokens = countTokens(getBatchSystemPromptByConfig(config));

  const unique = [
    ...new Map(
      segments.map((text) => [normalizeSegmentText(text), text]),
    ).values(),
  ];
  const items = unique
    .map((text) => ({
      text,
      maxItems: calculateReplacementLimit(text, config.replacementRate),
    }))
    .filter((item) => item.maxItems !== 0);

  const cost = { requests: 0, input: 0, output: 0, systemTokens: 0 };
  for (let start = 0; start < items.length; start += batchFill) {
    const misses = items
      .slice(start, start + batchFill)
      .filter((item) => !newTexts || newTexts.has(item.text));
    const chunks = chunkBatchItems(
      misses,
      TRANSLATION_BATCH_MAX_ITEMS,
      TRANSLATION_BATCH_MAX_CHARS,
    );
    for (const chunk of chunks) {
      cost.requests++;
      if (chunk.length === 1) {
        const [item] = chunk;
        cost.systemTokens += singleSystemTokens;
        cost.input +=
          singleSystemTokens +
          countTokens(promptService.getUserPrompt(item.text, item.maxItems)) +
          CHAT_OVERHEAD_TOKENS;
        cost.output += countTokens(singleAnswer(item.text));
      } else {
        cost.systemTokens += batchSystemTokens;
        cost.input +=
          batchSystemTokens +
          countTokens(promptService.getBatchUserPrompt(chunk)) +
          CHAT_OVERHEAD_TOKENS;
        cost.output += countTokens(
          chunk
            .map((item, index) => batchItemAnswer(item.text, index + 1))
            .join('\n'),
        );
      }
    }
  }
  return cost;
}

/** A reproducible scattered choice of `share` of the segments (Fisher-Yates, mulberry32 seed) */
function pickNewSegments(segments, share) {
  let seed = 0x2a6c3d6;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...segments];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return new Set(shuffled.slice(0, Math.round(segments.length * share)));
}

// ---------- report ----------

const usdPer1kPages = (cost) =>
  (cost.input * priceIn + cost.output * priceOut) / 1000;
const change = (value, base) => {
  const percent = Math.round((value / base - 1) * 100);
  return `${percent > 0 ? '+' : ''}${percent}%`;
};

function printTable(rows, baseline) {
  const header = [
    'pipeline',
    'requests',
    'input',
    'output',
    'total',
    'system share',
    'USD / 1k pages',
  ];
  const lines = rows.map(([label, cost]) => {
    const total = cost.input + cost.output;
    const usd = usdPer1kPages(cost);
    const delta = (value, base) =>
      cost === baseline ? '' : ` (${change(value, base)})`;
    return [
      label,
      `${cost.requests}${delta(cost.requests, baseline.requests)}`,
      `${cost.input}${delta(cost.input, baseline.input)}`,
      `${cost.output}${delta(cost.output, baseline.output)}`,
      `${total}${delta(total, baseline.input + baseline.output)}`,
      cost.input > 0
        ? `${Math.round((cost.systemTokens / cost.input) * 100)}%`
        : '-',
      `${usd.toFixed(2)}${delta(usd, usdPer1kPages(baseline))}`,
    ];
  });
  const widths = header.map((title, column) =>
    Math.max(title.length, ...lines.map((line) => line[column].length)),
  );
  const format = (cells) =>
    cells
      .map((cell, column) =>
        column === 0
          ? cell.padEnd(widths[column])
          : cell.padStart(widths[column]),
      )
      .join('  ');
  console.log(format(header));
  lines.forEach((line) => console.log(format(line)));
}

const languageName = languageService.getTargetLanguageDisplayName(
  config.targetLanguage,
);
console.log(
  `Target ${languageName}, level ${config.userLevel}, rate ${config.replacementRate}; ` +
    `USD ${priceIn} / ${priceOut} per 1M input / output tokens`,
);
console.log(
  `System prompt tokens: baseline ${countTokens(baselineSystemPrompt(config))}, ` +
    `current single ${countTokens(getSystemPromptByConfig(config))}, ` +
    `current batch ${countTokens(getBatchSystemPromptByConfig(config))}`,
);

for (const source of positionals.length > 0 ? positionals : DEFAULT_SOURCES) {
  const { title, text } = await loadSource(source);
  const paragraphs = toParagraphs(text);
  const words = paragraphs.join(' ').split(/\s+/).length;
  const baselineSegments = toSegments(paragraphs, true);
  const currentSegments = toSegments(paragraphs, false);
  const baseline = baselineCost(baselineSegments);

  console.log(
    `\n${title}: ${words} words, ${baselineSegments.length} baseline / ${currentSegments.length} current segments`,
  );
  printTable(
    [
      ['baseline 2a6c3d6', baseline],
      ...BATCH_FILLS.map((fill) => [
        `current, ${fill} per batch`,
        currentCost(currentSegments, fill),
      ]),
    ],
    baseline,
  );

  console.log(
    `\n${title}, revisit (current: translation memory, ${REVISIT_BATCH_FILL} per batch)`,
  );
  printTable(
    [
      ['baseline 2a6c3d6', baseline],
      ...REVISIT_NEW_SHARES.map((share) => [
        share === 0
          ? 'current, unchanged page'
          : `current, ${share * 100}% new`,
        currentCost(
          currentSegments,
          REVISIT_BATCH_FILL,
          pickNewSegments(currentSegments, share),
        ),
      ]),
    ],
    baseline,
  );
}
