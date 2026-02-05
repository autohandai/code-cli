/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeLocale,
  detectLocale,
  detectOSLocale,
  isValidLocale,
  SUPPORTED_LOCALES,
  LANGUAGE_DISPLAY_NAMES,
} from '../../src/i18n/localeDetector';

describe('localeDetector', () => {
  describe('SUPPORTED_LOCALES', () => {
    it('should contain all 16 supported locales', () => {
      expect(SUPPORTED_LOCALES).toHaveLength(16);
      expect(SUPPORTED_LOCALES).toContain('en');
      expect(SUPPORTED_LOCALES).toContain('zh-cn');
      expect(SUPPORTED_LOCALES).toContain('zh-tw');
      expect(SUPPORTED_LOCALES).toContain('fr');
      expect(SUPPORTED_LOCALES).toContain('de');
      expect(SUPPORTED_LOCALES).toContain('it');
      expect(SUPPORTED_LOCALES).toContain('es');
      expect(SUPPORTED_LOCALES).toContain('ja');
      expect(SUPPORTED_LOCALES).toContain('ko');
      expect(SUPPORTED_LOCALES).toContain('ru');
      expect(SUPPORTED_LOCALES).toContain('pt-br');
      expect(SUPPORTED_LOCALES).toContain('tr');
      expect(SUPPORTED_LOCALES).toContain('pl');
      expect(SUPPORTED_LOCALES).toContain('cs');
      expect(SUPPORTED_LOCALES).toContain('hu');
      expect(SUPPORTED_LOCALES).toContain('hi');
    });
  });

  describe('LANGUAGE_DISPLAY_NAMES', () => {
    it('should have display names for all supported locales', () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(LANGUAGE_DISPLAY_NAMES[locale]).toBeDefined();
        expect(LANGUAGE_DISPLAY_NAMES[locale].length).toBeGreaterThan(0);
      }
    });

    it('should have native language names for non-English locales', () => {
      // These should contain non-ASCII characters
      expect(LANGUAGE_DISPLAY_NAMES['zh-cn']).toContain('简体中文');
      expect(LANGUAGE_DISPLAY_NAMES['zh-tw']).toContain('繁體中文');
      expect(LANGUAGE_DISPLAY_NAMES['ja']).toContain('日本語');
      expect(LANGUAGE_DISPLAY_NAMES['ko']).toContain('한국어');
      expect(LANGUAGE_DISPLAY_NAMES['ru']).toContain('Русский');
      expect(LANGUAGE_DISPLAY_NAMES['hi']).toContain('हिन्दी');
    });
  });

  describe('normalizeLocale', () => {
    describe('direct matches', () => {
      it('should return exact match for supported locales', () => {
        expect(normalizeLocale('en')).toBe('en');
        expect(normalizeLocale('fr')).toBe('fr');
        expect(normalizeLocale('de')).toBe('de');
        expect(normalizeLocale('ja')).toBe('ja');
      });

      it('should handle hyphenated locales', () => {
        expect(normalizeLocale('zh-cn')).toBe('zh-cn');
        expect(normalizeLocale('zh-tw')).toBe('zh-tw');
        expect(normalizeLocale('pt-br')).toBe('pt-br');
      });
    });

    describe('case normalization', () => {
      it('should convert uppercase to lowercase', () => {
        expect(normalizeLocale('EN')).toBe('en');
        expect(normalizeLocale('FR')).toBe('fr');
        expect(normalizeLocale('ZH-CN')).toBe('zh-cn');
        expect(normalizeLocale('PT-BR')).toBe('pt-br');
      });

      it('should handle mixed case', () => {
        expect(normalizeLocale('En')).toBe('en');
        expect(normalizeLocale('Zh-Cn')).toBe('zh-cn');
        expect(normalizeLocale('Pt-Br')).toBe('pt-br');
      });
    });

    describe('underscore to hyphen conversion', () => {
      it('should convert underscore separators to hyphens', () => {
        expect(normalizeLocale('zh_cn')).toBe('zh-cn');
        expect(normalizeLocale('zh_tw')).toBe('zh-tw');
        expect(normalizeLocale('pt_br')).toBe('pt-br');
        expect(normalizeLocale('en_US')).toBe('en');
      });
    });

    describe('encoding suffix removal', () => {
      it('should remove .UTF-8 suffix', () => {
        expect(normalizeLocale('en.UTF-8')).toBe('en');
        expect(normalizeLocale('fr.UTF-8')).toBe('fr');
        expect(normalizeLocale('zh_CN.UTF-8')).toBe('zh-cn');
        expect(normalizeLocale('ja_JP.UTF-8')).toBe('ja');
      });

      it('should remove .utf8 suffix (lowercase)', () => {
        expect(normalizeLocale('en.utf8')).toBe('en');
        expect(normalizeLocale('de.utf8')).toBe('de');
      });

      it('should remove other encoding suffixes', () => {
        expect(normalizeLocale('en_US.ISO-8859-1')).toBe('en');
        expect(normalizeLocale('ru_RU.KOI8-R')).toBe('ru');
      });
    });

    describe('regional variant handling', () => {
      it('should map en-US, en-GB etc to en', () => {
        expect(normalizeLocale('en-US')).toBe('en');
        expect(normalizeLocale('en-GB')).toBe('en');
        expect(normalizeLocale('en-AU')).toBe('en');
        expect(normalizeLocale('en_US')).toBe('en');
      });

      it('should map fr-FR, fr-CA to fr', () => {
        expect(normalizeLocale('fr-FR')).toBe('fr');
        expect(normalizeLocale('fr-CA')).toBe('fr');
        expect(normalizeLocale('fr_FR')).toBe('fr');
      });

      it('should map de-DE, de-AT to de', () => {
        expect(normalizeLocale('de-DE')).toBe('de');
        expect(normalizeLocale('de-AT')).toBe('de');
        expect(normalizeLocale('de-CH')).toBe('de');
      });

      it('should map es-ES, es-MX to es', () => {
        expect(normalizeLocale('es-ES')).toBe('es');
        expect(normalizeLocale('es-MX')).toBe('es');
        expect(normalizeLocale('es-AR')).toBe('es');
      });

      it('should map ja-JP to ja', () => {
        expect(normalizeLocale('ja-JP')).toBe('ja');
        expect(normalizeLocale('ja_JP')).toBe('ja');
      });

      it('should map ko-KR to ko', () => {
        expect(normalizeLocale('ko-KR')).toBe('ko');
        expect(normalizeLocale('ko_KR')).toBe('ko');
      });
    });

    describe('Chinese variant handling', () => {
      it('should map zh-Hans to zh-cn', () => {
        expect(normalizeLocale('zh-Hans')).toBe('zh-cn');
        expect(normalizeLocale('zh-hans')).toBe('zh-cn');
      });

      it('should map zh-Hant to zh-tw', () => {
        expect(normalizeLocale('zh-Hant')).toBe('zh-tw');
        expect(normalizeLocale('zh-hant')).toBe('zh-tw');
      });

      it('should map bare zh to zh-cn', () => {
        expect(normalizeLocale('zh')).toBe('zh-cn');
      });

      it('should preserve zh-cn and zh-tw', () => {
        expect(normalizeLocale('zh-CN')).toBe('zh-cn');
        expect(normalizeLocale('zh-TW')).toBe('zh-tw');
        expect(normalizeLocale('zh_CN')).toBe('zh-cn');
        expect(normalizeLocale('zh_TW')).toBe('zh-tw');
      });
    });

    describe('Portuguese handling', () => {
      it('should map pt to pt-br', () => {
        expect(normalizeLocale('pt')).toBe('pt-br');
      });

      it('should preserve pt-br', () => {
        expect(normalizeLocale('pt-BR')).toBe('pt-br');
        expect(normalizeLocale('pt_BR')).toBe('pt-br');
      });
    });

    describe('fallback to English', () => {
      it('should fall back to en for unsupported locales', () => {
        expect(normalizeLocale('sv')).toBe('en'); // Swedish
        expect(normalizeLocale('nl')).toBe('en'); // Dutch
        expect(normalizeLocale('da')).toBe('en'); // Danish
        expect(normalizeLocale('fi')).toBe('en'); // Finnish
        expect(normalizeLocale('el')).toBe('en'); // Greek
        expect(normalizeLocale('ar')).toBe('en'); // Arabic
        expect(normalizeLocale('he')).toBe('en'); // Hebrew
        expect(normalizeLocale('th')).toBe('en'); // Thai
        expect(normalizeLocale('vi')).toBe('en'); // Vietnamese
      });

      it('should fall back to en for Norwegian', () => {
        expect(normalizeLocale('nb')).toBe('en'); // Norwegian Bokmal
        expect(normalizeLocale('nn')).toBe('en'); // Norwegian Nynorsk
        expect(normalizeLocale('no')).toBe('en'); // Norwegian generic
      });

      it('should fall back to en for invalid input', () => {
        expect(normalizeLocale('xyz')).toBe('en');
        expect(normalizeLocale('12345')).toBe('en');
        expect(normalizeLocale('')).toBe('en');
      });
    });

    describe('complex real-world locale strings', () => {
      it('should handle macOS AppleLocale format', () => {
        expect(normalizeLocale('en_US')).toBe('en');
        expect(normalizeLocale('zh_CN')).toBe('zh-cn');
        expect(normalizeLocale('ja_JP')).toBe('ja');
      });

      it('should handle Linux LANG format', () => {
        expect(normalizeLocale('en_US.UTF-8')).toBe('en');
        expect(normalizeLocale('de_DE.UTF-8')).toBe('de');
        expect(normalizeLocale('zh_CN.UTF-8')).toBe('zh-cn');
        expect(normalizeLocale('pt_BR.UTF-8')).toBe('pt-br');
      });

      it('should handle Windows culture format', () => {
        expect(normalizeLocale('en-US')).toBe('en');
        expect(normalizeLocale('fr-FR')).toBe('fr');
        expect(normalizeLocale('zh-CN')).toBe('zh-cn');
        expect(normalizeLocale('pt-BR')).toBe('pt-br');
      });
    });
  });

  describe('isValidLocale', () => {
    it('should return true for supported locales', () => {
      expect(isValidLocale('en')).toBe(true);
      expect(isValidLocale('zh-cn')).toBe(true);
      expect(isValidLocale('fr')).toBe(true);
      expect(isValidLocale('ja')).toBe(true);
    });

    it('should return false for unsupported locales', () => {
      expect(isValidLocale('sv')).toBe(false);
      expect(isValidLocale('nl')).toBe(false);
      expect(isValidLocale('en-US')).toBe(false); // Not in the list (en is, not en-US)
      expect(isValidLocale('xyz')).toBe(false);
    });
  });

  describe('detectLocale', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Clear relevant environment variables
      delete process.env.AUTOHAND_LOCALE;
      delete process.env.LC_ALL;
      delete process.env.LC_MESSAGES;
      delete process.env.LANG;
    });

    afterEach(() => {
      // Restore original environment
      process.env = { ...originalEnv };
    });

    describe('priority chain', () => {
      it('should prioritize CLI override', () => {
        process.env.LANG = 'de_DE.UTF-8';
        const result = detectLocale({
          cliOverride: 'fr',
          configLocale: 'ja',
        });
        expect(result.locale).toBe('fr');
        expect(result.source).toBe('cli');
      });

      it('should use config when no CLI override', () => {
        process.env.LANG = 'de_DE.UTF-8';
        const result = detectLocale({
          configLocale: 'ja',
        });
        expect(result.locale).toBe('ja');
        expect(result.source).toBe('config');
      });

      it('should use AUTOHAND_LOCALE environment variable', () => {
        process.env.AUTOHAND_LOCALE = 'es';
        process.env.LANG = 'de_DE.UTF-8';
        const result = detectLocale({});
        expect(result.locale).toBe('es');
        expect(result.source).toBe('env');
      });

      it('should use LC_ALL over LANG', () => {
        process.env.LC_ALL = 'fr_FR.UTF-8';
        process.env.LANG = 'de_DE.UTF-8';
        const result = detectLocale({});
        expect(result.locale).toBe('fr');
        expect(result.source).toBe('env');
      });

      it('should use LC_MESSAGES when LC_ALL not set', () => {
        process.env.LC_MESSAGES = 'it_IT.UTF-8';
        process.env.LANG = 'de_DE.UTF-8';
        const result = detectLocale({});
        expect(result.locale).toBe('it');
        expect(result.source).toBe('env');
      });

      it('should use LANG as fallback', () => {
        process.env.LANG = 'ko_KR.UTF-8';
        const result = detectLocale({});
        expect(result.locale).toBe('ko');
        expect(result.source).toBe('env');
      });

      it('should fall back to en when no locale detected', () => {
        const result = detectLocale({});
        // This might detect OS locale or fall back to en
        expect(SUPPORTED_LOCALES).toContain(result.locale);
        expect(['env', 'os', 'fallback']).toContain(result.source);
      });
    });

    describe('raw locale preservation', () => {
      it('should preserve raw locale from CLI', () => {
        const result = detectLocale({ cliOverride: 'zh-CN' });
        expect(result.locale).toBe('zh-cn');
        expect(result.rawLocale).toBe('zh-CN');
      });

      it('should preserve raw locale from config', () => {
        const result = detectLocale({ configLocale: 'pt_BR.UTF-8' });
        expect(result.locale).toBe('pt-br');
        expect(result.rawLocale).toBe('pt_BR.UTF-8');
      });

      it('should preserve raw locale from environment', () => {
        process.env.LANG = 'ja_JP.UTF-8';
        const result = detectLocale({});
        expect(result.locale).toBe('ja');
        expect(result.rawLocale).toBe('ja_JP.UTF-8');
      });
    });
  });

  describe('detectOSLocale', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      delete process.env.LC_ALL;
      delete process.env.LC_MESSAGES;
      delete process.env.LANG;
      delete process.env.LANGUAGE;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should return locale from LC_ALL', () => {
      process.env.LC_ALL = 'fr_FR.UTF-8';
      const result = detectOSLocale();
      expect(result).toBe('fr_FR.UTF-8');
    });

    it('should return locale from LC_MESSAGES when LC_ALL not set', () => {
      process.env.LC_MESSAGES = 'de_DE.UTF-8';
      const result = detectOSLocale();
      expect(result).toBe('de_DE.UTF-8');
    });

    it('should return locale from LANG', () => {
      process.env.LANG = 'es_ES.UTF-8';
      const result = detectOSLocale();
      expect(result).toBe('es_ES.UTF-8');
    });

    it('should return locale from LANGUAGE', () => {
      process.env.LANGUAGE = 'it';
      const result = detectOSLocale();
      expect(result).toBe('it');
    });

    // Platform-specific tests would require mocking execSync
    // which is more complex and not strictly necessary for unit tests
  });
});
