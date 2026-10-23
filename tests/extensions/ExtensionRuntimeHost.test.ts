/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Command } from 'commander';
import fs from 'fs-extra';
import { render } from 'ink-testing-library';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExtensionRuntimeHost,
  extensionRuntimeHost,
  registerExtensionCliFlags,
} from '../../src/extensions/ExtensionRuntimeHost.js';
import { ExtensionRegistry } from '../../src/extensions/ExtensionRegistry.js';
import { ExtensionService } from '../../src/extensions/ExtensionService.js';
import type { ExtensionSnapshot } from '../../src/extensions/types.js';
import { SlashCommandHandler } from '../../src/core/slashCommandHandler.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';
import { HookManager } from '../../src/core/HookManager.js';
import { PermissionManager } from '../../src/permissions/PermissionManager.js';
import { ProviderFactory } from '../../src/providers/ProviderFactory.js';
import { getProviderConfig } from '../../src/config.js';
import type { AutohandConfig } from '../../src/types.js';

const RUNTIME_SOURCE = `
export async function activate(api) {
  const { React, Ink } = api.ui;
  api.commands.register({
    command: '/hello',
    description: 'Say hello from the extension',
    async execute(context) {
      return 'Hello ' + (context.args.join(' ') || context.cli.getOption('helloName'));
    },
  });
  api.ui.setStatusLine({
    segments: [{ id: 'fixture-status', text: 'fixture ready', color: 'success' }],
  });
  api.ui.setHelpLine({
    segments: [{ id: 'fixture-help', text: 'ctrl+h hello', color: 'accent' }],
  });
  api.ui.registerView({
    id: 'fixture.dashboard',
    title: 'Fixture dashboard',
    component: ({ close }) => React.createElement(
      Ink.Box,
      { flexDirection: 'column' },
      React.createElement(Ink.Text, null, 'Runtime dashboard'),
      React.createElement(Ink.Text, null, 'press escape to close'),
    ),
  });
  api.keybindings.register({ key: 'ctrl+h', command: '/hello' });
  api.cli.registerFlag({
    flags: '--hello-name <name>',
    description: 'Name used by the hello extension',
    defaultValue: 'world',
  });
  api.hooks.on('session-start', async () => ({ additionalContext: 'fixture runtime started' }));
  api.providers.register({
    name: 'extension:fixture',
    displayName: 'Fixture Provider',
    create(config) {
      let model = config.model;
      return {
        getName: () => 'extension:fixture',
        complete: async () => ({ id: 'fixture', created: 0, content: 'ok', raw: {} }),
        listModels: async () => ['fixture-model'],
        isAvailable: async () => true,
        setModel: (nextModel) => { model = nextModel; },
        getModel: () => model,
      };
    },
  });
  api.permissions.registerPolicy({
    allowList: ['run_command:echo hello'],
    denyList: ['run_command:echo forbidden'],
  });
}
`;

describe('ExtensionRuntimeHost', () => {
  const tempRoots: string[] = [];
  const hosts: ExtensionRuntimeHost[] = [];

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.deactivateAll()));
    await extensionRuntimeHost.deactivateAll();
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  async function makeRuntimePackage(options: {
    id?: string;
    source?: string;
  } = {}): Promise<{ packageRoot: string; userRoot: string; projectRoot: string }> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-runtime-extension-'));
    tempRoots.push(tempRoot);
    const packageRoot = path.join(tempRoot, options.id ?? 'autohand.runtime-fixture');
    const userRoot = path.join(tempRoot, 'user-extensions');
    const projectRoot = path.join(tempRoot, 'project-extensions');
    await fs.ensureDir(path.join(packageRoot, 'dist'));
    await fs.writeJson(path.join(packageRoot, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: options.id ?? 'autohand.runtime-fixture',
      name: 'Runtime fixture',
      version: '1.0.0',
      description: 'Exercises trusted runtime extension capabilities.',
      contributes: { runtime: ['dist/extension.mjs'] },
    });
    await fs.writeFile(path.join(packageRoot, 'dist', 'extension.mjs'), options.source ?? RUNTIME_SOURCE);
    return { packageRoot, userRoot, projectRoot };
  }

  async function installAndLoad(): Promise<{
    host: ExtensionRuntimeHost;
    snapshot: ExtensionSnapshot;
    service: ExtensionService;
  }> {
    const fixture = await makeRuntimePackage();
    const service = new ExtensionService({
      userRoot: fixture.userRoot,
      projectRoot: fixture.projectRoot,
    });
    await service.install(fixture.packageRoot, { trust: true });
    const snapshot = await new ExtensionRegistry({ userRoot: fixture.userRoot }).load();
    const host = new ExtensionRuntimeHost();
    hosts.push(host);
    await host.sync(snapshot);
    return { host, snapshot, service };
  }

  it('requires explicit trust before installing executable runtime contributions', async () => {
    const fixture = await makeRuntimePackage();
    const service = new ExtensionService({ userRoot: fixture.userRoot });

    await expect(service.validate(fixture.packageRoot)).resolves.toMatchObject({
      runtimes: [{ provenance: { extensionId: 'autohand.runtime-fixture' } }],
    });
    await expect(service.install(fixture.packageRoot)).rejects.toThrow(/--trust|explicit trust/i);

    const result = await service.install(fixture.packageRoot, { trust: true });
    expect(result.extension).toMatchObject({ trusted: true, disabled: false });

    await service.setEnabled('autohand.runtime-fixture', false);
    await service.setEnabled('autohand.runtime-fixture', true);
    await expect(service.show('autohand.runtime-fixture')).resolves.toMatchObject({ trusted: true });
  });

  it('transactionally activates every runtime capability through the versioned host API', async () => {
    const { host } = await installAndLoad();

    expect(host.getCommands()).toMatchObject([
      { command: '/hello', description: 'Say hello from the extension' },
    ]);
    expect(host.getLineExtensions()).toMatchObject({
      status: { segments: [{ id: 'fixture-status', text: 'fixture ready' }] },
      help: { segments: [{ id: 'fixture-help', text: 'ctrl+h hello' }] },
    });
    expect(host.getKeybindings()).toEqual([
      expect.objectContaining({ key: 'ctrl+h', command: '/hello' }),
    ]);
    expect(host.getCliOption('helloName')).toBe('world');
    expect(host.getCliFlags()).toEqual([
      expect.objectContaining({ flags: '--hello-name <name>', defaultValue: 'world' }),
    ]);
    expect(host.getHooks()).toEqual([
      expect.objectContaining({ event: 'session-start', extensionId: 'autohand.runtime-fixture' }),
    ]);
    expect(host.getProviders()).toEqual([
      expect.objectContaining({ name: 'extension:fixture', displayName: 'Fixture Provider' }),
    ]);
    expect(host.getPermissionPolicies()).toEqual([
      expect.objectContaining({
        extensionId: 'autohand.runtime-fixture',
        settings: expect.objectContaining({ allowList: ['run_command:echo hello'] }),
      }),
    ]);

    const view = host.getView('fixture.dashboard');
    expect(view).toBeDefined();
    const frame = render(React.createElement(view!.component, {
      close: vi.fn(),
      workspaceRoot: '/tmp/workspace',
      args: [],
    })).lastFrame();
    expect(frame).toContain('Runtime dashboard');
  });

  it('registers CLI flags before parsing and exposes their values to extension commands', async () => {
    const { host } = await installAndLoad();
    const program = new Command().exitOverride();
    program.option('--core-flag', 'Core fixture flag');
    registerExtensionCliFlags(program, host);

    await program.parseAsync(['node', 'autohand', '--hello-name', 'Ada']);
    host.setCliOptions(program.opts<Record<string, unknown>>());

    const context = {
      workspaceRoot: '/tmp/workspace',
      isNonInteractive: false,
    } as SlashCommandContext;
    const handler = new SlashCommandHandler(context, [], host);
    await expect(handler.handle('/hello', [])).resolves.toBe('Hello Ada');
  });

  it('runs lifecycle hooks and applies permission overlays without bypassing the immutable blacklist', async () => {
    const { host } = await installAndLoad();
    const hookManager = new HookManager({
      settings: { enabled: true, hooks: [] },
      workspaceRoot: '/tmp/workspace',
    });
    hookManager.setExtensionHooks(host.getHooks());

    const hookResults = await hookManager.executeHooks('session-start', { sessionType: 'startup' });
    expect(hookResults).toEqual([
      expect.objectContaining({
        success: true,
        response: { additionalContext: 'fixture runtime started' },
      }),
    ]);

    const permissionManager = new PermissionManager({ mode: 'interactive' });
    permissionManager.setExtensionPolicies(host.getPermissionPolicies());
    expect(permissionManager.checkPermission({
      tool: 'run_command',
      command: 'echo',
      args: ['hello'],
    })).toMatchObject({ allowed: true, reason: 'allow_list' });
    expect(permissionManager.checkPermission({
      tool: 'run_command',
      command: 'echo',
      args: ['forbidden'],
    })).toMatchObject({ allowed: false, reason: 'deny_list' });
    expect(permissionManager.checkPermission({
      tool: 'read_file',
      path: '.env',
    })).toMatchObject({ allowed: false, reason: 'blacklisted' });

    permissionManager.setMode('unrestricted');
    expect(permissionManager.checkPermission({
      tool: 'run_command',
      command: 'echo',
      args: ['forbidden'],
    })).toMatchObject({ allowed: false, reason: 'deny_list' });

    permissionManager.setMode('restricted');
    expect(permissionManager.checkPermission({
      tool: 'run_command',
      command: 'echo',
      args: ['hello'],
    })).toMatchObject({ allowed: false, reason: 'mode_restricted' });
  });

  it('accepts subagent lifecycle hooks from trusted extensions', async () => {
    const events = ['subagent-start', 'subagent-progress', 'subagent-message', 'subagent-cancel-requested'] as const;
    const fixture = await makeRuntimePackage({ source: `export function activate(api) {
      for (const event of ${JSON.stringify(events)}) api.hooks.on(event, () => ({ additionalContext: 'Check tests' }));
    }` });
    const service = new ExtensionService({ userRoot: fixture.userRoot, projectRoot: fixture.projectRoot });
    await service.install(fixture.packageRoot, { trust: true });
    const host = new ExtensionRuntimeHost();
    hosts.push(host);
    await host.sync(await new ExtensionRegistry({ userRoot: fixture.userRoot }).load());
    expect(host.getHooks().map(hook => hook.event)).toEqual(events);
  });

  it('registers program status hooks and delivers the structured report to trusted extensions', async () => {
    const fixture = await makeRuntimePackage({ source: `export function activate(api) {
      api.hooks.on('program-status', context => ({ additionalContext: JSON.stringify(context.programStatus) }));
    }` });
    const service = new ExtensionService({ userRoot: fixture.userRoot });
    await service.install(fixture.packageRoot, { trust: true });
    const host = new ExtensionRuntimeHost();
    hosts.push(host);
    expect(await host.sync(await service.list())).toEqual([]);
    const manager = new HookManager({ settings: { enabled: true, hooks: [] }, workspaceRoot: fixture.packageRoot });
    manager.setExtensionHooks(host.getHooks());
    const report = { state: 'blocked', kind: 'permission', id: 'autohand-fixture', app: 'autohand' } as const;
    expect(await manager.executeHooks('program-status', { programStatus: report })).toEqual([
      expect.objectContaining({ success: true, response: { additionalContext: JSON.stringify(report) } }),
    ]);
  });

  it('creates and configures extension providers through the normal provider factory', async () => {
    const fixture = await makeRuntimePackage();
    const service = new ExtensionService({ userRoot: fixture.userRoot });
    await service.install(fixture.packageRoot, { trust: true });
    await extensionRuntimeHost.sync(await service.list());
    const config = {
      provider: 'extension:fixture',
      extensionProviders: {
        'extension:fixture': { model: 'fixture-model' },
      },
    } as unknown as AutohandConfig;

    expect(ProviderFactory.isValidProvider('extension:fixture')).toBe(true);
    expect(ProviderFactory.getProviderNames()).toContain('extension:fixture');
    expect(getProviderConfig(config, 'extension:fixture' as never)).toMatchObject({
      model: 'fixture-model',
    });
    expect(ProviderFactory.create(config).getName()).toBe('extension:fixture');
  });

  it('removes runtime registrations when the extension is disabled', async () => {
    const { host, service } = await installAndLoad();
    expect(host.getCommands()).toHaveLength(1);

    await service.setEnabled('autohand.runtime-fixture', false);
    await host.sync(await service.list());

    expect(host.getCommands()).toEqual([]);
    expect(host.getViews()).toEqual([]);
    expect(host.getProviders()).toEqual([]);
    expect(host.getPermissionPolicies()).toEqual([]);
  });

  it('isolates a failing runtime without hiding healthy extensions', async () => {
    const broken = await makeRuntimePackage({
      id: 'autohand.broken-runtime',
      source: 'export function activate() { throw new Error("activation exploded"); }',
    });
    const healthySource = RUNTIME_SOURCE.replaceAll('autohand.runtime-fixture', 'autohand.healthy-runtime');
    const healthyRoot = path.join(path.dirname(broken.packageRoot), 'autohand.healthy-runtime');
    await fs.copy(broken.packageRoot, healthyRoot);
    await fs.writeJson(path.join(healthyRoot, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: 'autohand.healthy-runtime',
      name: 'Healthy runtime',
      version: '1.0.0',
      description: 'Healthy runtime fixture.',
      contributes: { runtime: ['dist/extension.mjs'] },
    });
    await fs.writeFile(path.join(healthyRoot, 'dist', 'extension.mjs'), healthySource);

    const service = new ExtensionService({ userRoot: broken.userRoot });
    await service.install(broken.packageRoot, { trust: true });
    await service.install(healthyRoot, { trust: true });
    const host = new ExtensionRuntimeHost();
    hosts.push(host);
    const diagnostics = await host.sync(await service.list());

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'runtime_activation_failed',
        extensionId: 'autohand.broken-runtime',
        message: expect.stringContaining('activation exploded'),
      }),
    ]);
    expect(host.getCommands().map((command) => command.command)).toContain('/hello');
  });

  it('rejects malformed registrations and core CLI option collisions transactionally', async () => {
    const fixture = await makeRuntimePackage({
      source: `
        export function activate(api) {
          api.commands.register({ command: '/partial', description: 'Must not leak', execute() {} });
          api.cli.registerFlag({ flags: '--path <dir>', description: 'Conflicts with core' });
        }
      `,
    });
    const service = new ExtensionService({ userRoot: fixture.userRoot });
    await service.install(fixture.packageRoot, { trust: true });
    const host = new ExtensionRuntimeHost({ reservedCliFlags: ['--path'] });
    hosts.push(host);

    const diagnostics = await host.sync(await service.list());

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'runtime_activation_failed',
        message: expect.stringContaining('conflicts with a core option'),
      }),
    ]);
    expect(host.getCommands()).toEqual([]);
    expect(host.getCliFlags()).toEqual([]);
  });

  it('contains extension slash-command failures as user-visible command output', async () => {
    const fixture = await makeRuntimePackage({
      source: `
        export function activate(api) {
          api.commands.register({
            command: '/explode',
            description: 'Throw a fixture error',
            execute() { throw new Error('command exploded'); },
          });
        }
      `,
    });
    const service = new ExtensionService({ userRoot: fixture.userRoot });
    await service.install(fixture.packageRoot, { trust: true });
    const host = new ExtensionRuntimeHost();
    hosts.push(host);
    await host.sync(await service.list());
    const handler = new SlashCommandHandler({
      workspaceRoot: '/tmp/workspace',
      isNonInteractive: false,
    } as SlashCommandContext, [], host);

    await expect(handler.handle('/explode')).resolves.toMatch(/command exploded/);
  });
  it('reloads edited imports without requiring an entrypoint timestamp or version change', async () => {
    const fixture = await makeRuntimePackage({ source: `
      import { value } from './value.mjs';
      const ready = await Promise.resolve(value);
      export function activate(api) {
        api.commands.register({ command: '/reload-value', description: 'Read current helper', execute: () => ready });
      }
    ` });
    const helper = path.join(fixture.packageRoot, 'dist', 'value.mjs');
    await fs.writeFile(helper, 'export const value = "first";');
    const service = new ExtensionService({ userRoot: fixture.userRoot });
    await service.install(fixture.packageRoot, { link: true, trust: true });
    const host = new ExtensionRuntimeHost(); hosts.push(host);
    await host.sync(await service.list());
    const context = { args: [], workspaceRoot: fixture.packageRoot, isNonInteractive: true, cli: { getOption: () => undefined }, ui: { open: (viewId: string) => host.createViewRequest(viewId) } };
    expect(await host.getCommand('/reload-value')?.execute(context)).toBe('first');
    await fs.writeFile(helper, 'export const value = "second";');
    await host.sync(await service.list());
    expect(await host.getCommand('/reload-value')?.execute(context)).toBe('second');
  });

  it('keeps the last working runtime when a replacement fails activation and recovers after repair', async () => {
    const fixture = await makeRuntimePackage({ source: `export function activate(api) {
      api.commands.register({ command: '/reload-safe', description: 'Stable command', execute: () => 'last good' });
    }` });
    const service = new ExtensionService({ userRoot: fixture.userRoot });
    await service.install(fixture.packageRoot, { link: true, trust: true });
    const host = new ExtensionRuntimeHost(); hosts.push(host);
    await host.sync(await service.list());
    const original = host.getCommand('/reload-safe');
    await fs.writeFile(path.join(fixture.packageRoot, 'dist', 'extension.mjs'), 'export function activate() { throw new Error("unfinished edit"); }');
    expect(await host.sync(await service.list())).toEqual([expect.objectContaining({ code: 'runtime_activation_failed' })]);
    expect(host.getCommand('/reload-safe')).toBe(original);
    await fs.writeFile(path.join(fixture.packageRoot, 'dist', 'extension.mjs'), `export function activate(api) {
      api.commands.register({ command: '/reload-safe', description: 'Repaired command', execute: () => 'repaired' });
    }`);
    expect(await host.sync(await service.list())).toEqual([]);
    expect(host.getCommand('/reload-safe')?.description).toBe('Repaired command');
  });

  it('preserves unaffected activations when another package changes', async () => {
    const first = await makeRuntimePackage({ id: 'autohand.reload-first', source: `export function activate(api) {
      api.commands.register({ command: '/reload-first', description: 'First command', execute() {} });
    }` });
    const second = await makeRuntimePackage({ id: 'autohand.reload-second', source: `export function activate(api) {
      api.commands.register({ command: '/reload-second', description: 'Second command', execute() {} });
    }` });
    const service = new ExtensionService({ userRoot: first.userRoot });
    await service.install(first.packageRoot, { link: true, trust: true });
    await service.install(second.packageRoot, { link: true, trust: true });
    const host = new ExtensionRuntimeHost(); hosts.push(host);
    await host.sync(await service.list());
    const unaffected = host.getCommand('/reload-second');
    await fs.writeFile(path.join(first.packageRoot, 'dist', 'extension.mjs'), `export function activate(api) {
      api.commands.register({ command: '/reload-first', description: 'Changed command', execute() {} });
    }`);
    await host.sync(await service.list());
    expect(host.getCommand('/reload-second')).toBe(unaffected);
    expect(host.getCommand('/reload-first')?.description).toBe('Changed command');
  });

  it('releases replaced generation timers and immediately unloads a disabled or untrusted package', async () => {
    const fixture = await makeRuntimePackage({source: `export function activate(api) {
      const timer = setInterval(() => {}, 1000);
      api.commands.register({command:'/timed',description:'First',execute:()=> 'first'});
      return () => clearInterval(timer);
    }`});
    const service = new ExtensionService({userRoot: fixture.userRoot});
    await service.install(fixture.packageRoot, {link:true,trust:true});
    const host = new ExtensionRuntimeHost();
    hosts.push(host);
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    try {
      await host.sync(await service.list());
      expect(vi.getTimerCount()).toBe(baseline + 1);
      await fs.writeFile(path.join(fixture.packageRoot,'dist/extension.mjs'), `export function activate(api) {
        const timer = setInterval(() => {}, 1000);
        api.commands.register({command:'/timed',description:'Second',execute:()=> 'second'});
        return () => clearInterval(timer);
      }`);
      await host.sync(await service.list());
      expect(host.getCommand('/timed')?.description).toBe('Second');
      expect(vi.getTimerCount()).toBe(baseline + 1);
      await fs.writeJson(path.join(fixture.userRoot,'.state/autohand.runtime-fixture.json'), {trusted:false,linked:true});
      await host.sync(await service.list());
      expect(host.getCommand('/timed')).toBeUndefined();
      expect(vi.getTimerCount()).toBe(baseline);
      await host.deactivateAll();
      expect(vi.getTimerCount()).toBe(baseline);
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads CommonJS, static JSON, asset URLs, and host React without extension-local framework copies', async () => {
    const fixture = await makeRuntimePackage({source: `
      import React from 'react';
      import {jsx} from 'react/jsx-runtime';
      import {Text} from 'ink';
      import {readFile} from 'node:fs/promises';
      import value from './value.cjs';
      import data from './data.json' with {type:'json'};
      const asset = await readFile(new URL('./asset.txt', import.meta.url), 'utf8');
      export default {activate(api) {
        if (React !== api.ui.React || Text !== api.ui.Ink.Text || jsx(Text, {children:'host'}).type !== Text) throw new Error('Duplicate framework');
        api.commands.register({command:'/formats',description:value+data.value+asset,execute:()=> 'loaded'});
      }};
    `});
    await fs.writeFile(path.join(fixture.packageRoot,'dist/value.cjs'), 'module.exports = "CommonJS ";');
    await fs.writeJson(path.join(fixture.packageRoot,'dist/data.json'), {value:'JSON '});
    await fs.writeFile(path.join(fixture.packageRoot,'dist/asset.txt'), 'asset');
    const service = new ExtensionService({userRoot:fixture.userRoot});
    await service.install(fixture.packageRoot,{link:true,trust:true});
    const host = new ExtensionRuntimeHost();
    hosts.push(host);
    expect(await host.sync(await service.list())).toEqual([]);
    expect(host.getCommand('/formats')?.description).toBe('CommonJS JSON asset');
  });

  it('refreshes flag defaults while preserving values explicitly supplied on the command line', async () => {
    const fixture = await makeRuntimePackage();
    const service = new ExtensionService({userRoot:fixture.userRoot});
    await service.install(fixture.packageRoot,{link:true,trust:true});
    const host = new ExtensionRuntimeHost();
    hosts.push(host);
    await host.sync(await service.list());
    host.setCliOptions({helloName:'world'}, ['helloName']);
    await fs.writeFile(path.join(fixture.packageRoot,'dist/extension.mjs'), RUNTIME_SOURCE.replace("defaultValue: 'world'", "defaultValue: 'universe'"));
    await host.sync(await service.list());
    expect(host.getCliOption('helloName')).toBe('universe');
    host.setCliOptions({helloName:'Ada'});
    await host.sync(await service.list(), {force:true});
    expect(host.getCliOption('helloName')).toBe('Ada');
  });

});
