/**
 * Simple text parser
 * Designed for the "original||translation" format; minimal and efficient
 */

export interface ParsedReplacement {
  original: string;
  translation: string;
}

export interface ParseResult {
  success: boolean;
  replacements: ParsedReplacement[];
  errors: string[];
}

export interface NumberedParseResult {
  /** Pairs per item number (1-based); an answered item may have no pairs */
  items: Map<number, ParsedReplacement[]>;
  /** Lines that could not be attributed to an item */
  ignoredLines: number;
}

/** "n|original||translation" or "n|-"; tolerates "<n>", "[n]", "(n)" around the number */
const NUMBERED_LINE_PATTERN = /^[<[(]?\s*(\d{1,3})\s*[>\])]?\s*\|(.*)$/;
const EMPTY_ITEM_PATTERN = /^[-–—]?$/;

/**
 * Simple text parser class
 */
export class StructuredTextParser {
  /**
   * Parse text in the simple double-pipe format
   * @param text text returned by the AI
   * @returns parse result
   */
  public static parse(text: string): ParseResult {
    const result: ParseResult = {
      success: false,
      replacements: [],
      errors: [],
    };

    try {
      // Clean the text
      const cleanedText = this.cleanText(text);

      // Parse replacement items
      const replacements = this.parseDoubleBarFormat(cleanedText);

      result.replacements = replacements.filter(
        (r: ParsedReplacement) => r.original && r.translation,
      );
      // A response without any pairs is a valid, empty answer (e.g. nothing worth translating), not a failure.
      result.success = true;
    } catch (error) {
      result.errors.push(
        `Parse error: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.error('[Double-pipe parser] Parse failed:', error);
    }

    return result;
  }

  /**
   * Clean the text, removing extra whitespace and formatting characters
   */
  private static cleanText(text: string): string {
    return text
      .replace(/^\s*```.*$/gm, '') // remove code fence lines, keep their content
      .replace(/^\s*[\r\n]/gm, '') // remove empty lines
      .trim();
  }

  /**
   * Parse double-pipe format: original||translation
   */
  private static parseDoubleBarFormat(text: string): ParsedReplacement[] {
    const replacements: ParsedReplacement[] = [];

    // Split by line
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line);

    for (const line of lines) {
      const replacement = this.parseLine(line);
      if (replacement) {
        replacements.push(replacement);
      }
    }

    return replacements;
  }

  /**
   * Parse one "original||translation" line, with fallback separators
   */
  private static parseLine(line: string): ParsedReplacement | null {
    // Try the double-pipe separator first
    if (line.includes('||')) {
      const parts = line.split('||');
      if (parts.length >= 2) {
        const original = parts[0].trim();
        const translation = parts[1].trim();
        if (original && translation) {
          return { original, translation };
        }
      }
    }

    // Fallback separators (error tolerance)
    return this.parseFallbackSeparators(line);
  }

  /**
   * Parse a numbered batch answer: "n|original||translation" lines and "n|-" for items without picks.
   * Items that never appear are missing from the result (the caller retries them on their own).
   * @param text text returned by the AI
   * @param itemCount number of items in the request; other numbers are ignored
   */
  public static parseNumbered(
    text: string,
    itemCount: number,
  ): NumberedParseResult {
    const items = new Map<number, ParsedReplacement[]>();
    let ignoredLines = 0;

    const lines = this.cleanText(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line);

    for (const line of lines) {
      const match = NUMBERED_LINE_PATTERN.exec(line);
      const id = match ? Number(match[1]) : NaN;
      if (!match || id < 1 || id > itemCount) {
        ignoredLines++;
        continue;
      }

      // Tolerate "n||original||translation"
      const rest = match[2].replace(/^\|+/, '').trim();
      const pairs = items.get(id) ?? [];
      items.set(id, pairs);

      if (EMPTY_ITEM_PATTERN.test(rest)) {
        continue;
      }

      const replacement = this.parseLine(rest);
      if (replacement) {
        pairs.push(replacement);
      } else {
        ignoredLines++;
      }
    }

    return { items, ignoredLines };
  }

  /**
   * Parse fallback separator formats (error tolerance)
   */
  private static parseFallbackSeparators(
    line: string,
  ): ParsedReplacement | null {
    // Common separators, ordered by priority
    const separators = ['→', '->', ':', '=', '|'];

    for (const sep of separators) {
      if (line.includes(sep)) {
        const parts = line.split(sep);
        if (parts.length >= 2) {
          const original = parts[0].trim();
          const translation = parts[1].trim();
          if (original && translation) {
            return { original, translation };
          }
        }
      }
    }

    return null;
  }

  /**
   * Validate the parse result
   */
  public static validateResult(
    result: ParseResult,
    expectedMinimum: number = 1,
  ): boolean {
    if (!result.success) {
      console.warn('[Double-pipe parser] Parse failed:', result.errors);
      return false;
    }

    if (result.replacements.length < expectedMinimum) {
      return false;
    }

    // Validate each replacement item
    for (const replacement of result.replacements) {
      if (!replacement.original || !replacement.translation) {
        console.warn(
          '[Double-pipe parser] Invalid replacement item found:',
          replacement,
        );
        return false;
      }

      if (
        replacement.original.length < 1 ||
        replacement.translation.length < 1
      ) {
        console.warn(
          '[Double-pipe parser] Replacement item too short:',
          replacement,
        );
        return false;
      }
    }

    return true;
  }
}
