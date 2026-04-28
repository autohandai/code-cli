/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    gray: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

vi.mock('../../src/core/CodeQualityPipeline.js', () => ({
  CodeQualityPipeline: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      passed: true,
      checks: [
        { type: 'lint', name: 'Lint', command: 'npm run lint', status: 'passed', duration: 100 },
      ],
      duration: 100,
      summary: '1 passed',
    }),
  })),
}));

describe('Quality Pipeline modalActive flag', () => {
  it('should set modalActive=true before quality pipeline runs', async () => {
    // Read the source code to verify the fix
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/agent.ts', 'utf-8');

    // Verify that modalActive is set to true before quality pipeline
    expect(source).toContain('this.modalActive = true');
    expect(source).toContain('this.modalActive = false');

    // Verify the pattern: modalActive=true before runQualityPipeline
    const qualityPipelineSection = source.substring(
      source.indexOf('if (this.lastIntent === \'implementation\' && this.filesModifiedThisSession)'),
      source.indexOf('await this.runQualityPipeline()') + 'await this.runQualityPipeline()'.length
    );

    expect(qualityPipelineSection).toContain('this.modalActive = true');
  });

  it('should set modalActive=false after quality pipeline completes', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/agent.ts', 'utf-8');

    // Find the section after runQualityPipeline call
    const runQualityIndex = source.indexOf('await this.runQualityPipeline()');
    const afterQualitySection = source.substring(
      runQualityIndex,
      runQualityIndex + 300
    );

    // Verify modalActive is set to false after quality pipeline
    expect(afterQualitySection).toContain('this.modalActive = false');
  });

  it('should suppress hook output when modalActive is true', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/agent.ts', 'utf-8');

    // Verify onHookOutput checks modalActive
    const onHookOutputSection = source.substring(
      source.indexOf('onHookOutput:'),
      source.indexOf('onHookOutput:') + 500
    );

    expect(onHookOutputSection).toContain('if (this.modalActive)');
    expect(onHookOutputSection).toContain('return;');
  });
});
