/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('index SDK mode startup ordering', () => {
  it('routes RPC and ACP before the interactive auth gate can print or prompt', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8');

    const authGateIndex = source.indexOf('await ensureAuthenticated(authConfig');
    const rpcModeIndex = source.indexOf("if (opts.mode === 'rpc')");
    const acpModeIndex = source.indexOf("if (opts.mode === 'acp')");

    expect(authGateIndex).toBeGreaterThan(-1);
    expect(rpcModeIndex).toBeGreaterThan(-1);
    expect(acpModeIndex).toBeGreaterThan(-1);
    expect(rpcModeIndex).toBeLessThan(authGateIndex);
    expect(acpModeIndex).toBeLessThan(authGateIndex);
  });
});
