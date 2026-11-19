/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { CLI_LANES_FEATURE_ID, isCliLanesEnabled } from '../../../src/core/lanes/feature.js';
import { hasLaneOption, lanesPromptSection, syncLaneTool, withLaneOption } from '../../../src/core/lanes/laneTool.js';
import { SystemPromptBuilder } from '../../../src/core/agent/SystemPromptBuilder.js';
import { DEFAULT_TOOL_DEFINITIONS, ToolManager, type ToolDefinition } from '../../../src/core/toolManager.js';
import { findFeature, getFeatureState, listFeatureStates, setFeatureState } from '../../../src/features/featureRegistry.js';
import type { LoadedConfig } from '../../../src/types.js';

const config = (features?: LoadedConfig['features']): LoadedConfig =>
  ({ configPath: '/fixture/config.json', ...(features ? { features } : {}) }) as LoadedConfig;

const delegateTask = (): ToolDefinition => {
  const definition = DEFAULT_TOOL_DEFINITIONS.find(candidate => candidate.name === 'delegate_task');
  if (!definition) throw new Error('delegate_task is not a default tool');
  return definition;
};

function toolManager(): ToolManager {
  return new ToolManager({
    executor: async () => ({ success: true }),
    confirmApproval: vi.fn(),
  } as unknown as ConstructorParameters<typeof ToolManager>[0]);
}

function promptBuilder(definitions: ToolDefinition[], features: LoadedConfig['features'] = {}) {
  return new SystemPromptBuilder({
    runtime: { options: {}, workspaceRoot: '/fixture/workspace', config: { configPath: '/fixture/config.json', features } },
    getToolDefinitions: () => definitions,
    getContextMemories: vi.fn(async () => ''),
    loadInstructionFiles: vi.fn(async () => []),
    listSkills: vi.fn(() => []),
    getActiveSkills: vi.fn(() => []),
    getTeam: vi.fn(() => null),
  } as unknown as ConstructorParameters<typeof SystemPromptBuilder>[0]);
}

describe('cli_lanes experiment flag', () => {
  it('is registered as a default-off experiment stored under features.cliLanes', () => {
    expect(findFeature(CLI_LANES_FEATURE_ID)).toMatchObject({
      id: 'cli_lanes', stage: 'experimental', configPath: 'features.cliLanes', defaultEnabled: false,
    });
    expect(findFeature(CLI_LANES_FEATURE_ID)?.requiresRestart).toBeFalsy();
    expect(listFeatureStates(config()).find(feature => feature.id === 'cli_lanes')?.enabled).toBe(false);
  });

  it('is off without a config, off by default, and follows an explicit setting', () => {
    expect(isCliLanesEnabled(undefined)).toBe(false);
    expect(isCliLanesEnabled(null)).toBe(false);
    expect(isCliLanesEnabled(config())).toBe(false);
    expect(isCliLanesEnabled(config({ cliLanes: true }))).toBe(true);
    expect(isCliLanesEnabled(config({ cliLanes: false }))).toBe(false);
  });

  it('can be turned on and off through the experiment registry', () => {
    const target = config();
    expect(setFeatureState(target, 'cli_lanes', true)).toMatchObject({ ok: true, feature: { enabled: true } });
    expect(target.features?.cliLanes).toBe(true);
    expect(setFeatureState(target, 'cli_lanes', false)).toMatchObject({ ok: true, feature: { enabled: false } });
    expect(target.features?.cliLanes).toBe(false);
    expect(getFeatureState(target, 'cli_lanes')?.enabled).toBe(false);
  });
});

describe('lane option on delegate_task', () => {
  it('adds optional lane_name and lane_description without touching the base definition', () => {
    const base = delegateTask();
    const withLanes = withLaneOption(base, true);

    expect(hasLaneOption(base)).toBe(false);
    expect(hasLaneOption(withLanes)).toBe(true);
    expect(Object.keys(withLanes.parameters?.properties ?? {})).toEqual(
      [...Object.keys(base.parameters?.properties ?? {}), 'lane_name', 'lane_description'],
    );
    expect(withLanes.parameters?.required).toEqual(['agent_name', 'task']);
    expect(withLanes.description).toContain('lane');
    expect(base.description).not.toMatch(/lane/i);
    expect(base.parameters?.properties).not.toHaveProperty('lane_name');
  });

  it('is idempotent and fully reversible', () => {
    const base = delegateTask();
    const once = withLaneOption(base, true);
    expect(withLaneOption(once, true)).toEqual(once);
    expect(withLaneOption(once, false)).toEqual(base);
    expect(withLaneOption(base, false)).toEqual(base);
  });

  it('advertises the lane option to the model only while lanes are available', () => {
    const manager = toolManager();
    const advertised = () => manager.toFunctionDefinitions().find(tool => tool.name === 'delegate_task');
    const serialized = () => JSON.stringify(manager.toFunctionDefinitions());

    expect(serialized()).not.toMatch(/lane/i);
    syncLaneTool(manager, true);
    expect(advertised()?.parameters?.properties).toHaveProperty('lane_name');
    expect(advertised()?.parameters?.properties).toHaveProperty('lane_description');
    syncLaneTool(manager, false);
    expect(serialized()).not.toMatch(/lane/i);
  });

  it('adds no lane-specific tool', () => {
    const manager = toolManager();
    const before = manager.listAllDefinitions().map(definition => definition.name);
    syncLaneTool(manager, true);
    expect(manager.listAllDefinitions().map(definition => definition.name)).toEqual(before);
  });

  it('leaves the tool set alone when delegation is not registered', () => {
    const manager = toolManager();
    manager.unregister('delegate_task');
    syncLaneTool(manager, true);
    expect(manager.listAllDefinitions().some(definition => definition.name === 'delegate_task')).toBe(false);
  });
});

describe('lanes in the system prompt', () => {
  it('has no section unless delegate_task carries the lane option', () => {
    expect(lanesPromptSection(DEFAULT_TOOL_DEFINITIONS)).toEqual([]);
    expect(lanesPromptSection([])).toEqual([]);
    const section = lanesPromptSection([withLaneOption(delegateTask(), true)]).join('\n');
    expect(section).toContain('### Lanes');
    expect(section).toContain('delegate_task');
    expect(section).toContain('lane_name');
    expect(section).toContain('lane_description');
    expect(section).toContain('kebab-case');
  });

  it.each([
    ['code mode', { codeMode: true }],
    ['direct tool calls', { codeMode: false }],
  ])('never mentions lanes with %s while the lane option is absent', async (_label, features) => {
    const prompt = await promptBuilder([...DEFAULT_TOOL_DEFINITIONS], features).build();
    expect(prompt).not.toContain('### Lanes');
    expect(prompt).not.toContain('lane_name');
    expect(prompt).not.toMatch(/background lane|open a new lane/i);
  });

  it.each([
    ['code mode', { codeMode: true }],
    ['direct tool calls', { codeMode: false }],
  ])('teaches the model to open a lane with %s once the option is advertised', async (_label, features) => {
    const definitions = DEFAULT_TOOL_DEFINITIONS.map(definition =>
      definition.name === 'delegate_task' ? withLaneOption(definition, true) : definition);
    const prompt = await promptBuilder(definitions, features).build();
    expect(prompt).toContain('### Lanes');
    expect(prompt).toContain('lane_name');
    expect(prompt).toMatch(/open a new lane/i);
  });
});
