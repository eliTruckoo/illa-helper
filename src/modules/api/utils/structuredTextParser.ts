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
      result.success = result.replacements.length > 0;

      if (result.replacements.length === 0) {
        result.errors.push('No valid replacement items found');
      }
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
      .replace(/```[\s\S]*?```/g, '') // remove code blocks
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
      // Try the double-pipe separator first
      if (line.includes('||')) {
        const parts = line.split('||');
        if (parts.length >= 2) {
          const original = parts[0].trim();
          const translation = parts[1].trim();
          if (original && translation) {
            // [Double-pipe parser] Found replacement item
            replacements.push({ original, translation });
            continue;
          }
        }
      }

      // Fallback separators (error tolerance)
      const fallbackResult = this.parseFallbackSeparators(line);
      if (fallbackResult) {
        replacements.push(fallbackResult);
      }
    }

    return replacements;
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
