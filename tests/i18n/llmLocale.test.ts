/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  buildLocaleInstruction,
  injectLocaleIntoPrompt,
} from '../../src/i18n/llmLocale';
import type { SupportedLocale } from '../../src/i18n/localeDetector';

describe('llmLocale', () => {
  describe('buildLocaleInstruction', () => {
    describe('English locale', () => {
      it('should return empty string for English', () => {
        const result = buildLocaleInstruction('en');
        expect(result).toBe('');
      });
    });

    describe('non-English locales', () => {
      it('should include language preference header for French', () => {
        const result = buildLocaleInstruction('fr');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('French');
        expect(result).toContain('Français');
      });

      it('should include language preference header for German', () => {
        const result = buildLocaleInstruction('de');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('German');
        expect(result).toContain('Deutsch');
      });

      it('should include language preference header for Spanish', () => {
        const result = buildLocaleInstruction('es');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Spanish');
        expect(result).toContain('Español');
      });

      it('should include language preference header for Italian', () => {
        const result = buildLocaleInstruction('it');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Italian');
        expect(result).toContain('Italiano');
      });

      it('should include language preference header for Japanese', () => {
        const result = buildLocaleInstruction('ja');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Japanese');
        expect(result).toContain('日本語');
      });

      it('should include language preference header for Korean', () => {
        const result = buildLocaleInstruction('ko');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Korean');
        expect(result).toContain('한국어');
      });

      it('should include language preference header for Russian', () => {
        const result = buildLocaleInstruction('ru');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Russian');
        expect(result).toContain('Русский');
      });

      it('should include language preference header for Simplified Chinese', () => {
        const result = buildLocaleInstruction('zh-cn');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Simplified Chinese');
        expect(result).toContain('简体中文');
      });

      it('should include language preference header for Traditional Chinese', () => {
        const result = buildLocaleInstruction('zh-tw');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Traditional Chinese');
        expect(result).toContain('繁體中文');
      });

      it('should include language preference header for Brazilian Portuguese', () => {
        const result = buildLocaleInstruction('pt-br');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Brazilian Portuguese');
        expect(result).toContain('Português');
      });

      it('should include language preference header for Turkish', () => {
        const result = buildLocaleInstruction('tr');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Turkish');
        expect(result).toContain('Türkçe');
      });

      it('should include language preference header for Polish', () => {
        const result = buildLocaleInstruction('pl');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Polish');
        expect(result).toContain('Polski');
      });

      it('should include language preference header for Czech', () => {
        const result = buildLocaleInstruction('cs');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Czech');
        expect(result).toContain('Čeština');
      });

      it('should include language preference header for Hungarian', () => {
        const result = buildLocaleInstruction('hu');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Hungarian');
        expect(result).toContain('Magyar');
      });

      it('should include language preference header for Hindi', () => {
        const result = buildLocaleInstruction('hi');
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Hindi');
        expect(result).toContain('हिन्दी');
      });
    });

    describe('instruction content', () => {
      it('should include guidance to keep code in original form', () => {
        const result = buildLocaleInstruction('fr');
        expect(result).toContain('Code snippets');
        expect(result).toContain('original form');
      });

      it('should include guidance about file paths', () => {
        const result = buildLocaleInstruction('de');
        expect(result).toContain('File paths');
      });

      it('should include guidance about command names', () => {
        const result = buildLocaleInstruction('es');
        expect(result).toContain('Command names');
      });

      it('should include guidance about technical identifiers', () => {
        const result = buildLocaleInstruction('ja');
        expect(result).toContain('Technical identifiers');
      });

      it('should include guidance about JSON output', () => {
        const result = buildLocaleInstruction('ko');
        expect(result).toContain('JSON output');
      });

      it('should include guidance about error messages from tools', () => {
        const result = buildLocaleInstruction('ru');
        expect(result).toContain('Error messages from tools');
      });

      it('should include guidance about code comments', () => {
        const result = buildLocaleInstruction('zh-cn');
        expect(result).toContain('Code comments');
      });

      it('should mention explanations and descriptions', () => {
        const result = buildLocaleInstruction('pt-br');
        expect(result).toContain('Explanations');
        expect(result).toContain('descriptions');
      });

      it('should mention conversational responses', () => {
        const result = buildLocaleInstruction('tr');
        expect(result).toContain('Conversational responses');
      });

      it('should mention suggestions and recommendations', () => {
        const result = buildLocaleInstruction('pl');
        expect(result).toContain('Suggestions');
        expect(result).toContain('recommendations');
      });
    });
  });

  describe('injectLocaleIntoPrompt', () => {
    const basePrompt = 'You are a helpful coding assistant.\n\n## Tools\n\nYou have access to the following tools:';

    describe('English locale', () => {
      it('should return original prompt unchanged for English', () => {
        const result = injectLocaleIntoPrompt(basePrompt, 'en');
        expect(result).toBe(basePrompt);
      });
    });

    describe('non-English locales', () => {
      it('should append locale instruction for French', () => {
        const result = injectLocaleIntoPrompt(basePrompt, 'fr');
        expect(result).toContain(basePrompt);
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('French');
        expect(result.length).toBeGreaterThan(basePrompt.length);
      });

      it('should append locale instruction for Japanese', () => {
        const result = injectLocaleIntoPrompt(basePrompt, 'ja');
        expect(result).toContain(basePrompt);
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Japanese');
        expect(result).toContain('日本語');
      });

      it('should append locale instruction for Chinese', () => {
        const result = injectLocaleIntoPrompt(basePrompt, 'zh-cn');
        expect(result).toContain(basePrompt);
        expect(result).toContain('## Response Language Preference');
        expect(result).toContain('Simplified Chinese');
        expect(result).toContain('简体中文');
      });

      it('should append locale instruction at the end', () => {
        const result = injectLocaleIntoPrompt(basePrompt, 'de');
        expect(result.startsWith(basePrompt)).toBe(true);
        expect(result.indexOf('## Response Language Preference')).toBeGreaterThan(basePrompt.length);
      });

      it('should add newline separator between base prompt and locale instruction', () => {
        const result = injectLocaleIntoPrompt(basePrompt, 'es');
        expect(result).toContain(basePrompt + '\n');
      });
    });

    describe('all supported locales', () => {
      const allLocales: SupportedLocale[] = [
        'en', 'zh-cn', 'zh-tw', 'fr', 'de', 'it', 'es',
        'ja', 'ko', 'ru', 'pt-br', 'tr', 'pl', 'cs', 'hu', 'hi'
      ];

      it.each(allLocales)('should handle %s locale correctly', (locale) => {
        const result = injectLocaleIntoPrompt(basePrompt, locale);

        // English should return unchanged
        if (locale === 'en') {
          expect(result).toBe(basePrompt);
        } else {
          // All others should have the locale instruction
          expect(result).toContain(basePrompt);
          expect(result).toContain('## Response Language Preference');
          expect(result.length).toBeGreaterThan(basePrompt.length);
        }
      });
    });

    describe('edge cases', () => {
      it('should handle empty base prompt', () => {
        const result = injectLocaleIntoPrompt('', 'fr');
        expect(result).toContain('## Response Language Preference');
      });

      it('should handle prompt with trailing newlines', () => {
        const promptWithNewlines = basePrompt + '\n\n\n';
        const result = injectLocaleIntoPrompt(promptWithNewlines, 'de');
        expect(result).toContain('## Response Language Preference');
      });

      it('should handle prompt with unicode characters', () => {
        const unicodePrompt = 'Welcome! 你好 مرحبا שלום';
        const result = injectLocaleIntoPrompt(unicodePrompt, 'ja');
        expect(result).toContain(unicodePrompt);
        expect(result).toContain('日本語');
      });

      it('should handle very long prompts', () => {
        const longPrompt = 'x'.repeat(10000);
        const result = injectLocaleIntoPrompt(longPrompt, 'ko');
        expect(result).toContain(longPrompt);
        expect(result).toContain('## Response Language Preference');
        expect(result.length).toBeGreaterThan(10000);
      });
    });
  });
});
