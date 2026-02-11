/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight zero-dependency i18n implementation.
 *
 * Replaces i18next (~150KB) with a ~50-line core that provides:
 * - Dot-path key lookup (e.g. 'commands.help.title')
 * - {{variable}} interpolation
 * - Fallback to English
 * - Runtime language switching
 */

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

const translations: Record<string, Record<string, unknown>> = {
  en, es, fr, it,
  'pt-br': ptBr,
  'zh-cn': zhCn,
  'zh-tw': zhTw,
  de, ja, ko, ru, tr, pl, cs, hu, hi,
};

let currentLocale: SupportedLocale = 'en';
let initialized = false;

// Language change listeners for reactive updates
type LanguageChangeListener = (locale: SupportedLocale) => void;
const languageChangeListeners: Set<LanguageChangeListener> = new Set();

/**
 * Resolve a dot-separated key path on a nested object.
 * Returns undefined if any segment is missing.
 */
function resolve(obj: Record<string, unknown>, key: string): unknown {
  let cur: unknown = obj;
  for (const segment of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/**
 * Replace {{variable}} placeholders with values from options.
 */
function interpolate(text: string, options?: Record<string, string | number>): string {
  if (!options) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const val = options[name];
    return val != null ? String(val) : `{{${name}}}`;
  });
}

/**
 * Initialize i18n with the specified locale.
 */
export async function initI18n(locale: SupportedLocale): Promise<void> {
  currentLocale = locale;
  initialized = true;
}

/**
 * Change the current language at runtime
 */
export async function changeLanguage(locale: SupportedLocale): Promise<void> {
  currentLocale = locale;
  languageChangeListeners.forEach((listener) => listener(locale));
}

/**
 * Subscribe to language changes
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
  // Try current locale first, then fall back to English
  const value = resolve(translations[currentLocale] ?? {}, key)
    ?? resolve(translations.en, key);

  if (typeof value === 'string') {
    return interpolate(value, options);
  }

  // Return the key itself as fallback (matches i18next behavior)
  return key;
}

/**
 * Check if a translation key exists
 */
export function exists(key: string): boolean {
  return resolve(translations[currentLocale] ?? {}, key) !== undefined
    || resolve(translations.en, key) !== undefined;
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
