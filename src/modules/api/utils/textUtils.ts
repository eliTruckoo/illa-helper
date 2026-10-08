/**
 * Text processing utility functions
 */

import { Replacement } from '../../shared/types/api';
import { calculateReplacementLimit } from '../../processing/ReplacementBudget';

export interface ReplacementLimitOptions {
  replacementRate?: number;
}

/**
 * Add position info to replacement items
 */
export function addPositionsToReplacements(
  originalText: string,
  replacements: Array<{ original: string; translation: string }>,
  options: ReplacementLimitOptions = {},
): Replacement[] {
  const result: Replacement[] = [];
  let lastIndex = 0;

  for (const rep of replacements) {
    if (!rep.original || !rep.translation) continue;

    const index = originalText.indexOf(rep.original, lastIndex);
    if (index !== -1) {
      const foundText = originalText.substring(
        index,
        index + rep.original.length,
      );
      if (foundText === rep.original) {
        result.push({
          ...rep,
          position: { start: index, end: index + rep.original.length },
          isNew: true,
        });
        lastIndex = index + rep.original.length;
      }
    } else {
      const globalIndex = originalText.indexOf(rep.original);
      if (
        globalIndex !== -1 &&
        !result.some(
          (r) =>
            r.position.start <= globalIndex && r.position.end > globalIndex,
        )
      ) {
        result.push({
          ...rep,
          position: {
            start: globalIndex,
            end: globalIndex + rep.original.length,
          },
          isNew: true,
        });
      }
    }
  }

  result.sort((a, b) => a.position.start - b.position.start);
  return limitReplacementsByRate(originalText, result, options.replacementRate);
}

export function limitReplacementsByRate(
  originalText: string,
  replacements: Replacement[],
  replacementRate?: number,
): Replacement[] {
  if (replacementRate === undefined || Number.isNaN(replacementRate)) {
    return replacements;
  }

  if (replacementRate <= 0) {
    return [];
  }

  if (replacementRate >= 1 || replacements.length <= 1) {
    return replacements;
  }

  const maxReplacementCount = calculateReplacementLimit(
    originalText,
    replacementRate,
  );

  if (maxReplacementCount === undefined) {
    return replacements;
  }

  if (maxReplacementCount <= 0) {
    return [];
  }

  return replacements.slice(0, maxReplacementCount);
}

/** Estimated output tokens per "original||translation" line */
const OUTPUT_TOKENS_PER_LINE = 15;
/** Extra tokens per line for the "n|" prefix of numbered batch output */
const OUTPUT_TOKENS_PER_NUMBERED_LINE = 2;
/** Fixed allowance for formatting noise and the "n|-" markers */
const OUTPUT_TOKENS_BASE = 40;

/**
 * Output token cap (max_tokens) for a request that may produce at most `maxLines` lines.
 * Returns undefined when the line count is unbounded (replacement rate >= 100%).
 */
export function estimateMaxOutputTokens(
  maxLines: number | undefined,
  itemCount: number = 1,
): number | undefined {
  if (maxLines === undefined || Number.isNaN(maxLines)) {
    return undefined;
  }

  const lines = Math.max(0, maxLines);
  if (itemCount <= 1) {
    return lines * OUTPUT_TOKENS_PER_LINE + OUTPUT_TOKENS_BASE;
  }

  return (
    lines * (OUTPUT_TOKENS_PER_LINE + OUTPUT_TOKENS_PER_NUMBERED_LINE) +
    itemCount * 4 +
    OUTPUT_TOKENS_BASE
  );
}
