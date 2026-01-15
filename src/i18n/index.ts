/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import i18next from 'i18next';
import type { SupportedLocale } from './localeDetector.js';

// Import all locale files statically for bundling
import en from './locales/en.json' with { type: 'json' };

// We'll add other locales as they're generated
// For now, use English as fallback for all
const resources: Record<string, { translation: typeof en }> = {
  en: { translation: en },
  // These will use en.json as fallback until translations are generated
  'zh-cn': { translation: en },
  'zh-tw': { translation: en },
  fr: { translation: en },
  de: { translation: en },
  it: { translation: en },
  es: { translation: en },
  ja: { translation: en },
  ko: { translation: en },
  ru: { translation: en },
  'pt-br': { translation: en },
  tr: { translation: en },
  pl: { translation: en },
  cs: { translation: en },
  hu: { translation: en },
  hi: { translation: en },
};

let currentLocale: SupportedLocale = 'en';
let initialized = false;

/**
 * Initialize i18next with the specified locale
 */
export async function initI18n(locale: SupportedLocale): Promise<void> {
  currentLocale = locale;

  await i18next.init({
    lng: locale,
    fallbackLng: 'en',
    resources,
    interpolation: {
      escapeValue: false, // Not needed for CLI (no XSS risk)
    },
    // Support nested keys like 'commands.help.title'
    keySeparator: '.',
    nsSeparator: ':',
    // Return key if translation missing (for debugging)
    returnNull: false,
    returnEmptyString: false,
  });

  initialized = true;
}

/**
 * Change the current language at runtime
 */
export async function changeLanguage(locale: SupportedLocale): Promise<void> {
  currentLocale = locale;
  await i18next.changeLanguage(locale);
}

/**
 * Get the current locale
 */
export function getCurrentLocale(): SupportedLocale {
  return currentLocale;
}

/**
 * Check if i18n is initialized
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Translation function with interpolation support
 *
 * Usage:
 *   t('welcome.banner')
 *   t('welcome.modelLine', { model: 'claude-3' })
 *   t('errors.invalidLocale', { locale: 'xx', supported: 'en, fr, de' })
 */
export function t(key: string, options?: Record<string, string | number>): string {
  if (!initialized) {
    // If not initialized, return the key for debugging
    console.warn(`[i18n] Not initialized, returning key: ${key}`);
    return key;
  }

  return i18next.t(key, options);
}

/**
 * Check if a translation key exists
 */
export function exists(key: string): boolean {
  return i18next.exists(key);
}

// Re-export types and utilities
export {
  detectLocale,
  normalizeLocale,
  isValidLocale,
  SUPPORTED_LOCALES,
  LANGUAGE_DISPLAY_NAMES,
  type SupportedLocale,
  type LocaleDetectionResult,
} from './localeDetector.js';

// Re-export LLM locale utilities
export { buildLocaleInstruction, injectLocaleIntoPrompt } from './llmLocale.js';
