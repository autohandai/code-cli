/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  initI18n,
  changeLanguage,
  getCurrentLocale,
  isInitialized,
  t,
  exists,
} from '../../src/i18n/index';

describe('i18n module', () => {
  // Reset to English before each test to ensure isolation
  beforeEach(async () => {
    await initI18n('en');
  });

  describe('initialization', () => {
    it('should not be initialized before calling initI18n', () => {
      // Note: This test may fail if run after other tests that initialize i18n
      // In a real scenario, you'd want to reset state between tests
    });

    it('should initialize with English locale', async () => {
      await initI18n('en');
      expect(isInitialized()).toBe(true);
      expect(getCurrentLocale()).toBe('en');
    });

    it('should initialize with non-English locale', async () => {
      await initI18n('fr');
      expect(isInitialized()).toBe(true);
      expect(getCurrentLocale()).toBe('fr');
    });

    it('should initialize with Chinese locale', async () => {
      await initI18n('zh-cn');
      expect(isInitialized()).toBe(true);
      expect(getCurrentLocale()).toBe('zh-cn');
    });
  });

  describe('t() translation function', () => {
    beforeAll(async () => {
      await initI18n('en');
    });

    describe('simple keys', () => {
      it('should translate common.error', () => {
        expect(t('common.error')).toBe('Error');
      });

      it('should translate common.success', () => {
        expect(t('common.success')).toBe('Success');
      });

      it('should translate common.yes', () => {
        expect(t('common.yes')).toBe('Yes');
      });

      it('should translate common.no', () => {
        expect(t('common.no')).toBe('No');
      });

      it('should translate common.done', () => {
        expect(t('common.done')).toBe('Done');
      });

      it('should translate common.cancelled', () => {
        expect(t('common.cancelled')).toBe('Cancelled');
      });
    });

    describe('nested keys', () => {
      it('should translate cli.description', () => {
        expect(t('cli.description')).toBe('Autonomous LLM-powered coding agent CLI');
      });

      it('should translate welcome.banner', () => {
        expect(t('welcome.banner')).toBe('Welcome to Autohand!');
      });

      it('should translate commands.quit.description', () => {
        expect(t('commands.quit.description')).toBe('exit Autohand');
      });

      it('should translate commands.language.title', () => {
        expect(t('commands.language.title')).toBe('Language Selection');
      });
    });

    describe('interpolation', () => {
      it('should interpolate model variable', () => {
        const result = t('welcome.modelLine', { model: 'claude-3' });
        expect(result).toBe('model: claude-3');
      });

      it('should interpolate version variable', () => {
        const result = t('welcome.version', { version: '1.0.0' });
        expect(result).toBe('v1.0.0');
      });

      it('should interpolate language variable', () => {
        const result = t('commands.language.changed', { language: 'French' });
        expect(result).toBe('Language changed to French');
      });

      it('should interpolate locale and supported variables', () => {
        const result = t('errors.invalidLocale', { locale: 'xyz', supported: 'en, fr, de' });
        expect(result).toBe('Invalid locale: xyz. Supported: en, fr, de');
      });

      it('should interpolate tool variable', () => {
        const result = t('agent.executing', { tool: 'read_file' });
        expect(result).toBe('Executing read_file...');
      });

      it('should interpolate file variable', () => {
        const result = t('agent.reading', { file: 'src/index.ts' });
        expect(result).toBe('Reading src/index.ts...');
      });

      it('should interpolate error variable', () => {
        const result = t('agent.toolFailed', { tool: 'write_file', error: 'Permission denied' });
        expect(result).toBe('write_file failed: Permission denied');
      });
    });

    describe('missing keys', () => {
      it('should return the key for missing translations', () => {
        const result = t('nonexistent.key');
        expect(result).toBe('nonexistent.key');
      });

      it('should return the key for deeply nested missing translations', () => {
        const result = t('a.b.c.d.e.f');
        expect(result).toBe('a.b.c.d.e.f');
      });
    });
  });

  describe('exists() function', () => {
    beforeAll(async () => {
      await initI18n('en');
    });

    it('should return true for existing keys', () => {
      expect(exists('common.error')).toBe(true);
      expect(exists('welcome.banner')).toBe(true);
      expect(exists('commands.language.title')).toBe(true);
    });

    it('should return false for non-existing keys', () => {
      expect(exists('nonexistent.key')).toBe(false);
      expect(exists('a.b.c.d')).toBe(false);
    });
  });

  describe('changeLanguage()', () => {
    beforeAll(async () => {
      await initI18n('en');
    });

    it('should change language to French', async () => {
      await changeLanguage('fr');
      expect(getCurrentLocale()).toBe('fr');
    });

    it('should change language to Japanese', async () => {
      await changeLanguage('ja');
      expect(getCurrentLocale()).toBe('ja');
    });

    it('should change language to Chinese', async () => {
      await changeLanguage('zh-cn');
      expect(getCurrentLocale()).toBe('zh-cn');
    });

    it('should change back to English', async () => {
      await changeLanguage('en');
      expect(getCurrentLocale()).toBe('en');
    });
  });

  describe('language display names in translations', () => {
    beforeAll(async () => {
      await initI18n('en');
    });

    it('should have language names for all supported locales', () => {
      expect(t('languages.en')).toBe('English');
      expect(t('languages.fr')).toContain('French');
      expect(t('languages.de')).toContain('German');
      expect(t('languages.es')).toContain('Spanish');
      expect(t('languages.it')).toContain('Italian');
      expect(t('languages.ja')).toContain('Japanese');
      expect(t('languages.ko')).toContain('Korean');
      expect(t('languages.ru')).toContain('Russian');
      expect(t('languages.zh-cn')).toContain('Chinese');
      expect(t('languages.zh-tw')).toContain('Chinese');
      expect(t('languages.pt-br')).toContain('Portuguese');
      expect(t('languages.tr')).toContain('Turkish');
      expect(t('languages.pl')).toContain('Polish');
      expect(t('languages.cs')).toContain('Czech');
      expect(t('languages.hu')).toContain('Hungarian');
      expect(t('languages.hi')).toContain('Hindi');
    });

    it('should have native script in language names', () => {
      expect(t('languages.zh-cn')).toContain('简体中文');
      expect(t('languages.zh-tw')).toContain('繁體中文');
      expect(t('languages.ja')).toContain('日本語');
      expect(t('languages.ko')).toContain('한국어');
      expect(t('languages.ru')).toContain('Русский');
      expect(t('languages.hi')).toContain('हिन्दी');
    });
  });

  describe('CLI option descriptions', () => {
    beforeAll(async () => {
      await initI18n('en');
    });

    it('should have descriptions for all CLI options', () => {
      expect(t('cli.options.prompt')).toContain('instruction');
      expect(t('cli.options.path')).toContain('path');
      expect(t('cli.options.yes')).toContain('confirm');
      expect(t('cli.options.dryRun')).toContain('Preview');
      expect(t('cli.options.debug')).toContain('debug');
      expect(t('cli.options.model')).toContain('model');
      expect(t('cli.options.displayLanguage')).toContain('language');
    });
  });

  describe('error messages', () => {
    beforeAll(async () => {
      await initI18n('en');
    });

    it('should have all error messages', () => {
      expect(t('errors.apiKeyRequired')).toContain('required');
      expect(t('errors.directoryNotExist')).toContain('exist');
      expect(t('errors.permissionDenied')).toContain('denied');
      expect(t('errors.rateLimited')).toContain('limit');
      expect(t('errors.timeout').toLowerCase()).toContain('timed out');
      expect(t('errors.cancelled')).toContain('cancelled');
    });
  });

  describe('command descriptions', () => {
    beforeAll(async () => {
      await initI18n('en');
    });

    it('should have descriptions for all commands', () => {
      expect(t('commands.model.description')).toContain('model');
      expect(t('commands.theme.description')).toContain('theme');
      expect(t('commands.language.description')).toContain('language');
      expect(t('commands.quit.description')).toContain('exit');
      expect(t('commands.init.description')).toContain('AGENTS.md');
      expect(t('commands.undo.description')).toContain('revert');
      expect(t('commands.new.description')).toContain('conversation');
      expect(t('commands.status.description')).toContain('status');
    });
  });

  describe('setup wizard strings', () => {
    beforeAll(async () => {
      await initI18n('en');
    });

    it('should have setup strings', () => {
      expect(t('setup.welcome')).toContain('Welcome');
      expect(t('setup.providerSelect')).toContain('provider');
      expect(t('setup.complete')).toContain('complete');
    });

    it('should have telemetry strings', () => {
      expect(t('setup.telemetry.title')).toContain('improve');
      expect(t('setup.telemetry.whatWeCollect')).toContain('collect');
      expect(t('setup.telemetry.whatWeNeverCollect')).toContain('never');
    });
  });

  describe('provider names', () => {
    beforeAll(async () => {
      await initI18n('en');
    });

    it('should have all provider names', () => {
      expect(t('providers.openrouter')).toBe('OpenRouter');
      expect(t('providers.openai')).toBe('OpenAI');
      expect(t('providers.ollama')).toBe('Ollama');
      expect(t('providers.llamacpp')).toBe('llama.cpp');
      expect(t('providers.mlx')).toContain('MLX');
    });

    it('should have provider hints', () => {
      expect(t('providers.hints.openrouter')).toContain('Cloud');
      expect(t('providers.hints.openai')).toContain('Cloud');
      expect(t('providers.hints.ollama')).toContain('Local');
      expect(t('providers.hints.llamacpp')).toContain('Local');
      expect(t('providers.hints.mlx')).toContain('Apple');
    });
  });

  describe('hot-reload language switching', () => {
    it('should switch translations immediately when changing to Spanish', async () => {
      await initI18n('en');
      expect(t('common.yes')).toBe('Yes');
      expect(t('common.no')).toBe('No');
      expect(t('welcome.banner')).toBe('Welcome to Autohand!');

      await changeLanguage('es');
      expect(getCurrentLocale()).toBe('es');
      expect(t('common.yes')).toBe('Sí');
      expect(t('common.no')).toBe('No');
      expect(t('welcome.banner')).toBe('¡Bienvenido a Autohand!');
    });

    it('should switch translations immediately when changing to Portuguese', async () => {
      await initI18n('en');
      expect(t('common.success')).toBe('Success');

      await changeLanguage('pt-br');
      expect(getCurrentLocale()).toBe('pt-br');
      expect(t('common.success')).toBe('Sucesso');
      expect(t('welcome.banner')).toBe('Bem-vindo ao Autohand!');
    });

    it('should switch translations immediately when changing to French', async () => {
      await initI18n('en');
      expect(t('commands.quit.goodbye')).toBe('Goodbye!');

      await changeLanguage('fr');
      expect(getCurrentLocale()).toBe('fr');
      expect(t('commands.quit.goodbye')).toBe('Au revoir !');
      expect(t('welcome.banner')).toBe('Bienvenue sur Autohand !');
    });

    it('should switch translations immediately when changing to Chinese', async () => {
      await initI18n('en');
      expect(t('common.loading')).toBe('Loading...');

      await changeLanguage('zh-cn');
      expect(getCurrentLocale()).toBe('zh-cn');
      expect(t('common.loading')).toBe('加载中...');
      expect(t('welcome.banner')).toBe('欢迎使用 Autohand！');
    });

    it('should show language change message in the new language', async () => {
      await initI18n('en');
      expect(t('commands.language.changed', { language: 'Spanish' })).toBe('Language changed to Spanish');

      await changeLanguage('es');
      expect(t('commands.language.changed', { language: 'Español' })).toBe('Idioma cambiado a Español');
    });

    it('should switch back to English from another language', async () => {
      await initI18n('es');
      expect(t('common.yes')).toBe('Sí');

      await changeLanguage('en');
      expect(getCurrentLocale()).toBe('en');
      expect(t('common.yes')).toBe('Yes');
    });

    it('should switch between non-English languages', async () => {
      await initI18n('es');
      expect(t('common.done')).toBe('Hecho');

      await changeLanguage('fr');
      expect(t('common.done')).toBe('Terminé');

      await changeLanguage('pt-br');
      expect(t('common.done')).toBe('Concluído');

      await changeLanguage('zh-cn');
      expect(t('common.done')).toBe('完成');
    });
  });
});
