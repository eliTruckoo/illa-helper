// Regression checks for the opt-in page glossary (eq7.11) and economy mode (eq7.12).
// Imported from regression-main.mjs, which sets up the linkedom DOM globals.
import assert from 'node:assert/strict';

const {
  PageGlossary,
  isLearnablePair,
  mergeWithGlossary,
  selectGlossaryReplacements,
  countGlossaryCoverage,
} = await import('../src/modules/processing/PageGlossary.ts');
const { indexOfWord } = await import('../src/modules/api/utils/textUtils.ts');
const { promptService, formatAlreadyHandledHint } = await import(
  '../src/modules/core/translation/PromptService.ts'
);
const { BatchTranslationExecutor, withHintPairs } = await import(
  '../src/modules/core/translation/BatchTranslationExecutor.ts'
);
const { SegmentTranslationCache, normalizeSegmentText, responseFromOutcome } =
  await import('../src/modules/core/translation/SegmentTranslationCache.ts');
const { BaseProvider } = await import(
  '../src/modules/api/base/BaseProvider.ts'
);
const { ProcessingCoordinator } = await import(
  '../src/modules/processing/ProcessingCoordinator.ts'
);
const { translationStats } = await import(
  '../src/modules/core/translation/TranslationStats.ts'
);
const { ReplacementBudget } = await import(
  '../src/modules/processing/ReplacementBudget.ts'
);

const pair = (original, translation) => ({ original, translation });
const llm = (text, original, translation, from = 0) => {
  const start = text.indexOf(original, from);
  return {
    original,
    translation,
    position: { start, end: start + original.length },
    isNew: true,
  };
};

// ---------- learn and conflict handling ----------

const glossary = new PageGlossary();
assert.equal(
  glossary.learn([
    pair('summit', 'Gipfel'),
    pair('is', 'ist'),
    pair('Berlin', 'Berlin'),
    pair('東京大学', 'Universität Tokio'),
    pair('สวัสดี', 'Hallo'),
    pair(' padded', 'gepolstert'),
    pair('2024', 'zweitausend'),
  ]),
  1,
  'Only the long, translated, space-separated word is learned',
);
assert.equal(glossary.lookup('summit'), 'Gipfel');
assert.equal(glossary.lookup('is'), undefined, 'Short words are not learned');
assert.equal(
  glossary.lookup('Berlin'),
  undefined,
  'original === translation is not learned',
);
assert.equal(
  glossary.lookup('東京大学'),
  undefined,
  'Scripts without word spaces are not learned',
);
assert.equal(isLearnablePair(pair('สวัสดี', 'Hallo')), false);

glossary.learn([pair('bank', 'Bank')]);
glossary.learn([pair('summit', 'gipfel')]);
assert.equal(
  glossary.lookup('summit'),
  'Gipfel',
  'The same translation in another case is not a conflict',
);
glossary.learn([pair('bank', 'Ufer')]);
assert.equal(
  glossary.lookup('bank'),
  undefined,
  'A conflicting translation stops reuse',
);
assert.equal(glossary.isConflicted('bank'), true);
glossary.learn([pair('bank', 'Bank')]);
assert.equal(
  glossary.lookup('bank'),
  undefined,
  'A conflicted surface form is never learned again',
);

const capped = new PageGlossary({ maxEntries: 2 });
capped.learn([pair('alpha', 'a'), pair('bravo', 'b'), pair('charlie', 'c')]);
assert.equal(capped.size, 2, 'The glossary stops learning when full');

// ---------- word-boundary matching ----------

const words = new PageGlossary();
words.learn([
  pair('summit', 'Gipfel'),
  pair('café', 'Kaffee'),
  pair('C++', 'C-plus-plus'),
  pair('New York', 'Neu-York'),
  pair('York', 'Jork'),
  pair('art', 'Kunst'),
]);

const findOriginals = (g, text) =>
  g.findIn(text).map((m) => [m.original, m.position.start]);

assert.deepEqual(
  findOriginals(words, 'The summit, summits; summit. Summit'),
  [
    ['summit', 4],
    ['summit', 21],
  ],
  'Whole words only, punctuation is a boundary, matching is case-sensitive',
);
assert.deepEqual(
  findOriginals(words, 'cafés décafé café!'),
  [['café', 13]],
  'Accented letters count as word characters',
);
assert.deepEqual(
  findOriginals(words, 'start, an art piece'),
  [['art', 10]],
  'No match inside a longer word',
);
assert.deepEqual(
  findOriginals(words, 'I write C++ code.'),
  [['C++', 8]],
  'Regex characters in a surface form are escaped',
);
assert.deepEqual(
  words
    .findIn('in New\n  York and York')
    .map((m) => [m.original, m.translation, m.position.start]),
  [
    ['New\n  York', 'Neu-York', 3],
    ['York', 'Jork', 18],
  ],
  'Longest form wins; whitespace runs of the raw text match; raw positions',
);
assert.deepEqual(
  findOriginals(words, '\n    the summit'),
  [['summit', 9]],
  'Positions are relative to the raw text, not a normalized copy',
);
assert.deepEqual(
  findOriginals(words, '东京summit大学'),
  [],
  'No substring match glued to CJK letters',
);

const many = new PageGlossary({ maxEntries: 1000 });
many.learn(
  Array.from({ length: 450 }, (_, i) => pair(`word${i}x`, `wort${i}`)),
);
assert.deepEqual(
  findOriginals(many, 'a word3x and word449x'),
  [
    ['word3x', 2],
    ['word449x', 13],
  ],
  'Large glossaries are matched in chunks',
);

assert.equal(indexOfWord('start, an art', 'art'), 10);
assert.equal(indexOfWord('start', 'art'), 2, 'Falls back to a plain match');
assert.equal(indexOfWord('東京大学', '大学'), 2);

// ---------- merge with LLM picks ----------

const mergeGlossary = new PageGlossary();
mergeGlossary.learn([
  pair('point', 'Punkt'),
  pair('summit', 'Gipfel'),
  pair('leaders', 'Anführer'),
  pair('agreement', 'Abkommen'),
]);
const mergeText =
  'The summit was a turning point for leaders who signed the agreement today.';
const merged = mergeWithGlossary(
  mergeText,
  mergeText,
  [llm(mergeText, 'turning point', 'Wendepunkt')],
  mergeGlossary,
  1,
);
assert.deepEqual(
  merged.map((r) => [r.original, r.isNew]),
  [
    ['turning point', true],
    ['summit', false],
    ['leaders', false],
    ['agreement', false],
  ],
  'LLM picks first; overlapping glossary matches are dropped',
);

const cappedMerge = mergeWithGlossary(
  mergeText,
  mergeText,
  [llm(mergeText, 'signed', 'unterschrieben')],
  mergeGlossary,
  0.2, // 13 words -> limit 3
);
assert.deepEqual(
  cappedMerge.map((r) => r.original),
  ['signed', 'summit', 'point'],
  'The segment rate caps the merge, LLM picks win',
);

const artGlossary = new PageGlossary();
artGlossary.learn([pair('art', 'Kunst')]);
const artText = 'Start with art.';
const relocated = mergeWithGlossary(
  artText,
  artText,
  [
    {
      original: 'art',
      translation: 'Kunst',
      position: { start: 2, end: 5 },
      isNew: true,
    },
  ],
  artGlossary,
  1,
);
assert.deepEqual(
  relocated.map((r) => [r.position.start, r.isNew]),
  [[11, false]],
  'Known pairs (e.g. stored hint pairs) are re-placed on word boundaries',
);

assert.equal(
  selectGlossaryReplacements(words.findIn('summit and summit')).length,
  1,
  'One glossary replacement per surface form and segment',
);

// ---------- prompt hint ----------

assert.equal(
  formatAlreadyHandledHint(['summit', 'leaders']),
  'Already handled, do not output: summit, leaders',
);
assert.equal(formatAlreadyHandledHint([]), '');
assert.equal(
  formatAlreadyHandledHint(Array.from({ length: 15 }, (_, i) => `w${i}`))
    .split(': ')[1]
    .split(', ').length,
  10,
  'The hint lists at most 10 words',
);
assert.match(
  promptService.getUserPrompt('The summit text', 2, ['summit']),
  /The summit text\nAlready handled, do not output: summit$/,
);
assert.equal(
  promptService.getUserPrompt('Plain', 2),
  'Text (at most 2 lines):\nPlain',
  'No hint, unchanged prompt',
);
assert.deepEqual(
  mergeGlossary.hintFor('Leaders met at the summit; the summit ended.'),
  [pair('summit', 'Gipfel')],
  'The hint lists only glossary words present in the text, once',
);

class HintProvider extends BaseProvider {
  constructor() {
    super({ apiKey: 'key', apiEndpoint: 'https://example.test', model: 'm' });
    this.requests = [];
  }
  getProviderName() {
    return 'Hint';
  }
  async requestCompletion(request) {
    this.requests.push(request);
    return { text: request.userPrompt.startsWith('<') ? '1|-\n2|-' : '' };
  }
}
const hintSettings = {
  multilingualConfig: { targetLanguage: 'de', nativeLanguage: 'en' },
  userLevel: 3,
  replacementRate: 0.3,
};
const hintProvider = new HintProvider();
await hintProvider.analyzeBatch(
  [
    'The summit opened with a long speech by the host.',
    'A second item has no glossary words at all here.',
  ],
  hintSettings,
  { alreadyHandled: [['summit'], undefined] },
);
const batchPrompt = hintProvider.requests[0].userPrompt;
assert.match(
  batchPrompt,
  /<\/1>\n1: Already handled, do not output: summit\n<2 /,
  'The batch hint follows its own item',
);
assert.equal(
  batchPrompt.match(/Already handled/g).length,
  1,
  'Items without glossary words get no hint',
);
await hintProvider.analyzeFullText(
  'The summit opened with a long speech by the host.',
  hintSettings,
  { alreadyHandled: ['summit'] },
);
assert.match(
  hintProvider.requests[1].userPrompt,
  /\nAlready handled, do not output: summit$/,
);

// ---------- combined pairs stored without the hint in the key ----------

const hint = { pairs: [pair('summit', 'Gipfel')], maxPairs: 3 };
assert.deepEqual(withHintPairs({ status: 'empty', pairs: [] }, hint), {
  status: 'ok',
  pairs: [pair('summit', 'Gipfel')],
});
assert.deepEqual(
  withHintPairs(
    {
      status: 'ok',
      pairs: [pair('a1', 'b'), pair('a2', 'b'), pair('a3', 'b')],
    },
    hint,
  ).pairs.length,
  3,
  'Hint pairs never push model picks out of the rate cap',
);
assert.deepEqual(withHintPairs({ status: 'error', error: 'x' }, hint), {
  status: 'error',
  error: 'x',
});

const hintedText = 'The summit opened with a long speech by the host.';
const plainText = 'Another paragraph about the weather and the sea.';
const hintCache = new SegmentTranslationCache(10);
const hintBackend = {
  manyCalls: [],
  translateOne: async () => ({ status: 'empty', pairs: [] }),
  translateMany: async (texts, alreadyHandled) => {
    hintBackend.manyCalls.push(alreadyHandled);
    return {
      status: 'ok',
      items: texts.map((text) => ({
        original: text,
        processed: '',
        replacements: [llm(text, text.split(' ')[2], 'neu')],
        status: 'ok',
      })),
    };
  },
};
const hintOutcomes = await new BatchTranslationExecutor(
  hintCache,
  hintBackend,
  { maxItems: 8, maxChars: 2500 },
).translate(
  [hintedText, plainText],
  [normalizeSegmentText(hintedText), normalizeSegmentText(plainText)],
  [hint, undefined],
);
assert.deepEqual(
  hintBackend.manyCalls,
  [[['summit'], undefined]],
  'Hint words travel per item to the batch request',
);
assert.deepEqual(
  hintCache.get(normalizeSegmentText(hintedText)).pairs,
  [pair('opened', 'neu'), pair('summit', 'Gipfel')],
  'The hinted item stores model picks + hinted glossary pairs',
);
assert.deepEqual(
  hintOutcomes[0].pairs,
  hintCache.get(normalizeSegmentText(hintedText)).pairs,
);
assert.deepEqual(
  hintCache.get(normalizeSegmentText(plainText)).pairs,
  [pair('about', 'neu')],
  'Items without a hint are stored unchanged',
);

const hintedText2 = 'Leaders met at the summit before the long dinner.';
const storedCache = new SegmentTranslationCache(10);
await new BatchTranslationExecutor(
  storedCache,
  {
    translateOne: async (text, alreadyHandled) => {
      assert.deepEqual(alreadyHandled, ['summit']);
      return { status: 'ok', pairs: [pair('dinner', 'Abendessen')] };
    },
    translateMany: async () => {
      throw new Error('single item: no batch');
    },
  },
  { maxItems: 8, maxChars: 2500 },
).translate([hintedText2], [normalizeSegmentText(hintedText2)], [hint]);
const stored = storedCache.get(normalizeSegmentText(hintedText2));
assert.deepEqual(
  stored.pairs,
  [pair('dinner', 'Abendessen'), pair('summit', 'Gipfel')],
  'The cache stores model picks + hinted glossary pairs so a later hit is complete',
);
assert.deepEqual(
  responseFromOutcome(hintedText2, stored, 0.3).replacements.map(
    (r) => r.original,
  ),
  ['summit', 'dinner'],
  'A cache hit without the glossary still yields every word',
);

// ---------- coordinator: learning, glossary hits, economy mode ----------

const makeSegment = (id, text) => {
  const element = document.createElement('p');
  element.textContent = text;
  document.body.appendChild(element);
  return {
    id,
    textContent: text,
    element,
    elements: [element],
    textNodes: [element.firstChild],
    fingerprint: `fp-glossary-${id}`,
    domPath: `body>p#${id}`,
  };
};

const makeEngine = (pick) => {
  const engine = {
    calls: [],
    styleManager: { getCurrentStyleClass: () => 'wxt-style-default' },
    getConfig: () => ({ replacementRate: 0.1 }),
    replaceText: async () => {
      throw new Error('batching expected');
    },
    replaceTexts: async (texts, hints) => {
      engine.calls.push({ texts, hints });
      return texts.map((text) => {
        const original = pick(text);
        return {
          original: text,
          processed: '',
          replacements: original ? [llm(text, original, `de-${original}`)] : [],
          status: original ? 'ok' : 'empty',
        };
      });
    },
  };
  return engine;
};

const recordApplied = (coordinator) => {
  const applied = [];
  coordinator.applyReplacements = (segment, replacements, ...rest) => {
    const collector = rest[4];
    replacements.forEach((r) => {
      collector?.push(r);
      applied.push([segment.id, r.original, r.isNew]);
    });
    return replacements.length;
  };
  return applied;
};

translationStats.reset();
const learnGlossary = new PageGlossary();
const learnCoordinator = new ProcessingCoordinator();
const learnApplied = recordApplied(learnCoordinator);
const learnEngine = makeEngine((text) =>
  text.includes('glacier') && !text.startsWith('Again') ? 'glacier' : null,
);
await learnCoordinator.processSegments(
  [makeSegment('learn-1', 'The glacier moved slowly down the valley floor.')],
  learnEngine,
  0,
  'after',
  true,
  false,
  ReplacementBudget.unlimited(),
  { glossary: learnGlossary, promptHint: true, economyMode: false },
);
assert.equal(
  learnGlossary.lookup('glacier'),
  'de-glacier',
  'Applied model picks are learned',
);
assert.equal(learnEngine.calls[0].hints[0], undefined);
await learnCoordinator.processSegments(
  [makeSegment('learn-2', 'Again the glacier was seen from the old bridge.')],
  learnEngine,
  0,
  'after',
  true,
  false,
  ReplacementBudget.unlimited(),
  { glossary: learnGlossary, promptHint: true, economyMode: false },
);
assert.deepEqual(
  learnEngine.calls[1].hints[0].pairs,
  [pair('glacier', 'de-glacier')],
  'The next segment carries the hint for the known word',
);
assert.deepEqual(
  learnApplied,
  [
    ['learn-1', 'glacier', true],
    ['learn-2', 'glacier', false],
  ],
  'The glossary fills the segment the model left empty',
);
assert.equal(translationStats.getSnapshot().glossaryHits, 1);

translationStats.reset();
const ecoGlossary = new PageGlossary();
ecoGlossary.learn([pair('glacier', 'Gletscher')]);
const ecoSegments = [1, 2, 3, 4, 5].map((n) =>
  makeSegment(`eco-${n}`, `Paragraph ${n} mentions the glacier once more.`),
);
assert.equal(countGlossaryCoverage(ecoGlossary, ecoSegments[0].textContent), 1);
const ecoEngine = makeEngine(() => null);
const ecoCoordinator = new ProcessingCoordinator();
const ecoApplied = recordApplied(ecoCoordinator);
await ecoCoordinator.processSegments(
  ecoSegments.slice(0, 3),
  ecoEngine,
  0,
  'after',
  true,
  false,
  ReplacementBudget.unlimited(),
  { glossary: ecoGlossary, promptHint: false, economyMode: true },
);
await ecoCoordinator.processSegments(
  ecoSegments.slice(3),
  ecoEngine,
  0,
  'after',
  true,
  true,
  ReplacementBudget.unlimited(),
  { glossary: ecoGlossary, promptHint: false, economyMode: true },
);
assert.deepEqual(
  ecoEngine.calls.map((call) => call.texts.map((t) => t.split(' ')[1])),
  [['2'], ['4']],
  'Economy mode skips covered segments but never two in a row, across runs',
);
assert.equal(translationStats.getSnapshot().economySkipped, 3);
assert.equal(
  ecoApplied.length,
  5,
  'Every segment still gets its glossary word',
);

const gate = new PageGlossary();
assert.deepEqual(
  [
    gate.shouldSkipRequest(2, 2),
    gate.shouldSkipRequest(2, 2),
    gate.shouldSkipRequest(1, 2),
    gate.shouldSkipRequest(2, 2),
    gate.shouldSkipRequest(5, undefined),
  ],
  [true, false, false, true, false],
);

console.log('page glossary regression passed');
