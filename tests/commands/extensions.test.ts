/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensions } from '../../src/commands/extensions.js';
import { ExtensionService } from '../../src/extensions/ExtensionService.js';

describe('/extensions command', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  it('shares lifecycle behavior and refreshes the active runtime after mutations', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-slash-extensions-'));
    tempRoots.push(root);
    const source = path.join(root, 'source');
    await fs.ensureDir(path.join(source, 'tools'));
    await fs.writeJson(path.join(source, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: 'autohand.release-assistant',
      name: 'Release Assistant',
      version: '1.0.0',
      description: 'Plan releases.',
      contributes: { tools: ['tools/release-range.json'] },
    });
    await fs.writeJson(path.join(source, 'tools', 'release-range.json'), {
      name: 'release_range',
      description: 'Show release commits',
      parameters: { type: 'object', properties: { from: { type: 'string' } }, required: ['from'] },
      handler: 'git log {{from}}..HEAD --oneline',
      source: 'user',
    });
    const service = new ExtensionService({
      userRoot: path.join(root, 'user'),
      projectRoot: path.join(root, 'project'),
    });
    const refreshDynamicExtensions = vi.fn().mockResolvedValue(undefined);
    const context = { extensionService: service, refreshDynamicExtensions };

    const installed = await extensions(context, ['install', source]);
    const listed = await extensions(context, ['list']);
    const disabled = await extensions(context, ['disable', 'autohand.release-assistant']);

    expect(installed).toContain('Installed autohand.release-assistant@1.0.0');
    expect(listed).toContain('autohand.release-assistant');
    expect(disabled).toContain('Disabled autohand.release-assistant');
    expect(refreshDynamicExtensions).toHaveBeenCalledTimes(2);
  });

  it('returns a clear error when the extension service is unavailable', async () => {
    await expect(extensions({}, ['list'])).resolves.toBe('Extensions service not available.');
  });
});
