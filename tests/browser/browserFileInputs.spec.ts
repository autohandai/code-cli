/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prepareBrowserFileInputs } from '../../src/browser/browserFileInputs.js';

describe('browser file inputs', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })),
    );
  });

  it('resolves upload paths against the workspace before transport', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'autohand-browser-files-'));
    temporaryDirectories.push(workspace);
    await writeFile(path.join(workspace, 'report.txt'), 'proof');

    await expect(
      prepareBrowserFileInputs(
        'browser_upload_file',
        { paths: ['report.txt'] },
        workspace,
      ),
    ).resolves.toEqual({
      paths: [path.join(workspace, 'report.txt')],
    });
  });

  it('resolves only file assignments and reports missing files by basename', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'autohand-browser-form-'));
    temporaryDirectories.push(workspace);
    await writeFile(path.join(workspace, 'avatar.png'), 'image');

    await expect(
      prepareBrowserFileInputs(
        'browser_fill_form',
        {
          assignments: [
            { kind: 'text', selector: '#name', text: 'Ada' },
            { kind: 'files', selector: '#avatar', paths: ['avatar.png'] },
          ],
        },
        workspace,
      ),
    ).resolves.toEqual({
      assignments: [
        { kind: 'text', selector: '#name', text: 'Ada' },
        {
          kind: 'files',
          selector: '#avatar',
          paths: [path.join(workspace, 'avatar.png')],
        },
      ],
    });

    await expect(
      prepareBrowserFileInputs(
        'browser_upload_file',
        { paths: ['/private/missing/secret-report.pdf'] },
        workspace,
      ),
    ).rejects.toThrow('Browser upload file is not available: secret-report.pdf');
  });
});
