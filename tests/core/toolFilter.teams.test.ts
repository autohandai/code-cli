/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  getToolCategory,
  detectRelevantCategories,
} from '../../src/core/toolFilter.js';
import type { LLMMessage } from '../../src/types.js';

describe('ToolFilter team tools', () => {
  const teamTools = ['create_team', 'add_teammate', 'create_task', 'team_status', 'send_team_message'];

  describe('getToolCategory', () => {
    it('classifies all team tools as meta', () => {
      for (const tool of teamTools) {
        expect(getToolCategory(tool)).toBe('meta');
      }
    });
  });

  describe('CATEGORY_TRIGGERS', () => {
    function messagesWithContent(text: string): LLMMessage[] {
      return [{ role: 'user', content: text }];
    }

    it('triggers meta category on "team" keyword', () => {
      const cats = detectRelevantCategories(messagesWithContent('let\'s form a team'));
      expect(cats.has('meta')).toBe(true);
    });

    it('triggers meta category on "teammate" keyword', () => {
      const cats = detectRelevantCategories(messagesWithContent('add a teammate'));
      expect(cats.has('meta')).toBe(true);
    });

    it('triggers meta category on "together" keyword', () => {
      const cats = detectRelevantCategories(messagesWithContent('let\'s work together'));
      expect(cats.has('meta')).toBe(true);
    });

    it('triggers meta category on "engineers" keyword', () => {
      const cats = detectRelevantCategories(messagesWithContent('bring some engineers'));
      expect(cats.has('meta')).toBe(true);
    });

    it('triggers meta category on "crew" keyword', () => {
      const cats = detectRelevantCategories(messagesWithContent('get a crew going'));
      expect(cats.has('meta')).toBe(true);
    });

    it('triggers meta category on "collaborate" keyword', () => {
      const cats = detectRelevantCategories(messagesWithContent('we need to collaborate'));
      expect(cats.has('meta')).toBe(true);
    });

    it('does not trigger meta on unrelated content', () => {
      const cats = detectRelevantCategories(messagesWithContent('read the README file'));
      expect(cats.has('meta')).toBe(false);
    });
  });
});
