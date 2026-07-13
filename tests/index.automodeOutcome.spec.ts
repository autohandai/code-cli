/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const runAutoModeStart = indexSource.indexOf('async function runAutoMode(');
const runAutoModeEnd = indexSource.indexOf('/**\n * Build prompt for each auto-mode', runAutoModeStart);
const runAutoModeSource = indexSource.slice(runAutoModeStart, runAutoModeEnd);
const runIterationStart = runAutoModeSource.indexOf('const runIteration = async (');
const runIterationEnd = runAutoModeSource.indexOf('// Start the auto-mode loop', runIterationStart);
const runIterationSource = runAutoModeSource.slice(runIterationStart, runIterationEnd);

describe('standalone automode command outcomes', () => {
  it('forwards the manager abort signal through the command-mode boundary', () => {
    expect(runAutoModeStart).toBeGreaterThanOrEqual(0);
    expect(runAutoModeEnd).toBeGreaterThan(runAutoModeStart);
    expect(runIterationStart).toBeGreaterThanOrEqual(0);
    expect(runIterationEnd).toBeGreaterThan(runIterationStart);
    expect(runIterationSource).toMatch(
      /activeAgent\.runCommandMode\(\s*iterationPrompt,\s*\{ signal: abortSignal, keepAlive: true \},?\s*\)/,
    );
  });

  it('reports a false command-mode result as an unsuccessful iteration', () => {
    expect(runIterationSource).toMatch(
      /const success = await activeAgent\.runCommandMode\(/,
    );
    expect(runIterationSource).not.toContain('let success = true');
    expect(runIterationSource).toMatch(/return \{\s*success,/);
  });
});
