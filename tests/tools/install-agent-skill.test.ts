/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';

describe('install_agent_skill tool', () => {
  it('exists in DEFAULT_TOOL_DEFINITIONS', () => {
    const def = DEFAULT_TOOL_DEFINITIONS.find((tool) => tool.name === 'install_agent_skill');
    expect(def).toBeDefined();
  });

  it('requires the skill name and supports optional scope and activate options', () => {
    const def = DEFAULT_TOOL_DEFINITIONS.find((tool) => tool.name === 'install_agent_skill');

    expect(def?.parameters?.required).toContain('name');
    expect(def?.parameters?.properties.scope.enum).toEqual(['project', 'user']);
    expect(def?.parameters?.properties).toHaveProperty('activate');
  });

  it('describes the community install workflow', () => {
    const def = DEFAULT_TOOL_DEFINITIONS.find((tool) => tool.name === 'install_agent_skill');

    expect(def?.description).toContain('community');
    expect(def?.description).toContain('install');
  });
});
