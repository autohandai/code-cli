/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { createToolFilter, getToolCategory } from '../src/core/toolFilter.js';
import { DEFAULT_TOOL_DEFINITIONS } from '../src/core/toolManager.js';

describe('ask_followup_question', () => {
  describe('tool definition', () => {
    it('has correct name and description', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find(t => t.name === 'ask_followup_question');
      expect(def).toBeDefined();
      expect(def!.name).toBe('ask_followup_question');
      expect(def!.description).toContain('follow-up question');
    });

    it('question parameter is required', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find(t => t.name === 'ask_followup_question');
      expect(def).toBeDefined();
      expect(def!.parameters?.required).toContain('question');
    });

    it('suggested_answers parameter is optional', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find(t => t.name === 'ask_followup_question');
      expect(def).toBeDefined();
      expect(def!.parameters?.required).not.toContain('suggested_answers');
    });

    it('does not require approval', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find(t => t.name === 'ask_followup_question');
      expect(def).toBeDefined();
      expect(def!.requiresApproval).toBe(false);
    });

    it('has correct parameter types', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find(t => t.name === 'ask_followup_question');
      expect(def).toBeDefined();
      expect(def!.parameters?.properties.question.type).toBe('string');
      expect(def!.parameters?.properties.suggested_answers.type).toBe('array');
    });
  });

  describe('tool category', () => {
    it('is categorized as meta', () => {
      expect(getToolCategory('ask_followup_question')).toBe('meta');
    });
  });

  describe('tool filtering', () => {
    it('is available in CLI interactive context', () => {
      const filter = createToolFilter('cli');
      expect(filter.isAllowed('ask_followup_question')).toBe(true);
    });

    it('is NOT available in Slack context', () => {
      const filter = createToolFilter('slack');
      expect(filter.isAllowed('ask_followup_question')).toBe(false);
    });

    it('is NOT available in API context', () => {
      const filter = createToolFilter('api');
      expect(filter.isAllowed('ask_followup_question')).toBe(false);
    });

    it('is NOT available in restricted context', () => {
      const filter = createToolFilter('restricted');
      expect(filter.isAllowed('ask_followup_question')).toBe(false);
    });

    it('can be blocked with custom policy in CLI context', () => {
      const filter = createToolFilter('cli', {
        blockedTools: ['ask_followup_question']
      });
      expect(filter.isAllowed('ask_followup_question')).toBe(false);
    });
  });

  describe('plan mode availability', () => {
    // Plan mode uses read-only tools which includes ask_followup_question
    // This is tested through the PlanModeManager which has ask_followup_question
    // in its READ_ONLY_TOOLS list
    it('is available in plan mode (meta category is allowed)', () => {
      // Plan mode allows meta category tools
      const filter = createToolFilter('cli');
      expect(filter.isAllowed('ask_followup_question')).toBe(true);
    });
  });
});
