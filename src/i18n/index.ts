/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import i18next from 'i18next';
import type { SupportedLocale } from './localeDetector.js';

// Import all locale files statically for bundling
import en from './locales/en.json' with { type: 'json' };
import es from './locales/es.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };
import it from './locales/it.json' with { type: 'json' };
import ptBr from './locales/pt-br.json' with { type: 'json' };
import zhCn from './locales/zh-cn.json' with { type: 'json' };
import zhTw from './locales/zh-tw.json' with { type: 'json' };
import de from './locales/de.json' with { type: 'json' };
import ja from './locales/ja.json' with { type: 'json' };
import ko from './locales/ko.json' with { type: 'json' };
import ru from './locales/ru.json' with { type: 'json' };
import tr from './locales/tr.json' with { type: 'json' };
import pl from './locales/pl.json' with { type: 'json' };
import cs from './locales/cs.json' with { type: 'json' };
import hu from './locales/hu.json' with { type: 'json' };
import hi from './locales/hi.json' with { type: 'json' };

const resources: Record<string, { translation: typeof en }> = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  it: { translation: it },
  'pt-br': { translation: ptBr },
  'zh-cn': { translation: zhCn },
  'zh-tw': { translation: zhTw },
  de: { translation: de },
  ja: { translation: ja },
  ko: { translation: ko },
  ru: { translation: ru },
  tr: { translation: tr },
  pl: { translation: pl },
  cs: { translation: cs },
  hu: { translation: hu },
  hi: { translation: hi },
};

let currentLocale: SupportedLocale = 'en';
let initialized = false;

// Language change listeners for reactive updates
type LanguageChangeListener = (locale: SupportedLocale) => void;
const languageChangeListeners: Set<LanguageChangeListener> = new Set();

/**
 * Eagerly initialize i18next with English as default.
 * This runs synchronously at module load time so that t() calls
 * in command metadata exports work before initI18n() is called.
 */
function initEager(): void {
  if (initialized) return;
  i18next.init({
    lng: 'en',
    fallbackLng: 'en',
    resources,
    interpolation: {
      escapeValue: false,
    },
    keySeparator: '.',
    nsSeparator: ':',
    returnNull: false,
    returnEmptyString: false,
    lowerCaseLng: true,
    initImmediate: false, // synchronous init
  });
  initialized = true;
}

// Run eagerly so t() works at import time (before initI18n is called)
initEager();

/**
 * Initialize i18next with the specified locale.
 * If already initialized (via eager init), just changes the language.
 */
export async function initI18n(locale: SupportedLocale): Promise<void> {
  currentLocale = locale;

  if (initialized) {
    await i18next.changeLanguage(locale);
    return;
  }

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
    // Keep locale codes lowercase (e.g., 'pt-br' not 'pt-BR')
    // This ensures resource keys match what we define
    lowerCaseLng: true,
  });

  initialized = true;
}

/**
 * Change the current language at runtime
 */
export async function changeLanguage(locale: SupportedLocale): Promise<void> {
  currentLocale = locale;
  await i18next.changeLanguage(locale);
  // Notify all listeners of the language change
  languageChangeListeners.forEach((listener) => listener(locale));
}

/**
 * Subscribe to language changes
 * @param callback Function called when language changes
 * @returns Unsubscribe function
 */
export function onLanguageChange(callback: LanguageChangeListener): () => void {
  languageChangeListeners.add(callback);
  return () => {
    languageChangeListeners.delete(callback);
  };
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
    // Shouldn't happen after eager init, but fallback gracefully
    initEager();
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
