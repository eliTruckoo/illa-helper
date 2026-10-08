import { createI18n } from 'vue-i18n';
import type { Locale } from 'vue-i18n';

// Import locale messages
import enUS from './locales/en-US.json';

// Supported locales
export const SUPPORTED_LOCALES: Locale[] = ['en-US'];

// Locale display names
export const LOCALE_NAMES: Record<Locale, string> = {
  'en-US': 'English',
};

// Default locale
const DEFAULT_LOCALE: Locale = 'en-US';

/**
 * Detected browser language, always resolved to a supported locale.
 * Kept for testing and debugging.
 */
export function getDetectedBrowserLanguage(): Locale | null {
  return DEFAULT_LOCALE;
}

// Create the i18n instance
export const i18n = createI18n({
  legacy: false, // Use the Composition API
  locale: DEFAULT_LOCALE,
  fallbackLocale: 'en-US',
  messages: {
    'en-US': enUS,
  },
  missingWarn: false,
  fallbackWarn: false,
  runtimeOnly: false,
  flatJson: false,
});

// Get the current locale
export function getCurrentLocale(): Locale {
  return i18n.global.locale.value;
}

// Set the locale
export function setLocale(locale: Locale): void {
  if (SUPPORTED_LOCALES.includes(locale)) {
    (i18n.global.locale as any).value = locale;
    // Persist to local storage
    localStorage.setItem('preferred-locale', locale);
  }
}

// Get the display name of a locale
export function getLocaleName(locale: Locale): string {
  return LOCALE_NAMES[locale] || locale;
}

// Initialize the locale
export function initializeLocale(): void {
  setLocale(DEFAULT_LOCALE);
}

export default i18n;
