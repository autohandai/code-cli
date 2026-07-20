/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rpcSourceUrls = [
  new URL('../../../src/modes/rpc/index.ts', import.meta.url),
  new URL('../../../src/modes/rpc/adapter.ts', import.meta.url),
  new URL('../../../src/modes/rpc/protocol.ts', import.meta.url),
];

describe('RPC debug logging boundary', () => {
  it('does not write diagnostics directly to stderr', async () => {
    const sources = await Promise.all(
      rpcSourceUrls.map(async (url) => ({
        path: fileURLToPath(url),
        source: await readFile(url, 'utf8'),
      }))
    );

    for (const { path, source } of sources) {
      const directWrites = source.match(/process\.stderr\.write\(/g) ?? [];
      expect(directWrites.length, path).toBe(0);
      expect(source, path).not.toContain('writeAutohandDebugLine');
      expect(source, path).not.toContain('../../utils/debugLog.js');
    }
  });
});
