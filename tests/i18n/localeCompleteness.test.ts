/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS, slashCommandDescriptionKey } from '../../src/core/slashCommands.js';

/**
 * The display languages published on autohand.ai. Each must translate every
 * English key with the same interpolation placeholders, so no screen falls
 * back to English or prints a raw `{{token}}`.
 */
const PUBLISHED_LOCALES = ['pt-br', 'es', 'ko', 'ja', 'kk', 'ru'] as const;

const LOCALES_DIR = join(__dirname, '../../src/i18n/locales');
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

type Flat = Record<string, unknown>;

function flatten(value: Record<string, unknown>, prefix = '', out: Flat = {}): Flat {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object') flatten(child as Record<string, unknown>, path, out);
    else out[path] = child;
  }
  return out;
}

function load(locale: string): Flat {
  return flatten(JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')) as Record<string, unknown>);
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
}

const en = load('en');

describe('locale completeness', () => {
  it('English strings are non-empty', () => {
    const empty = Object.entries(en).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });

  describe.each(PUBLISHED_LOCALES)('%s', (locale) => {
    const translated = load(locale);

    it('has every key that en.json has', () => {
      const missing = Object.keys(en).filter((key) => !(key in translated));
      expect(missing).toEqual([]);
    });

    it('has no keys that en.json does not have (other than plural forms)', () => {
      const extra = Object.keys(translated).filter((key) => {
        if (key in en) return false;
        const base = key.replace(PLURAL_SUFFIX, '');
        return !(PLURAL_SUFFIX.test(key) && `${base}_other` in en);
      });
      expect(extra).toEqual([]);
    });

    it('has a non-empty string for every key', () => {
      const empty = Object.entries(translated)
        .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
        .map(([k]) => k);
      expect(empty).toEqual([]);
    });

    it('keeps the same {{placeholders}} as English', () => {
      const mismatched = Object.entries(translated)
        .map(([key, value]) => {
          const source = en[key] ?? en[key.replace(PLURAL_SUFFIX, '_other')];
          if (typeof source !== 'string' || typeof value !== 'string') return null;
          const want = placeholders(source).join(',');
          const got = placeholders(value).join(',');
          return want === got ? null : `${key}: expected [${want}] got [${got}]`;
        })
        .filter(Boolean);
      expect(mismatched).toEqual([]);
    });
  });

  it('every registered slash command has a description key in en.json', () => {
    const missing = SLASH_COMMANDS
      .map((cmd) => slashCommandDescriptionKey(cmd.command))
      .filter((key) => !(key in en));
    expect(missing).toEqual([]);
  });
});
