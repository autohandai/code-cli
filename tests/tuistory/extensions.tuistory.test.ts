/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  createTempAutohandHome,
  createMockOpenRouterSequenceServer,
  exitInteractive,
  launchBuiltAutohand,
  repoRoot,
  waitForExit,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';
import {
  DEMO_EXTENSION_ID,
  DEMO_EXTENSION_RELATIVE_ROOT,
  createExtensionBuilderDemoResponses,
  driveExtensionBuilderAuthoring,
} from '../../src/testing/scenarios/extensionBuilderAuthoringDemo.js';

const EXAMPLE_IDS = [
  'autohand.code-health',
  'autohand.git-insights',
  'autohand.release-assistant',
  'autohand.runtime-showcase',
  'autohand.security-audit',
  'autohand.test-triage',
  'autohand.workspace-brief',
] as const;

const sessions: Session[] = [];
const tempStates: TuistoryTempState[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.close();
  }
  for (const state of tempStates.splice(0)) {
    await state.cleanup();
  }
});

async function runBuiltCommand(
  state: TuistoryTempState,
  args: string[],
): Promise<{ exitCode: number | null; output: string }> {
  const session = await launchBuiltAutohand([
    '--path',
    state.workspaceRoot,
    ...args,
  ], {
    autohandHome: state.autohandHome,
    cwd: state.workspaceRoot,
    waitForDataTimeout: 15_000,
  });
  sessions.push(session);
  await waitForExit(session, 20_000);
  return {
    exitCode: session.exitInfo?.exitCode ?? null,
    output: session.readAll(),
  };
}

async function writeToolExtension(
  extensionsRoot: string,
  id: string,
  toolName: string,
): Promise<string> {
  const extensionRoot = path.join(extensionsRoot, id);
  await fs.ensureDir(path.join(extensionRoot, 'tools'));
  await fs.writeJson(path.join(extensionRoot, 'autohand.extension.json'), {
    schemaVersion: 1,
    extensionApi: 1,
    id,
    name: id,
    version: '1.0.0',
    description: `Fixture for ${id}.`,
    contributes: { tools: ['tools/tool.json'] },
  });
  await fs.writeJson(path.join(extensionRoot, 'tools', 'tool.json'), {
    name: toolName,
    description: `Tool for ${id}`,
    parameters: { type: 'object', properties: {} },
    handler: 'git status --short',
    source: 'user',
  });
  return extensionRoot;
}

describe('built extensions CLI Tuistory E2E', () => {
  it('uses $extension-builder to author, validate, install, and inspect a real extension', async () => {
    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: '' },
        ui: { promptSuggestions: false },
        agent: { maxIterations: 3 },
      },
    });
    tempStates.push(state);
    const server = await createMockOpenRouterSequenceServer(createExtensionBuilderDemoResponses());
    const config = await fs.readJson(state.configPath) as Record<string, unknown>;
    config.openrouter = {
      ...(config.openrouter as Record<string, unknown>),
      baseUrl: server.baseUrl,
    };
    await fs.writeJson(state.configPath, config, { spaces: 2 });

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--y',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    try {
      await driveExtensionBuilderAuthoring(session);
    } finally {
      await server.close();
    }

    expect(await fs.pathExists(path.join(
      state.workspaceRoot,
      DEMO_EXTENSION_RELATIVE_ROOT,
      'autohand.extension.json',
    ))).toBe(true);

    await exitInteractive(session);
    const validation = await runBuiltCommand(state, [
      'extensions', 'validate', DEMO_EXTENSION_RELATIVE_ROOT,
    ]);
    expect(validation.exitCode, validation.output).toBe(0);
    expect(validation.output).toContain(`Valid extension ${DEMO_EXTENSION_ID}@1.0.0`);

    const installation = await runBuiltCommand(state, [
      'extensions', 'install', DEMO_EXTENSION_RELATIVE_ROOT, '--scope', 'project',
    ]);
    expect(installation.exitCode, installation.output).toBe(0);
    expect(installation.output).toContain(`Installed ${DEMO_EXTENSION_ID}@1.0.0`);

    const detail = await runBuiltCommand(state, [
      'extensions', 'show', DEMO_EXTENSION_ID, '--scope', 'project',
    ]);
    expect(detail.exitCode, detail.output).toBe(0);
    expect(detail.output).toContain('Tools: brief_workspace_status, brief_recent_commits');
    expect(detail.output).toContain('Skills: workspace-brief');
  }, 90_000);

  it('loads the built-in extension builder and a Pi-compatible packaged skill', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const packageRoot = path.join(state.workspaceRoot, 'autohand.pi-greeter');
    await fs.ensureDir(path.join(packageRoot, 'skills', 'pi-greeter'));
    await fs.writeJson(path.join(packageRoot, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: 'autohand.pi-greeter',
      name: 'Pi Greeter',
      version: '1.0.0',
      description: 'Portable Agent Skill originally packaged for Pi.',
      contributes: { skills: ['skills/pi-greeter/SKILL.md'] },
    });
    await fs.writeFile(
      path.join(packageRoot, 'skills', 'pi-greeter', 'SKILL.md'),
      [
        '---',
        'name: pi-greeter',
        'description: Greet the user with a Pi-compatible Agent Skill.',
        '---',
        '',
        'Greet the user and mention that this skill is portable.',
        '',
      ].join('\n'),
    );

    const validation = await runBuiltCommand(state, ['extensions', 'validate', packageRoot]);
    expect(validation.exitCode, validation.output).toBe(0);
    expect(validation.output).toContain('0 tools, 0 agents, 1 skill');

    const installation = await runBuiltCommand(state, ['extensions', 'install', packageRoot]);
    expect(installation.exitCode, installation.output).toBe(0);

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.waitForText('❯', { timeout: 20_000 });

    await session.type('/skills info extension-builder');
    await session.press('enter');
    await session.waitForText('Skill: extension-builder', { timeout: 10_000 });

    await session.type('/skills info pi-greeter');
    await session.press('enter');
    await session.waitForText('Skill: pi-greeter', { timeout: 10_000 });
    await session.waitForText('Source: Extension', { timeout: 10_000 });

    await session.type('/skills use pi-greeter');
    await session.press('enter');
    await session.waitForText('Activated skill: pi-greeter', { timeout: 10_000 });

    await exitInteractive(session);
  }, 90_000);

  it('runs trusted slash commands, Ink views, line segments, flags, and keybindings', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const source = path.join(
      repoRoot(),
      'examples',
      'extensions',
      'autohand.runtime-showcase',
    );
    const installation = await runBuiltCommand(state, [
      'extensions',
      'install',
      source,
      '--trust',
    ]);
    expect(installation.exitCode, installation.output).toBe(0);

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--deploy-environment', 'quality-assurance',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await session.waitForText('extensions:ready', { timeout: 20_000 });
    await session.waitForText('ctrl+k deploy', { timeout: 10_000 });
    await session.type('/deploy production');
    await session.press('enter');
    await session.waitForText('Deployment console', { timeout: 10_000 });
    await session.waitForText('Target: production', { timeout: 10_000 });
    await session.press('down');
    await session.press('enter');
    await session.waitForText('Validate release selected for production.', { timeout: 10_000 });

    await session.press(['ctrl', 'k']);
    await session.waitForText('Target: quality-assurance', { timeout: 10_000 });
    await session.press('escape');

    await session.type('/extensions disable autohand.runtime-showcase');
    await session.press('enter');
    await session.waitForText('Disabled autohand.runtime-showcase', { timeout: 10_000 });
    await session.type('/deploy');
    await session.press('enter');
    await session.waitForText('Command /deploy is not supported.', { timeout: 10_000 });

    await exitInteractive(session);
  }, 90_000);

  it('runs all seven examples through fresh built CLI processes', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const examplesRoot = path.join(repoRoot(), 'examples', 'extensions');

    const help = await runBuiltCommand(state, ['extensions', '--help']);
    expect(help.exitCode, help.output).toBe(0);
    expect(help.output).toContain('validate');
    expect(help.output).toContain('install');
    expect(help.output).toContain('doctor');

    for (const id of EXAMPLE_IDS) {
      const source = path.join(examplesRoot, id);
      const validation = await runBuiltCommand(state, ['extensions', 'validate', source]);
      expect(validation.exitCode, validation.output).toBe(0);
      expect(validation.output).toContain(`Valid extension ${id}@1.0.0`);

      const installation = await runBuiltCommand(state, [
        'extensions',
        'install',
        source,
        ...(id === 'autohand.runtime-showcase' ? ['--trust'] : []),
      ]);
      expect(installation.exitCode, installation.output).toBe(0);
      expect(installation.output).toContain(`Installed ${id}@1.0.0`);
    }

    const list = await runBuiltCommand(state, ['extensions', 'list']);
    expect(list.exitCode, list.output).toBe(0);
    for (const id of EXAMPLE_IDS) {
      expect(list.output).toContain(id);
      const detail = await runBuiltCommand(state, ['extensions', 'show', id]);
      expect(detail.exitCode, detail.output).toBe(0);
      expect(detail.output).toContain(`${id}@1.0.0`);
      expect(detail.output).toContain('State: enabled');
    }

    const disabled = await runBuiltCommand(state, [
      'extensions', 'disable', 'autohand.code-health',
    ]);
    expect(disabled.exitCode, disabled.output).toBe(0);
    const disabledDetail = await runBuiltCommand(state, [
      'extensions', 'show', 'autohand.code-health',
    ]);
    expect(disabledDetail.output).toContain('State: disabled');

    const enabled = await runBuiltCommand(state, [
      'extensions', 'enable', 'autohand.code-health',
    ]);
    expect(enabled.exitCode, enabled.output).toBe(0);
    const removed = await runBuiltCommand(state, [
      'extensions', 'remove', 'autohand.code-health', '--yes',
    ]);
    expect(removed.exitCode, removed.output).toBe(0);

    const survivors = await runBuiltCommand(state, ['extensions', 'list']);
    expect(survivors.output).not.toContain('autohand.code-health');
    expect(survivors.output).toContain('autohand.test-triage');

    const invalidRoot = path.join(state.workspaceRoot, 'invalid-extension');
    await fs.ensureDir(invalidRoot);
    await fs.writeJson(path.join(invalidRoot, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 2,
      id: 'autohand.invalid',
      name: 'Invalid Extension',
      version: '1.0.0',
      description: 'Deliberately incompatible fixture.',
      contributes: { tools: ['../outside.json'] },
    });
    const invalid = await runBuiltCommand(state, ['extensions', 'validate', invalidRoot]);
    expect(invalid.exitCode, invalid.output).toBe(1);
    expect(invalid.output).toMatch(/Invalid extension manifest/i);

    const doctor = await runBuiltCommand(state, ['extensions', 'doctor']);
    expect(doctor.exitCode, doctor.output).toBe(0);
    expect(doctor.output).toContain('Extension diagnostics: healthy (6 installed)');
  }, 120_000);

  it('runs interactive list, show, doctor, disable, and enable with stable Ctrl+C exit', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const source = path.join(repoRoot(), 'examples', 'extensions', 'autohand.code-health');
    const installation = await runBuiltCommand(state, ['extensions', 'install', source]);
    expect(installation.exitCode, installation.output).toBe(0);

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.waitForText('❯', { timeout: 20_000 });

    await session.type('/extensions list');
    await session.press('enter');
    await session.waitForText('autohand.code-health  1.0.0  user  enabled  copied', { timeout: 10_000 });

    await session.type('/extensions show autohand.code-health');
    await session.press('enter');
    await session.waitForText('Tools: find_todos', { timeout: 10_000 });

    await session.type('/extensions doctor');
    await session.press('enter');
    await session.waitForText('Extension diagnostics: healthy (1 installed)', { timeout: 10_000 });

    await session.type('/extensions disable autohand.code-health');
    await session.press('enter');
    await session.waitForText('Disabled autohand.code-health', { timeout: 10_000 });
    await session.type('/extensions show autohand.code-health');
    await session.press('enter');
    await session.waitForText('State: disabled', { timeout: 10_000 });

    await session.type('/extensions enable autohand.code-health');
    await session.press('enter');
    await session.waitForText('Enabled autohand.code-health', { timeout: 10_000 });

    await session.type('/extensions remove autohand.code-health --yes');
    await session.press('enter');
    await session.waitForText('Removed autohand.code-health', { timeout: 10_000 });
    await session.type('/extensions list');
    await session.press('enter');
    await session.waitForText('No extensions installed.', { timeout: 10_000 });

    await exitInteractive(session);
  }, 90_000);

  it('diagnoses malformed, incompatible, conflicting, traversal, and symlink fixtures', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const extensionsRoot = path.join(state.autohandHome, 'extensions');

    const malformedRoot = path.join(extensionsRoot, 'autohand.malformed');
    await fs.ensureDir(malformedRoot);
    await fs.writeFile(path.join(malformedRoot, 'autohand.extension.json'), '{broken');

    const incompatibleRoot = await writeToolExtension(
      extensionsRoot,
      'autohand.incompatible',
      'incompatible_tool',
    );
    const incompatibleManifest = await fs.readJson(
      path.join(incompatibleRoot, 'autohand.extension.json'),
    ) as Record<string, unknown>;
    await fs.writeJson(path.join(incompatibleRoot, 'autohand.extension.json'), {
      ...incompatibleManifest,
      extensionApi: 2,
    });

    const traversalRoot = await writeToolExtension(
      extensionsRoot,
      'autohand.traversal',
      'traversal_tool',
    );
    const traversalManifest = await fs.readJson(
      path.join(traversalRoot, 'autohand.extension.json'),
    ) as Record<string, unknown>;
    await fs.writeJson(path.join(traversalRoot, 'autohand.extension.json'), {
      ...traversalManifest,
      contributes: { tools: ['../outside.json'] },
    });

    const symlinkRoot = await writeToolExtension(
      extensionsRoot,
      'autohand.symlink',
      'symlink_tool',
    );
    const outsideTool = path.join(state.autohandHome, 'outside-tool.json');
    await fs.writeJson(outsideTool, {
      name: 'outside_tool',
      description: 'Outside fixture',
      parameters: { type: 'object', properties: {} },
      handler: 'git status --short',
      source: 'user',
    });
    await fs.remove(path.join(symlinkRoot, 'tools', 'tool.json'));
    await fs.symlink(outsideTool, path.join(symlinkRoot, 'tools', 'tool.json'));

    await writeToolExtension(extensionsRoot, 'autohand.conflict-one', 'duplicate_tool');
    await writeToolExtension(extensionsRoot, 'autohand.conflict-two', 'duplicate_tool');

    const standaloneToolsRoot = path.join(state.autohandHome, 'tools');
    await fs.ensureDir(standaloneToolsRoot);
    await fs.writeJson(path.join(standaloneToolsRoot, 'standalone_conflict.json'), {
      name: 'standalone_conflict',
      description: 'Standalone tool fixture',
      parameters: { type: 'object', properties: {} },
      handler: 'git status --short',
      source: 'user',
      scope: 'user',
    });
    await writeToolExtension(
      extensionsRoot,
      'autohand.standalone-conflict',
      'standalone_conflict',
    );

    const doctor = await runBuiltCommand(state, ['extensions', 'doctor']);

    expect(doctor.exitCode, doctor.output).toBe(1);
    expect(doctor.output).toMatch(/invalid extension manifest json/i);
    expect(doctor.output).toMatch(/extensionApi/i);
    expect(doctor.output).toMatch(/contained POSIX-style relative path/i);
    expect(doctor.output).toMatch(/symlink/i);
    expect(doctor.output).toMatch(/duplicate_tool.*conflicts with extension/i);
    expect(doctor.output).toMatch(/standalone_conflict.*reserved runtime tool/i);
  }, 60_000);
});
