/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';

/**
 * All supported locales for the CLI
 */
export const SUPPORTED_LOCALES = [
  'en',
  'zh-cn',
  'zh-tw',
  'fr',
  'de',
  'it',
  'es',
  'ja',
  'ko',
  'ru',
  'pt-br',
  'tr',
  'pl',
  'cs',
  'hu',
  'hi',
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Language display names in their native form
 */
export const LANGUAGE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-cn': '简体中文 (Simplified Chinese)',
  'zh-tw': '繁體中文 (Traditional Chinese)',
  fr: 'Français (French)',
  de: 'Deutsch (German)',
  it: 'Italiano (Italian)',
  es: 'Español (Spanish)',
  ja: '日本語 (Japanese)',
  ko: '한국어 (Korean)',
  ru: 'Русский (Russian)',
  'pt-br': 'Português (Brazilian Portuguese)',
  tr: 'Türkçe (Turkish)',
  pl: 'Polski (Polish)',
  cs: 'Čeština (Czech)',
  hu: 'Magyar (Hungarian)',
  hi: 'हिन्दी (Hindi)',
};

export interface LocaleDetectionResult {
  locale: SupportedLocale;
  source: 'cli' | 'config' | 'env' | 'os' | 'fallback';
  rawLocale?: string;
}

/**
 * Detect OS locale - works on Linux, macOS, and Windows
 */
export function detectOSLocale(): string | null {
  const platform = process.platform;

  // 1. Try environment variables (works on all platforms)
  const envLocale =
    process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE;

  if (envLocale) {
    return envLocale;
  }

  // 2. Platform-specific detection
  try {
    if (platform === 'darwin') {
      // macOS: Use defaults command
      const result = execSync('defaults read -g AppleLocale', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      return result; // e.g., "en_US", "zh_CN"
    }

    if (platform === 'win32') {
      // Windows: Use PowerShell to get culture
      const result = execSync('powershell -NoProfile -Command "(Get-Culture).Name"', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      return result; // e.g., "en-US", "zh-CN"
    }

    if (platform === 'linux') {
      // Linux: Try localectl or locale command
      try {
        const result = execSync('localectl status', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        const match = result.match(/LANG=([^\n]+)/);
        if (match) return match[1];
      } catch {
        // Fallback to locale command
        try {
          const result = execSync('locale', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
          });
          const match = result.match(/LANG="?([^"\n]+)"?/);
          if (match) return match[1];
        } catch {
          // Silent failure
        }
      }
    }
  } catch {
    // Silent failure - will use fallback
  }

  return null;
}

/**
 * Normalize locale string to supported locale
 * Handles: en_US, en-US, en.UTF-8, zh_CN.UTF-8 -> en, zh-cn
 */
export function normalizeLocale(rawLocale: string): SupportedLocale {
  // Remove encoding suffix (.UTF-8, .utf8, etc.)
  let locale = rawLocale.split('.')[0].toLowerCase();

  // Normalize separators (underscore to hyphen)
  locale = locale.replace('_', '-');

  // Handle special cases
  const mappings: Record<string, SupportedLocale> = {
    'zh-hans': 'zh-cn',
    'zh-hant': 'zh-tw',
    zh: 'zh-cn',
    pt: 'pt-br',
    nb: 'en', // Norwegian Bokmal -> fallback
    nn: 'en', // Norwegian Nynorsk -> fallback
  };

  // Check for direct match
  if (SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    return locale as SupportedLocale;
  }

  // Check mappings
  if (mappings[locale]) {
    return mappings[locale];
  }

  // Try base language (en-US -> en, zh-cn stays zh-cn)
  const baseLang = locale.split('-')[0];
  if (SUPPORTED_LOCALES.includes(baseLang as SupportedLocale)) {
    return baseLang as SupportedLocale;
  }

  // Special check for Chinese variants
  if (baseLang === 'zh') {
    // Default Chinese to Simplified
    return 'zh-cn';
  }

  // Fallback to English
  return 'en';
}

/**
 * Full locale detection with priority handling
 *
 * Priority:
 * 1. CLI flag override (--display-language)
 * 2. Config file setting (ui.locale)
 * 3. Environment variable (AUTOHAND_LOCALE, LC_ALL, LC_MESSAGES, LANG)
 * 4. OS detection (platform-specific)
 * 5. Fallback to 'en'
 */
export function detectLocale(options?: {
  cliOverride?: string;
  configLocale?: string;
}): LocaleDetectionResult {
  // Priority 1: CLI flag override
  if (options?.cliOverride) {
    const normalized = normalizeLocale(options.cliOverride);
    return { locale: normalized, source: 'cli', rawLocale: options.cliOverride };
  }

  // Priority 2: Config file setting
  if (options?.configLocale) {
    const normalized = normalizeLocale(options.configLocale);
    return { locale: normalized, source: 'config', rawLocale: options.configLocale };
  }

  // Priority 3: Environment variables (AUTOHAND_LOCALE takes precedence)
  const envLocale =
    process.env.AUTOHAND_LOCALE ||
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG;
  if (envLocale) {
    const normalized = normalizeLocale(envLocale);
    return { locale: normalized, source: 'env', rawLocale: envLocale };
  }

  // Priority 4: OS detection
  const osLocale = detectOSLocale();
  if (osLocale) {
    const normalized = normalizeLocale(osLocale);
    return { locale: normalized, source: 'os', rawLocale: osLocale };
  }

  // Priority 5: Fallback
  return { locale: 'en', source: 'fallback' };
}

/**
 * Check if a locale string is supported
 */
export function isValidLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}
