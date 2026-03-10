/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';

describe('find_agent_skills tool', () => {
  describe('tool definition', () => {
    it('exists in DEFAULT_TOOL_DEFINITIONS', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills');
      expect(def).toBeDefined();
    });

    it('has correct name and description', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills');
      expect(def!.name).toBe('find_agent_skills');
      expect(def!.description).toContain('skill');
    });

    it('requires query parameter', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills');
      expect(def!.parameters?.required).toContain('query');
    });

    it('has optional category and limit parameters', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills');
      expect(def!.parameters?.properties).toHaveProperty('category');
      expect(def!.parameters?.properties).toHaveProperty('limit');
      expect(def!.parameters?.required).not.toContain('category');
      expect(def!.parameters?.required).not.toContain('limit');
    });

    it('does not require approval', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills');
      expect(def!.requiresApproval).toBeUndefined();
    });
  });
});
