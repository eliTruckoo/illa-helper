/**
 * Per-tab translation cost counters.
 * The content script runs once per tab, so this module-level singleton counts the
 * word-mode translation traffic of the current page only.
 */

export interface TranslationStatsSnapshot {
  /** Coordinator runs (manual, lazy-loading and dynamic-content batches) */
  runs: number;
  /** Segments submitted for translation */
  segments: number;
  /** API requests sent (single and batch) */
  requests: number;
  /** Requests that carried more than one segment */
  batchRequests: number;
  /** Segments carried by batch requests */
  batchedSegments: number;
  /** Segments answered from the in-page cache */
  cacheHits: number;
  /** Segments that reused an identical in-flight or same-run request */
  inflightCoalesced: number;
  /** Segments skipped without a request because the page budget was exhausted */
  budgetSkipped: number;
  /** Replacements applied from the page glossary instead of a fresh model pick */
  glossaryHits: number;
  /** Segments served by the page glossary alone (economy mode), without a request */
  economySkipped: number;
  /** Failed requests */
  errors: number;
  /** Requests whose response reported token usage */
  requestsWithUsage: number;
  /** Input (prompt) tokens reported by the provider */
  inputTokens: number;
  /** Output (completion) tokens reported by the provider */
  outputTokens: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

const createEmptySnapshot = (): TranslationStatsSnapshot => ({
  runs: 0,
  segments: 0,
  requests: 0,
  batchRequests: 0,
  batchedSegments: 0,
  cacheHits: 0,
  inflightCoalesced: 0,
  budgetSkipped: 0,
  glossaryHits: 0,
  economySkipped: 0,
  errors: 0,
  requestsWithUsage: 0,
  inputTokens: 0,
  outputTokens: 0,
});

/**
 * Extract token usage from an OpenAI-compatible (`usage`) or Gemini (`usageMetadata`) payload.
 */
export function extractTokenUsage(usage: any): TokenUsage | null {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = Number(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount,
  );
  const outputTokens = Number(
    usage.completion_tokens ??
      usage.output_tokens ??
      usage.candidatesTokenCount ??
      0,
  );

  if (!Number.isFinite(inputTokens)) {
    return null;
  }

  return {
    inputTokens,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  };
}

export class TranslationStats {
  private counters: TranslationStatsSnapshot = createEmptySnapshot();

  recordRun(): void {
    this.counters.runs++;
  }

  recordSegments(count: number): void {
    this.counters.segments += count;
  }

  recordRequest(segmentCount: number = 1): void {
    this.counters.requests++;
    if (segmentCount > 1) {
      this.counters.batchRequests++;
      this.counters.batchedSegments += segmentCount;
    }
  }

  recordCacheHit(count: number = 1): void {
    this.counters.cacheHits += count;
  }

  recordCoalesced(count: number = 1): void {
    this.counters.inflightCoalesced += count;
  }

  recordBudgetSkipped(count: number): void {
    this.counters.budgetSkipped += count;
  }

  recordGlossaryHits(count: number): void {
    this.counters.glossaryHits += count;
  }

  recordEconomySkipped(count: number = 1): void {
    this.counters.economySkipped += count;
  }

  recordError(): void {
    this.counters.errors++;
  }

  /**
   * Record token usage from a raw provider usage payload; ignored when absent.
   */
  recordUsage(usage: any): void {
    const tokens = extractTokenUsage(usage);
    if (!tokens) {
      return;
    }

    this.counters.requestsWithUsage++;
    this.counters.inputTokens += tokens.inputTokens;
    this.counters.outputTokens += tokens.outputTokens;
  }

  getSnapshot(): TranslationStatsSnapshot {
    return { ...this.counters };
  }

  reset(): void {
    this.counters = createEmptySnapshot();
  }

  /**
   * Log a one-line summary (console.log is stripped from production builds).
   */
  logSummary(context: string): void {
    const s = this.counters;
    const answered = s.segments - s.budgetSkipped;
    const reuseRate =
      answered > 0
        ? Math.round(((s.cacheHits + s.inflightCoalesced) / answered) * 100)
        : 0;
    console.log(
      `[TranslationStats] ${context}: segments=${s.segments} requests=${s.requests} ` +
        `(batch=${s.batchRequests}/${s.batchedSegments} seg) cacheHits=${s.cacheHits} ` +
        `coalesced=${s.inflightCoalesced} reuse=${reuseRate}% budgetSkipped=${s.budgetSkipped} ` +
        `glossaryHits=${s.glossaryHits} economySkipped=${s.economySkipped} ` +
        `errors=${s.errors} tokens in/out=${s.inputTokens}/${s.outputTokens} ` +
        `(usage on ${s.requestsWithUsage} req)`,
    );
  }
}

export const translationStats = new TranslationStats();

/**
 * Current per-tab translation statistics (for a future options/popup view).
 */
export const getTranslationStats = (): TranslationStatsSnapshot =>
  translationStats.getSnapshot();
