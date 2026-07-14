/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('index pipe handoff startup ordering', () => {
  it('resolves pipe stdin and interactive tty handoff before constructing AutohandAgent', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8');

    const pipeDetectionIndex = source.indexOf('const stdinType = detectStdinType();');
    const ttyRebindIndex = source.indexOf("openSync('/dev/tty', 'r')");
    const agentConstructionIndex = source.indexOf(
      'agent = new AutohandAgent(llmProvider, files, runtime);',
      pipeDetectionIndex,
    );

    expect(pipeDetectionIndex).toBeGreaterThan(-1);
    expect(ttyRebindIndex).toBeGreaterThan(pipeDetectionIndex);
    expect(agentConstructionIndex).toBeGreaterThan(-1);
    expect(ttyRebindIndex).toBeLessThan(agentConstructionIndex);
  });
});
