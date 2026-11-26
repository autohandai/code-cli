/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';

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

describe('Quality Pipeline modal scope', () => {
  it('uses a typed instruction runner port instead of an any host index signature', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/agent/InstructionRunner.ts', 'utf-8');
    const agentSource = readFileSync('src/core/agent.ts', 'utf-8');

    expect(source).toContain('export interface AgentInstructionHost');
    expect(source).toContain('export class InstructionRunner');
    expect(source).toContain('constructor(private readonly host: AgentInstructionHost)');
    expect(source).not.toContain('[key: string]: any');
    expect(agentSource).toContain('private instructionRunner!: InstructionRunner');
    expect(agentSource).toContain('this.instructionRunner = new InstructionRunner');
    expect(agentSource).toContain('this.instructionRunner ??= new InstructionRunner');
    expect(agentSource).toContain(
      'async runInstruction(instruction: string, options?: RunInstructionOptions): Promise<boolean>'
    );
    expect(agentSource).toContain('return this.instructionRunner.run(instruction, options)');
  });

  it('opens a modal scope before the quality pipeline runs', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/agent/InstructionRunner.ts', 'utf-8');

    const qualityPipelineSection = source.substring(
      source.indexOf('if (host.lastIntent === \'implementation\' && host.filesModifiedThisSession'),
      source.indexOf('await host.runQualityPipeline()') + 'await host.runQualityPipeline()'.length
    );

    expect(qualityPipelineSection).toContain('const leaveModal = host.enterModal()');
  });

  it('leaves the modal scope in a finally after the quality pipeline completes', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/agent/InstructionRunner.ts', 'utf-8');

    const runQualityIndex = source.indexOf('await host.runQualityPipeline()');
    const resetIndex = source.indexOf('leaveModal()', runQualityIndex);

    expect(runQualityIndex).toBeGreaterThanOrEqual(0);
    expect(resetIndex).toBeGreaterThan(runQualityIndex);
    expect(source.slice(runQualityIndex, resetIndex)).toContain('finally');
  });

});
