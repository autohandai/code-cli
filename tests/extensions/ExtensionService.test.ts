/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import nodeFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionService } from '../../src/extensions/ExtensionService.js';

interface SourceOptions {
  id?: string;
  version?: string;
  toolName?: string;
  agentName?: string;
  handler?: string;
}

describe('ExtensionService', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  async function makeRoot(name: string): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `autohand-${name}-`));
    tempRoots.push(root);
    return root;
  }

  async function writeSource(parent: string, directory: string, options: SourceOptions = {}): Promise<string> {
    const root = path.join(parent, directory);
    const id = options.id ?? 'autohand.code-health';
    const toolName = options.toolName ?? 'find_todos';
    const agentName = options.agentName ?? 'extension-reviewer';
    await fs.ensureDir(path.join(root, 'tools'));
    await fs.ensureDir(path.join(root, 'agents'));
    await fs.writeJson(path.join(root, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id,
      name: 'Code Health',
      version: options.version ?? '1.0.0',
      description: 'Find maintainability risks.',
      contributes: {
        tools: [`tools/${toolName}.json`],
        agents: [`agents/${agentName}.md`],
      },
    });
    await fs.writeJson(path.join(root, 'tools', `${toolName}.json`), {
      name: toolName,
      description: 'Find TODO comments',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      handler: options.handler ?? 'git grep -n TODO -- {{path}}',
      source: 'user',
    });
    await fs.writeFile(
      path.join(root, 'agents', `${agentName}.md`),
      '# Extension Reviewer\n\nReview code health.\n',
    );
    await fs.writeFile(path.join(root, 'README.md'), '# Code Health\n');
    return root;
  }

  async function setup() {
    const root = await makeRoot('extension-service');
    const sourcesRoot = path.join(root, 'sources');
    const userRoot = path.join(root, 'user-extensions');
    const projectRoot = path.join(root, 'project-extensions');
    await fs.ensureDir(sourcesRoot);
    return {
      root,
      sourcesRoot,
      userRoot,
      projectRoot,
      service: new ExtensionService({ userRoot, projectRoot }),
    };
  }

  it('validates and installs a complete package atomically at user scope', async () => {
    const { sourcesRoot, userRoot, service } = await setup();
    const source = await writeSource(sourcesRoot, 'code-health-source');

    const validation = await service.validate(source);
    const result = await service.install(source, { scope: 'user' });

    expect(validation.extension.manifest.id).toBe('autohand.code-health');
    expect(validation.tools.map((tool) => tool.definition.name)).toEqual(['find_todos']);
    expect(result).toMatchObject({ status: 'installed', extension: { scope: 'user' } });
    expect(await fs.pathExists(path.join(userRoot, 'autohand.code-health', 'README.md'))).toBe(true);
    expect((await fs.readdir(userRoot)).filter((entry) => entry.startsWith('.tmp-'))).toEqual([]);

    const snapshot = await service.list();
    expect(snapshot.extensions).toEqual([
      expect.objectContaining({ manifest: expect.objectContaining({ id: 'autohand.code-health' }) }),
    ]);
    expect(snapshot.tools.map((tool) => tool.definition.name)).toEqual(['find_todos']);
  });

  it('treats reinstalling identical content as idempotent', async () => {
    const { sourcesRoot, service } = await setup();
    const source = await writeSource(sourcesRoot, 'code-health-source');

    await service.install(source, { scope: 'user' });
    const second = await service.install(source, { scope: 'user' });

    expect(second.status).toBe('existing');
  });

  it('serializes concurrent installation of the same extension id', async () => {
    const { sourcesRoot, service } = await setup();
    const source = await writeSource(sourcesRoot, 'code-health-source');

    const results = await Promise.all([
      service.install(source, { scope: 'user' }),
      service.install(source, { scope: 'user' }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['existing', 'installed']);
    expect((await service.list()).extensions).toHaveLength(1);
  });

  it('supports an explicit developer link without mutating or deleting the source', async () => {
    const { sourcesRoot, userRoot, service } = await setup();
    const source = await writeSource(sourcesRoot, 'linked-code-health');

    const installed = await service.install(source, { scope: 'user', link: true });
    const installationPath = path.join(userRoot, 'autohand.code-health');

    expect(installed.extension.linked).toBe(true);
    expect((await fs.lstat(installationPath)).isSymbolicLink()).toBe(true);

    await service.setEnabled('autohand.code-health', false, { scope: 'user' });
    expect(await fs.pathExists(path.join(source, '.autohand-extension-state.json'))).toBe(false);
    expect((await service.show('autohand.code-health'))?.disabled).toBe(true);

    await service.remove('autohand.code-health', { scope: 'user' });
    expect(await fs.pathExists(source)).toBe(true);
    expect(await fs.pathExists(path.join(source, 'autohand.extension.json'))).toBe(true);
  });

  it('ignores publisher-authored state and keeps installation state outside the package', async () => {
    const { sourcesRoot, userRoot, service } = await setup();
    const source = await writeSource(sourcesRoot, 'code-health-source');
    await fs.writeJson(path.join(source, '.autohand-extension-state.json'), {
      disabled: true,
      linked: true,
    });

    const validation = await service.validate(source);
    const installed = await service.install(source, { scope: 'user' });

    expect(validation.extension.disabled).toBe(false);
    expect(validation.tools.map((tool) => tool.definition.name)).toEqual(['find_todos']);
    expect(installed.extension).toMatchObject({ disabled: false, linked: false });
    expect(await fs.pathExists(path.join(
      userRoot,
      'autohand.code-health',
      '.autohand-extension-state.json',
    ))).toBe(false);
    expect(await fs.pathExists(path.join(source, '.autohand-extension-state.json'))).toBe(true);
    expect((await service.list()).tools.map((tool) => tool.definition.name)).toEqual(['find_todos']);
  });

  it('requires explicit replacement for different package content', async () => {
    const { sourcesRoot, service } = await setup();
    const first = await writeSource(sourcesRoot, 'code-health-v1', { version: '1.0.0' });
    const second = await writeSource(sourcesRoot, 'code-health-v2', {
      version: '2.0.0',
      toolName: 'find_fixmes',
    });
    await service.install(first, { scope: 'user' });

    await expect(service.install(second, { scope: 'user' }))
      .rejects.toThrow(/already installed|replace/i);

    const replaced = await service.install(second, { scope: 'user', replace: true });
    expect(replaced.status).toBe('replaced');
    expect((await service.show('autohand.code-health'))?.manifest.version).toBe('2.0.0');
    expect((await service.list()).tools.map((tool) => tool.definition.name)).toEqual(['find_fixmes']);
  });

  it('rejects contribution conflicts before mutating the installation root', async () => {
    const { sourcesRoot, userRoot, service } = await setup();
    const installedSource = await writeSource(sourcesRoot, 'installed-source', {
      id: 'autohand.zeta',
      toolName: 'shared_tool',
    });
    const conflictingSource = await writeSource(sourcesRoot, 'conflicting-source', {
      id: 'autohand.alpha',
      toolName: 'shared_tool',
    });
    await service.install(installedSource, { scope: 'user' });

    await expect(service.install(conflictingSource, { scope: 'user' }))
      .rejects.toThrow(/shared_tool.*autohand\.zeta/i);

    expect(await fs.pathExists(path.join(userRoot, 'autohand.alpha'))).toBe(false);
    const snapshot = await service.list();
    expect(snapshot.extensions.map((extension) => extension.manifest.id)).toEqual(['autohand.zeta']);
    expect(snapshot.tools.map((tool) => tool.definition.name)).toEqual(['shared_tool']);
  });

  it('applies host runtime reservations to validate, install, and doctor', async () => {
    const { sourcesRoot, userRoot, projectRoot } = await setup();
    const source = await writeSource(sourcesRoot, 'reserved-source', {
      id: 'autohand.reserved',
      toolName: 'standalone_tool',
    });
    const service = new ExtensionService({
      userRoot,
      projectRoot,
      loadOptions: async () => ({ reservedToolNames: ['standalone_tool'] }),
    });

    await expect(service.validate(source)).rejects.toThrow(/standalone_tool.*reserved runtime tool/i);
    await expect(service.install(source)).rejects.toThrow(/standalone_tool.*reserved runtime tool/i);
    expect(await fs.pathExists(path.join(userRoot, 'autohand.reserved'))).toBe(false);

    await fs.copy(source, path.join(userRoot, 'autohand.reserved'));
    const report = await service.doctor();
    expect(report).toMatchObject({ healthy: false, extensions: 0 });
    expect(report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'contribution_conflict',
        extensionId: 'autohand.reserved',
        message: expect.stringMatching(/standalone_tool.*reserved runtime tool/i),
      }),
    ]);
  });

  it('installs project scope separately from user scope', async () => {
    const { sourcesRoot, service } = await setup();
    const userSource = await writeSource(sourcesRoot, 'user-source', { version: '1.0.0' });
    const projectSource = await writeSource(sourcesRoot, 'project-source', {
      version: '2.0.0',
      toolName: 'project_tool',
    });

    await service.install(userSource, { scope: 'user' });
    await service.install(projectSource, { scope: 'project' });

    const selected = await service.show('autohand.code-health');
    expect(selected).toMatchObject({ scope: 'project', manifest: { version: '2.0.0' } });
  });

  it('disables and re-enables a package without mutating its manifest', async () => {
    const { sourcesRoot, userRoot, service } = await setup();
    const source = await writeSource(sourcesRoot, 'code-health-source');
    await service.install(source, { scope: 'user' });
    const manifestPath = path.join(userRoot, 'autohand.code-health', 'autohand.extension.json');
    const before = await fs.readFile(manifestPath, 'utf8');

    await service.setEnabled('autohand.code-health', false, { scope: 'user' });
    const disabled = await service.list();
    expect(disabled.extensions[0]?.disabled).toBe(true);
    expect(disabled.tools).toEqual([]);
    expect(disabled.agents).toEqual([]);

    await service.setEnabled('autohand.code-health', true, { scope: 'user' });
    const enabled = await service.list();
    expect(enabled.extensions[0]?.disabled).toBe(false);
    expect(enabled.tools.map((tool) => tool.definition.name)).toEqual(['find_todos']);
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(before);
  });

  it('removes only the selected package', async () => {
    const { sourcesRoot, userRoot, service } = await setup();
    const first = await writeSource(sourcesRoot, 'code-health-source');
    const second = await writeSource(sourcesRoot, 'test-triage-source', {
      id: 'autohand.test-triage',
      toolName: 'run_focused_test',
      agentName: 'test-triage-reviewer',
    });
    await service.install(first, { scope: 'user' });
    await service.install(second, { scope: 'user' });

    const removed = await service.remove('autohand.code-health', { scope: 'user' });

    expect(removed.manifest.id).toBe('autohand.code-health');
    expect(await fs.pathExists(path.join(userRoot, 'autohand.code-health'))).toBe(false);
    expect(await fs.pathExists(path.join(userRoot, 'autohand.test-triage'))).toBe(true);
  });

  it('moves an installed package out of discovery before recursive removal', async () => {
    const { sourcesRoot, userRoot, service } = await setup();
    const source = await writeSource(sourcesRoot, 'code-health-source');
    await service.install(source, { scope: 'user' });
    const packageRoot = path.join(userRoot, 'autohand.code-health');
    const originalRemove = fs.remove.bind(fs);
    const directRemoval = vi.fn();
    vi.spyOn(fs, 'remove').mockImplementation(async (target) => {
      if (path.resolve(String(target)) === packageRoot) {
        directRemoval();
        await nodeFs.rm(path.join(packageRoot, 'autohand.extension.json'));
        throw new Error('simulated interrupted recursive removal');
      }
      await originalRemove(target);
    });

    await expect(service.remove('autohand.code-health', { scope: 'user' })).resolves.toBeDefined();

    expect(directRemoval).not.toHaveBeenCalled();
    expect(await fs.pathExists(packageRoot)).toBe(false);
    expect(await service.doctor()).toMatchObject({ healthy: true, extensions: 0 });
  });

  it('does not leave a partial install when contribution validation fails', async () => {
    const { sourcesRoot, userRoot, service } = await setup();
    const source = await writeSource(sourcesRoot, 'dangerous-source', {
      id: 'autohand.dangerous',
      handler: 'rm -rf /',
    });

    await expect(service.install(source, { scope: 'user' })).rejects.toThrow(/dangerous pattern/i);

    expect(await fs.pathExists(path.join(userRoot, 'autohand.dangerous'))).toBe(false);
    expect(await fs.pathExists(userRoot) ? await fs.readdir(userRoot) : []).toEqual([]);
  });

  it('reports malformed installed packages through doctor while healthy packages remain active', async () => {
    const { sourcesRoot, userRoot, service } = await setup();
    const source = await writeSource(sourcesRoot, 'code-health-source');
    await service.install(source, { scope: 'user' });
    await fs.ensureDir(path.join(userRoot, 'broken'));
    await fs.writeFile(path.join(userRoot, 'broken', 'autohand.extension.json'), '{broken');

    const report = await service.doctor();

    expect(report.healthy).toBe(false);
    expect(report.extensions).toBe(1);
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ code: 'invalid_manifest', message: expect.stringMatching(/invalid extension manifest json/i) }),
    ]);
  });
});
