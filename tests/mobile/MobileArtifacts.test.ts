/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { collectAndUploadMobileArtifacts } from '../../src/mobile/MobileArtifacts.js';
import type { MobileHandoffClientLike } from '../../src/mobile/MobileHandoffClient.js';

describe('collectAndUploadMobileArtifacts', () => {
  it('uploads explicitly referenced supported files inside the workspace', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'autohand-mobile-artifacts-'));
    await mkdir(path.join(workspace, 'artifacts'));
    await writeFile(path.join(workspace, 'artifacts', 'walkthrough.mp4'), Buffer.from('video'));
    await writeFile(path.join(workspace, 'artifacts', 'run.log'), Buffer.from('tests passed'));
    const uploadMobileArtifact = vi.fn().mockImplementation(async (_token, _sessionId, upload) => ({
      id: upload.name,
      name: upload.name,
      kind: upload.kind,
      mimeType: upload.mimeType,
      byteSize: Buffer.from(upload.data, 'base64').byteLength,
      downloadPath: `/artifact/${upload.name}`,
    }));
    const client = { uploadMobileArtifact } as unknown as MobileHandoffClientLike;

    const artifacts = await collectAndUploadMobileArtifacts({
      text: 'Review [the walkthrough](artifacts/walkthrough.mp4) and `artifacts/run.log`.',
      workspaceRoot: workspace,
      client,
      token: 'token',
      sessionId: 'session-1',
      deviceId: 'device-1',
    });

    expect(artifacts.map((artifact) => artifact.kind)).toEqual(['video', 'log']);
    expect(uploadMobileArtifact).toHaveBeenCalledTimes(2);
  });

  it('ignores symlinks that escape the active workspace', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'autohand-mobile-workspace-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'autohand-mobile-outside-'));
    await writeFile(path.join(outside, 'secret.log'), Buffer.from('secret'));
    await symlink(path.join(outside, 'secret.log'), path.join(workspace, 'escaped.log'));
    const uploadMobileArtifact = vi.fn();

    const artifacts = await collectAndUploadMobileArtifacts({
      text: 'Logs: `escaped.log`',
      workspaceRoot: workspace,
      client: { uploadMobileArtifact } as unknown as MobileHandoffClientLike,
      token: 'token',
      sessionId: 'session-1',
      deviceId: 'device-1',
    });

    expect(artifacts).toEqual([]);
    expect(uploadMobileArtifact).not.toHaveBeenCalled();
  });
});
