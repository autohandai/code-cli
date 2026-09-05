/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileActionManager } from '../../src/actions/filesystem.js';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import type { ToolActionOutcome } from '../../src/types.js';

const installedPlaywrightProject = process.env.AUTOHAND_VISUAL_TEST_PROJECT;
const evidenceSchema = z.object({
  status: z.enum(['passed', 'failed', 'not-run']),
  visualInspection: z.literal('not-run'),
  screenshotPaths: z.array(z.string()).min(1),
  manifestPath: z.string(),
}).passthrough();

describe.skipIf(!installedPlaywrightProject)('captured images at the ActionExecutor tool boundary', () => {
  let workspaceRoot: string | undefined;
  let server: Server | undefined;
  let executor: ActionExecutor;
  let url: string;

  beforeEach(async () => {
    workspaceRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'capture-evidence-images-')));
    const projectRequire = createRequire(path.join(installedPlaywrightProject!, 'package.json'));
    await mkdir(path.join(workspaceRoot, 'node_modules'));
    await symlink(path.dirname(projectRequire.resolve('playwright/package.json')), path.join(workspaceRoot, 'node_modules/playwright'), 'dir');
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><html><body><h1>Capture handoff fixture</h1><button id="change" onclick="document.body.style.background=\'#225588\';document.querySelector(\'h1\').textContent=\'Changed by browser interaction\'">Change page</button></body></html>');
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server has no TCP address');
    url = `http://127.0.0.1:${address.port}/`;
    const root = workspaceRoot;
    executor = new ActionExecutor({
      runtime: { workspaceRoot: root, options: {}, config: { configPath: path.join(root, 'config.json') } },
      files: new FileActionManager(root),
      resolveWorkspacePath: relative => path.resolve(root, relative),
      confirmDangerousAction: async () => true,
    });
  });

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true });
  });

  async function verifyImageHandoff(outcome: ToolActionOutcome, expectedStatus: 'passed' | 'failed') {
    const evidence = evidenceSchema.parse(JSON.parse(outcome.output ?? 'null'));
    expect(evidence.status).toBe(expectedStatus);
    expect(JSON.parse(await readFile(evidence.manifestPath, 'utf8'))).toEqual(evidence);
    const images = await Promise.all(evidence.screenshotPaths.map(filename => readFile(filename)));
    for (const image of images) {
      expect(await sharp(image).metadata()).toMatchObject({ format: 'png', width: 1280, height: 720 });
      expect(JSON.stringify(outcome)).not.toContain(image.toString('base64'));
    }
    expect(JSON.stringify(outcome)).not.toMatch(/data:image\/|"base64"\s*:/);
    expect(outcome).toMatchObject({ imagePaths: evidence.screenshotPaths });
    return images;
  }

  it('returns the exact produced screenshot paths after a successful real browser capture', async () => {
    const outcome = await executor.executeForTool({
      type: 'capture_test_evidence', url, max_frames: 2,
      steps: [{ action: 'click', selector: '#change' }],
    }, { approvalHandled: true });
    expect(outcome.success).toBe(true);
    const images = await verifyImageHandoff(outcome, 'passed');
    expect(images).toHaveLength(2);
    expect(images[0].equals(images[1])).toBe(false);
  });

  it('returns retained screenshot paths with a failed real browser interaction', async () => {
    const outcome = await executor.executeForTool({
      type: 'capture_test_evidence', url, max_frames: 2, timeout_ms: 10_000,
      steps: [{ action: 'click', selector: '#does-not-exist' }],
    }, { approvalHandled: true });
    expect(outcome).toMatchObject({ success: false, kind: 'operational' });
    const images = await verifyImageHandoff(outcome, 'failed');
    expect(images).toHaveLength(1);
  });
});
