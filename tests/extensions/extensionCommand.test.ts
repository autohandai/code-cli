/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtensionService } from '../../src/extensions/ExtensionService.js';
import { runExtensionsCommand } from '../../src/extensions/cli.js';

describe('runExtensionsCommand', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  async function setup() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-extension-command-'));
    tempRoots.push(root);
    const source = path.join(root, 'source');
    const userRoot = path.join(root, 'user');
    const projectRoot = path.join(root, 'project');
    await fs.ensureDir(path.join(source, 'tools'));
    await fs.writeJson(path.join(source, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: 'autohand.git-insights',
      name: 'Git Insights',
      version: '1.0.0',
      description: 'Inspect repository history.',
      contributes: { tools: ['tools/recent-history.json'] },
    });
    await fs.writeJson(path.join(source, 'tools', 'recent-history.json'), {
      name: 'recent_history',
      description: 'Show recent commits',
      parameters: { type: 'object', properties: {} },
      handler: 'git log -10 --oneline',
      source: 'user',
    });
    return {
      root,
      source,
      userRoot,
      service: new ExtensionService({ userRoot, projectRoot }),
    };
  }

  it('renders complete lifecycle usage for an omitted or help action', async () => {
    const { service } = await setup();

    const result = await runExtensionsCommand({ service }, []);
    const explicit = await runExtensionsCommand({ service }, ['help']);

    expect(result.code).toBe(0);
    expect(result.output).toContain('extensions validate <path>');
    expect(result.output).toContain('extensions install <path>');
    expect(result.output).toContain('extensions remove <id>');
    expect(explicit).toEqual(result);
  });

  it('validates and installs a package, then renders list and show provenance', async () => {
    const { service, source } = await setup();

    const validation = await runExtensionsCommand({ service }, ['validate', source]);
    const install = await runExtensionsCommand({ service }, ['install', source]);
    const list = await runExtensionsCommand({ service }, ['list']);
    const show = await runExtensionsCommand({ service }, ['show', 'autohand.git-insights']);

    expect(validation).toMatchObject({ code: 0, mutated: false });
    expect(validation.output).toContain('Valid extension autohand.git-insights@1.0.0');
    expect(install).toMatchObject({ code: 0, mutated: true });
    expect(install.output).toContain('Installed autohand.git-insights@1.0.0');
    expect(list.output).toContain('autohand.git-insights  1.0.0  user  enabled');
    expect(show.output).toContain('Tools: recent_history');
    expect(show.output).toContain('Scope: user');
  });

  it('emits stable unstyled JSON for automation', async () => {
    const { service, source } = await setup();
    await runExtensionsCommand({ service }, ['install', source]);

    const result = await runExtensionsCommand({ service }, ['list', '--json']);
    const payload = JSON.parse(result.output) as { extensions: Array<{ id: string }>; diagnostics: unknown[] };

    expect(result.code).toBe(0);
    expect(payload).toEqual({
      extensions: [expect.objectContaining({ id: 'autohand.git-insights' })],
      diagnostics: [],
    });
    expect(result.output).not.toContain('\u001b[');
  });

  it('enables and disables through the shared mutation surface', async () => {
    const { service, source } = await setup();
    await runExtensionsCommand({ service }, ['install', source]);

    const disabled = await runExtensionsCommand(
      { service },
      ['disable', 'autohand.git-insights', '--scope', 'user'],
    );
    expect(disabled).toMatchObject({ code: 0, mutated: true });
    expect((await service.show('autohand.git-insights'))?.disabled).toBe(true);

    const enabled = await runExtensionsCommand(
      { service },
      ['enable', 'autohand.git-insights', '--scope', 'user'],
    );
    expect(enabled.output).toContain('Enabled autohand.git-insights');
    expect((await service.show('autohand.git-insights'))?.disabled).toBe(false);
  });

  it('fails non-interactive removal without explicit confirmation', async () => {
    const { service, source } = await setup();
    await runExtensionsCommand({ service }, ['install', source]);

    const refused = await runExtensionsCommand(
      { service, stdinIsTTY: false },
      ['remove', 'autohand.git-insights'],
    );

    expect(refused).toMatchObject({ code: 1, mutated: false });
    expect(refused.output).toMatch(/requires --yes/i);
    expect(await service.show('autohand.git-insights')).toBeDefined();

    const removed = await runExtensionsCommand(
      { service, stdinIsTTY: false },
      ['remove', 'autohand.git-insights', '--yes'],
    );
    expect(removed).toMatchObject({ code: 0, mutated: true });
    expect(await service.show('autohand.git-insights')).toBeUndefined();
  });

  it('reports invalid options and unknown actions with non-zero status', async () => {
    const { service } = await setup();

    const badScope = await runExtensionsCommand({ service }, ['list', '--scope', 'machine']);
    const unknown = await runExtensionsCommand({ service }, ['teleport']);

    expect(badScope).toMatchObject({ code: 1, mutated: false });
    expect(badScope.output).toMatch(/invalid scope/i);
    expect(unknown).toMatchObject({ code: 1, mutated: false });
    expect(unknown.output).toMatch(/unknown extensions command/i);
  });

  it('returns truthful doctor status when an installed directory is malformed', async () => {
    const { service, userRoot } = await setup();
    await fs.ensureDir(path.join(userRoot, 'broken'));
    await fs.writeFile(path.join(userRoot, 'broken', 'autohand.extension.json'), '{broken');

    const result = await runExtensionsCommand({ service }, ['doctor']);

    expect(result.code).toBe(1);
    expect(result.output).toContain('Extension diagnostics: 1 issue');
    expect(result.output).toMatch(/invalid extension manifest json/i);
  });
});
