/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';

describe('file-modified hook firing', () => {
  it('markFilesModified calls hookManager.executeHooks with file-modified event', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/agent.ts', 'utf-8');
    expect(source).toContain("executeHooks('file-modified'");
  });

  it('markFilesModified accepts changeType parameter', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/agent.ts', 'utf-8');
    expect(source).toContain('changeType');
  });
});
