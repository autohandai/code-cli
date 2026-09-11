/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Compiled release binaries cannot load sharp's native module at startup, so
// importing ToolImageStore (which the agent runtime always does) must not
// touch sharp until an image actually needs compressing.
vi.mock('sharp', () => {
  throw new Error('Could not load the "sharp" module using the darwin-arm64 runtime');
});

describe('ToolImageStore sharp loading', () => {
  it('can be imported when sharp cannot be loaded', async () => {
    await expect(import('../../src/core/ToolImageStore.js')).resolves.toHaveProperty('ToolImageStore');
  });

  it('reports the sharp failure only when an image is actually attached', async () => {
    const { ToolImageStore } = await import('../../src/core/ToolImageStore.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-tool-image-store-'));
    workspaces.push(workspace);
    const framePath = '.autohand/test-evidence/run-lazy/frame-001.png';
    await fs.mkdir(path.join(workspace, path.dirname(framePath)), { recursive: true });
    await fs.writeFile(path.join(workspace, framePath), Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(64),
    ]));

    const store = new ToolImageStore(workspace);
    const result = await store.attach({ role: 'tool', content: 'observed', tool_call_id: 'call-1' }, [framePath]);

    expect(result.attached).toBe(0);
    expect(result.error).toMatch(/^Tool image attachment failed: /);
  });
});

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true })));
});
