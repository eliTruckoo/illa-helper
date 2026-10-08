/**
 * Website management utility functions
 * Provides URL pattern generation and domain extraction
 */

/**
 * Extract the domain from a URL
 * @param url full URL
 * @returns the extracted domain, or the original URL if parsing fails
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    console.warn('URL parsing failed, using original URL:', url, error);
    // Fallback: try to extract the domain from the string
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/]+)/);
    return match ? match[1] : url;
  }
}

/**
 * Generate a domain pattern (wildcard pattern)
 * @param domain domain
 * @returns domain pattern in the format *://example.com/*
 */
export function generateDomainPattern(domain: string): string {
  // Remove a possible www prefix
  const cleanDomain = domain.replace(/^www\./, '');
  return `*://${cleanDomain}/*`;
}

/**
 * Generate an exact URL pattern
 * @param url full URL
 * @returns exact URL pattern
 */
export function generateExactPattern(url: string): string {
  try {
    const urlObj = new URL(url);
    // Strip any query parameters and fragment, keep the path, and add a wildcard to match everything under that path
    const basePath = urlObj.pathname.endsWith('/')
      ? urlObj.pathname
      : `${urlObj.pathname}*`;
    return `${urlObj.protocol}//${urlObj.host}${basePath}`;
  } catch (error) {
    console.warn('URL parsing failed, using original URL:', url, error);
    return url;
  }
}

/**
 * Generate a friendly rule description
 * @param pattern URL pattern
 * @param type rule type
 * @returns description string
 */
export function generateRuleDescription(
  pattern: string,
  type: 'blacklist' | 'whitelist',
): string {
  const typeText = type === 'blacklist' ? 'Blacklist' : 'Whitelist';

  if (pattern.includes('*://') && pattern.endsWith('/*')) {
    // Domain pattern *://example.com/*
    const domain = pattern.replace(/^\*:\/\//, '').replace(/\/\*$/, '');
    return `${typeText} - Domain: ${domain}`;
  } else {
    return `${typeText} - Page: ${pattern}`;
  }
}

/**
 * Determine whether a URL uses a special protocol or is a local address
 * @param url URL string
 * @returns whether it is a special address
 */
export function isSpecialUrl(url: string): boolean {
  const specialProtocols = [
    'chrome:',
    'chrome-extension:',
    'moz-extension:',
    'edge:',
    'about:',
  ];
  const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');
  const hasSpecialProtocol = specialProtocols.some((protocol) =>
    url.startsWith(protocol),
  );

  return isLocalhost || hasSpecialProtocol;
}

/**
 * Validate whether a URL can be added to the rules
 * @param url URL string
 * @returns validation result and error message
 */
export function validateUrlForRule(url: string): {
  valid: boolean;
  error?: string;
} {
  if (!url || url.trim() === '') {
    return { valid: false, error: 'URL cannot be empty' };
  }

  if (isSpecialUrl(url)) {
    return {
      valid: false,
      error:
        'Cannot create a rule for browser internal pages or local addresses',
    };
  }

  try {
    new URL(url);
    return { valid: true };
  } catch (_) {
    return { valid: false, error: 'Invalid URL format' };
  }
}
