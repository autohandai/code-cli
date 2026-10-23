/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderFactory, ProviderNotConfiguredError } from '../../../src/providers/ProviderFactory.js';
import type { AgentRuntime } from '../../../src/types.js';
import {
  configureAgentRegistry,
  syncDynamicRuntimeExtensions,
} from '../../../src/core/agent/dynamicRuntimeExtensions.js';
import { ToolsRegistry } from '../../../src/core/toolsRegistry.js';
import type { ToolDefinition, ToolManager } from '../../../src/core/toolManager.js';
import { AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';
import { ExtensionRegistry } from '../../../src/extensions/ExtensionRegistry.js';
import { extensionRuntimeHost } from '../../../src/extensions/ExtensionRuntimeHost.js';
import { ExtensionService } from '../../../src/extensions/ExtensionService.js';
import { SkillsRegistry } from '../../../src/skills/SkillsRegistry.js';

describe('syncDynamicRuntimeExtensions', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await extensionRuntimeHost.deactivateAll();
    (AgentRegistry as unknown as { instance?: AgentRegistry }).instance = undefined;
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  it('loads persisted meta-tools into the active tool manager and applies external agent paths', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-dynamic-ext-'));
    tempRoots.push(tempRoot);

    const toolsDir = path.join(tempRoot, 'tools');
    const externalAgentsDir = path.join(tempRoot, 'external-agents');
    await fs.ensureDir(toolsDir);
    await fs.ensureDir(externalAgentsDir);
    await fs.writeJson(path.join(toolsDir, 'count_lines.json'), {
      name: 'count_lines',
      description: 'Count lines in a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      },
      handler: 'wc -l {{path}}',
      createdAt: '2026-01-01T00:00:00.000Z',
      source: 'user'
    });

    const registeredTools: ToolDefinition[][] = [];
    const toolManager = {
      replaceRuntimeMetaTools: vi.fn((definitions: ToolDefinition[]) => {
        registeredTools.push(definitions);
      })
    } as unknown as ToolManager;

    const runtime = {
      config: {
        configPath: '',
        externalAgents: {
          enabled: true,
          paths: [externalAgentsDir]
        }
      },
      workspaceRoot: tempRoot,
      options: {}
    } as AgentRuntime;

    await syncDynamicRuntimeExtensions(
      { toolsRegistry: new ToolsRegistry(toolsDir), toolManager },
      runtime
    );

    expect(toolManager.replaceRuntimeMetaTools).toHaveBeenCalledTimes(1);
    expect(registeredTools[0]).toEqual([
      expect.objectContaining({
        name: 'count_lines',
        description: 'Count lines in a file',
        parameters: expect.objectContaining({
          properties: expect.objectContaining({
            path: { type: 'string' }
          }),
          required: ['path']
        })
      })
    ]);
    expect(AgentRegistry.getInstance().getExternalPaths()).toEqual([externalAgentsDir]);
  });

  it('loads extension tools, agents, and skills through the existing runtime registries', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-dynamic-ext-package-'));
    tempRoots.push(tempRoot);
    const extensionsRoot = path.join(tempRoot, 'extensions');
    const packageRoot = path.join(extensionsRoot, 'autohand.test-triage');
    await fs.ensureDir(path.join(packageRoot, 'tools'));
    await fs.ensureDir(path.join(packageRoot, 'agents'));
    await fs.ensureDir(path.join(packageRoot, 'skills', 'test-triage'));
    await fs.writeJson(path.join(packageRoot, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: 'autohand.test-triage',
      name: 'Test Triage',
      version: '1.0.0',
      description: 'Triage focused test failures.',
      contributes: {
        tools: ['tools/run-focused-test.json'],
        agents: ['agents/failure-triage.md'],
        skills: ['skills/test-triage/SKILL.md'],
      },
    });
    await fs.writeJson(path.join(packageRoot, 'tools', 'run-focused-test.json'), {
      name: 'run_focused_test',
      description: 'Run one focused test file',
      parameters: {
        type: 'object',
        properties: { file: { type: 'string' } },
        required: ['file'],
      },
      handler: 'bun test {{file}}',
      source: 'user',
    });
    await fs.writeFile(
      path.join(packageRoot, 'agents', 'failure-triage.md'),
      '---\ndescription: Triage failing tests\ntools: run_focused_test\n---\nInspect the failure.\n',
    );
    await fs.writeFile(
      path.join(packageRoot, 'skills', 'test-triage', 'SKILL.md'),
      '---\nname: test-triage\ndescription: Triage failing tests with focused evidence.\n---\n\nUse run_focused_test before diagnosing.\n',
    );

    const registeredTools: ToolDefinition[][] = [];
    const toolManager = {
      replaceRuntimeMetaTools: vi.fn((definitions: ToolDefinition[]) => registeredTools.push(definitions)),
    } as unknown as ToolManager;
    const toolsRegistry = new ToolsRegistry(path.join(tempRoot, 'tools'));
    const skillsRegistry = new SkillsRegistry(path.join(tempRoot, 'skills'));
    await skillsRegistry.initialize();
    const runtime = {
      config: { configPath: '', externalAgents: { enabled: false, paths: [] } },
      workspaceRoot: tempRoot,
      options: {},
    } as AgentRuntime;

    const snapshot = await syncDynamicRuntimeExtensions(
      {
        toolsRegistry,
        toolManager,
        skillsRegistry,
        extensionRegistry: new ExtensionRegistry({ userRoot: extensionsRoot }),
      },
      runtime,
    );

    expect(snapshot?.extensions.map((extension) => extension.manifest.id)).toEqual(['autohand.test-triage']);
    expect(registeredTools[0]).toEqual([
      expect.objectContaining({ name: 'run_focused_test', description: 'Run one focused test file' }),
    ]);
    expect(toolsRegistry.getMetaTool('run_focused_test')).toBeDefined();
    expect(toolsRegistry.getMetaToolProvenance('run_focused_test')).toMatchObject({
      extensionId: 'autohand.test-triage',
    });
    expect(AgentRegistry.getInstance().getAgent('failure-triage')).toMatchObject({
      source: 'extension',
      extensionId: 'autohand.test-triage',
      tools: ['run_focused_test'],
    });
    expect(skillsRegistry.getSkill('test-triage')).toMatchObject({
      source: 'extension',
      body: expect.stringContaining('run_focused_test'),
    });
  });

  it('removes stale extension tools, agents, and skills on the next runtime snapshot', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-dynamic-ext-refresh-'));
    tempRoots.push(tempRoot);
    const extensionsRoot = path.join(tempRoot, 'extensions');
    const packageRoot = path.join(extensionsRoot, 'autohand.refresh');
    await fs.ensureDir(path.join(packageRoot, 'tools'));
    await fs.ensureDir(path.join(packageRoot, 'agents'));
    await fs.ensureDir(path.join(packageRoot, 'skills', 'refresh'));
    await fs.writeJson(path.join(packageRoot, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: 'autohand.refresh',
      name: 'Refresh',
      version: '1.0.0',
      description: 'Refresh test.',
      contributes: {
        tools: ['tools/refresh.json'],
        agents: ['agents/refresh.md'],
        skills: ['skills/refresh/SKILL.md'],
      },
    });
    await fs.writeJson(path.join(packageRoot, 'tools', 'refresh.json'), {
      name: 'refresh_tool',
      description: 'Refresh tool',
      parameters: { type: 'object', properties: {} },
      handler: 'echo refresh',
      source: 'user',
    });
    await fs.writeFile(path.join(packageRoot, 'agents', 'refresh.md'), '# Refresh Agent\n\nRefresh.\n');
    await fs.writeFile(
      path.join(packageRoot, 'skills', 'refresh', 'SKILL.md'),
      '---\nname: refresh-skill\ndescription: Refresh extension state.\n---\n\nRefresh.\n',
    );

    const snapshots: ToolDefinition[][] = [];
    const skillsRegistry = new SkillsRegistry(path.join(tempRoot, 'skills'));
    await skillsRegistry.initialize();
    const host = {
      toolsRegistry: new ToolsRegistry(path.join(tempRoot, 'tools')),
      toolManager: {
        replaceRuntimeMetaTools: vi.fn((definitions: ToolDefinition[]) => snapshots.push(definitions)),
      } as unknown as ToolManager,
      extensionRegistry: new ExtensionRegistry({ userRoot: extensionsRoot }),
      skillsRegistry,
    };
    const runtime = {
      config: { configPath: '', externalAgents: { enabled: false, paths: [] } },
      workspaceRoot: tempRoot,
      options: {},
    } as AgentRuntime;

    await syncDynamicRuntimeExtensions(host, runtime);
    const loadedSkill = skillsRegistry.getSkill('refresh-skill');
    await fs.remove(packageRoot);
    await syncDynamicRuntimeExtensions(host, runtime);

    expect(snapshots[0]?.map((definition) => definition.name)).toContain('refresh_tool');
    expect(loadedSkill).toMatchObject({ name: 'refresh-skill', source: 'extension' });
    expect(snapshots[1]?.map((definition) => definition.name)).not.toContain('refresh_tool');
    expect(host.toolsRegistry.getMetaTool('refresh_tool')).toBeUndefined();
    expect(AgentRegistry.getInstance().getAgent('refresh')).toBeUndefined();
    expect(skillsRegistry.getSkill('refresh-skill')).toBeNull();
  });

  it('keeps the complete last working package when a runtime edit fails and applies the repaired package', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-dynamic-rollback-'));
    tempRoots.push(root);
    const source = path.join(root, 'source');
    await fs.ensureDir(path.join(source, 'tools'));
    await fs.writeJson(path.join(source, 'autohand.extension.json'), {
      schemaVersion: 1, extensionApi: 1, id: 'autohand.rollback', name: 'Rollback',
      version: '1.0.0', description: 'Transactional runtime fixture',
      contributes: { runtime: ['runtime.mjs'], tools: ['tools/value.json'] },
    });
    const runtimeFile = path.join(source, 'runtime.mjs');
    const toolFile = path.join(source, 'tools/value.json');
    const tool = { name: 'value_tool', description: 'Working tool', parameters: { type: 'object', properties: {} }, handler: 'echo first', source: 'user' };
    await fs.writeJson(toolFile, tool);
    await fs.writeFile(runtimeFile, `export function activate(api) {
      api.commands.register({command:'/rollback',description:'Working command',execute:()=> 'first'});
    }`);
    const userRoot = path.join(root, 'extensions');
    const service = new ExtensionService({ userRoot });
    await service.install(source, { link: true, trust: true });
    const host = {
      extensionRegistry: new ExtensionRegistry({ userRoot }),
      toolsRegistry: new ToolsRegistry(path.join(root, 'tools')),
      toolManager: { replaceRuntimeMetaTools: vi.fn() },
      inkRenderer: { setRuntimeSlashCommands: vi.fn(), setExtensionKeybindings: vi.fn(), setRuntimeLineExtensions: vi.fn() },
    };
    const runtime = { config: { configPath: '', externalAgents: { enabled: false, paths: [] } }, workspaceRoot: root, options: {} } as AgentRuntime;
    await syncDynamicRuntimeExtensions(host, runtime);
    await fs.writeJson(toolFile, { ...tool, description: 'Repaired tool' });
    await fs.writeFile(runtimeFile, `export function activate() { throw new Error('unfinished edit'); }`);
    const failed = await syncDynamicRuntimeExtensions(host, runtime);
    expect(failed.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'runtime_activation_failed' })]));
    expect(host.toolsRegistry.getMetaTool('value_tool')?.description).toBe('Working tool');
    expect(extensionRuntimeHost.getCommand('/rollback')?.description).toBe('Working command');
    await fs.writeFile(runtimeFile, `export function activate(api) {
      api.commands.register({command:'/repaired',description:'Repaired command',execute:()=> 'second'});
    }`);
    await syncDynamicRuntimeExtensions(host, runtime);
    expect(host.toolsRegistry.getMetaTool('value_tool')?.description).toBe('Repaired tool');
    expect(extensionRuntimeHost.getCommand('/rollback')).toBeUndefined();
    expect(host.inkRenderer.setRuntimeSlashCommands).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({command:'/repaired'})]));
    await fs.writeFile(path.join(source, 'autohand.extension.json'), '{unfinished');
    await syncDynamicRuntimeExtensions(host, runtime);
    expect(host.toolsRegistry.getMetaTool('value_tool')?.description).toBe('Repaired tool');
    await fs.remove(path.join(userRoot, 'autohand.rollback'));
    await syncDynamicRuntimeExtensions(host, runtime);
    expect(extensionRuntimeHost.getCommand('/repaired')).toBeUndefined();
    expect(host.toolsRegistry.getMetaTool('value_tool')).toBeUndefined();
  });

  it('replaces the selected provider client on reload and stops using it immediately after disable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-dynamic-provider-'));
    tempRoots.push(root);
    const source = path.join(root, 'source');
    await fs.ensureDir(source);
    await fs.writeJson(path.join(source, 'autohand.extension.json'), {
      schemaVersion: 1, extensionApi: 1, id: 'autohand.provider', name: 'Provider', version: '1.0.0',
      description: 'Live provider fixture', contributes: {runtime:['runtime.mjs']},
    });
    const writeRuntime = async (value: string) => fs.writeFile(path.join(source,'runtime.mjs'), `
      export function activate(api) { api.providers.register({name:'extension:live',displayName:'Live',create:()=>({
        getName:()=> 'extension:live',setModel:()=>{},listModels:async()=>['live-model'],isAvailable:async()=>true,
        complete:async()=>({id:'live',created:0,raw:null,content:${JSON.stringify(value)}})
      })}); }
    `);
    await writeRuntime('first');
    const userRoot = path.join(root, 'extensions');
    const service = new ExtensionService({userRoot});
    await service.install(source,{link:true,trust:true});
    const runtime: AgentRuntime = { workspaceRoot:root, options:{}, config:{configPath:'',provider:'extension:live',
      extensionProviders:{'extension:live':{model:'live-model'}}} };
    let activeProvider = ProviderFactory.create(runtime.config);
    const host = { extensionRegistry:new ExtensionRegistry({userRoot}), providerConfigManager:{
      refreshExtensionProvider: vi.fn(() => { activeProvider = ProviderFactory.create(runtime.config); }),
    }};
    await syncDynamicRuntimeExtensions(host,runtime);
    expect((await activeProvider.complete({messages:[]})).content).toBe('first');
    await writeRuntime('second');
    await syncDynamicRuntimeExtensions(host,runtime);
    expect((await activeProvider.complete({messages:[]})).content).toBe('second');
    await service.setEnabled('autohand.provider',false);
    await syncDynamicRuntimeExtensions(host,runtime);
    await expect(activeProvider.complete({messages:[]})).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    await service.setEnabled('autohand.provider',true);
    await syncDynamicRuntimeExtensions(host,runtime);
    expect((await activeProvider.complete({messages:[]})).content).toBe('second');
    expect(host.providerConfigManager.refreshExtensionProvider).toHaveBeenCalledTimes(4);
  });

  it('registers inline session agents passed through CLI options', () => {
    const runtime = {
      config: { configPath: '', externalAgents: { enabled: false, paths: [] } },
      workspaceRoot: '/tmp',
      options: {
        inlineAgents: [
          {
            name: 'reviewer',
            description: 'Reviews code',
            systemPrompt: 'You are a code reviewer',
            tools: ['*'],
          },
        ],
      },
    } as unknown as AgentRuntime;

    configureAgentRegistry(runtime);

    const reviewer = AgentRegistry.getInstance().getAgent('reviewer');
    expect(reviewer).toMatchObject({ source: 'session', description: 'Reviews code' });
  });

  it('clears stale session agents when CLI provides none', () => {
    const registry = AgentRegistry.getInstance();
    registry.setSessionAgents([
      { name: 'stale', description: 'd', systemPrompt: 'p', tools: ['*'] },
    ]);

    const runtime = {
      config: { configPath: '', externalAgents: { enabled: false, paths: [] } },
      workspaceRoot: '/tmp',
      options: {},
    } as unknown as AgentRuntime;

    configureAgentRegistry(runtime);

    expect(registry.getAgent('stale')).toBeUndefined();
  });
});
