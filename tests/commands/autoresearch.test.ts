/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { autoresearch, metadata, runAutoResearchCli } from '../../src/commands/autoresearch.js';
import { AutoResearchManager } from '../../src/autoresearch/manager.js';
import { appendLogEntry, readConfigJson, readMeasureSh, readPromptMd, writeConfigJson, writePromptMd } from '../../src/autoresearch/session.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

describe('/autoresearch command', () => {
  let workspaceRoot: string;
  let executeHooks: ReturnType<typeof vi.fn>;
  let ctx: SlashCommandContext;
  let queuedInstructions: string[];

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-cmd-'));
    queuedInstructions = [];
    executeHooks = vi.fn(async () => []);
    ctx = {
      workspaceRoot,
      isNonInteractive: false,
      queueInstruction: (instruction: string) => {
        queuedInstructions.push(instruction);
      },
      hookManager: { executeHooks } as unknown as SlashCommandContext['hookManager'],
    } as SlashCommandContext;
  });

  it('exports command metadata with subcommands', () => {
    expect(metadata.command).toBe('/autoresearch');
    expect(metadata.implemented).toBe(true);
    expect(metadata.subcommands?.map((s) => s.name)).toEqual(
      expect.arrayContaining(['off', 'clear', 'export', 'finalize', 'status'])
    );
  });

  it('shows help when invoked with no arguments', async () => {
    const result = await autoresearch(ctx, []);
    expect(result).toContain('Usage');
    expect(result).toContain('/autoresearch');
  });

  it('starts a new session, queues a loop instruction, and emits a start hook', async () => {
    const result = await autoresearch(ctx, ['optimize', 'test', 'runtime']);

    expect(result).toContain('Auto-research session started');
    expect(queuedInstructions).toHaveLength(1);
    expect(queuedInstructions[0]).toContain('Auto-research loop');
    expect(queuedInstructions[0]).toContain('Session setup contract');
    expect(queuedInstructions[0]).toContain('benchmark command');
    expect(queuedInstructions[0]).toContain('metric name, metric unit, and optimization direction');
    expect(queuedInstructions[0]).toContain('editable scope');
    expect(queuedInstructions[0]).toContain('correctness checks');
    expect(queuedInstructions[0]).toContain('maximum iterations');
    expect(queuedInstructions[0]).toContain('subagent phases');

    const manager = new AutoResearchManager(workspaceRoot);
    const state = await manager.getState();
    expect(state?.active).toBe(true);
    expect(state?.goal).toBe('optimize test runtime');
    expect(executeHooks).toHaveBeenCalledWith('autoresearch:start', expect.objectContaining({
      autoresearchGoal: 'optimize test runtime',
      autoresearchActive: true,
      autoresearchIteration: 0,
      autoresearchMaxIterations: 30,
      autoresearchSubcommand: 'start',
    }));
  });

  it('starts a new session from inferred benchmark flags', async () => {
    const result = await autoresearch(ctx, [
      'optimize',
      'test',
      'runtime',
      '--metric',
      'total_ms',
      '--unit',
      'ms',
      '--direction',
      'lower',
      '--measure',
      'bun test --reporter dot',
      '--checks',
      'bun run lint',
      '--max-iterations',
      '12',
      '--timeout-ms',
      '5000',
      '--scope',
      'src',
      '--scope',
      'tests',
      '--subagent-ideas',
      '--subagent-analysis',
      '--subagent-finalization',
    ]);

    expect(result).toContain('Auto-research session started');
    expect(result).toContain('Initialized benchmark config from command options.');

    const manager = new AutoResearchManager(workspaceRoot);
    expect(await manager.getState()).toEqual(expect.objectContaining({
      active: true,
      goal: 'optimize test runtime',
      maxIterations: 12,
    }));

    expect(await readConfigJson(workspaceRoot)).toEqual(expect.objectContaining({
      name: 'optimize test runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      maxIterations: 12,
      timeoutMs: 5000,
      subagents: {
        ideaGeneration: true,
        measurementAnalysis: true,
        finalization: true,
      },
    }));
    expect(await readMeasureSh(workspaceRoot)).toContain('bun test --reporter dot');
    expect(await fs.readFile(path.join(workspaceRoot, '.auto', 'checks.sh'), 'utf-8')).toContain('bun run lint');

    const prompt = await readPromptMd(workspaceRoot);
    expect(prompt?.filesInScope).toEqual(['src', 'tests']);
    expect(prompt?.subagentPlan).toEqual(expect.arrayContaining([
      expect.stringContaining('idea generation'),
      expect.stringContaining('measurement analysis'),
      expect.stringContaining('finalization'),
    ]));
  });

  it('resumes an active session with added context and emits a resume hook', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime');

    const result = await autoresearch(ctx, ['focus', 'on', 'mock', 'setup']);

    expect(result).toContain('Resuming');
    expect(queuedInstructions).toHaveLength(1);
    expect(queuedInstructions[0]).toContain('focus on mock setup');
    expect(executeHooks).toHaveBeenCalledWith('autoresearch:start', expect.objectContaining({
      autoresearchGoal: 'optimize test runtime',
      autoresearchActive: true,
      autoresearchSubcommand: 'resume',
    }));
  });

  it('resumes a paused session without resetting goal or iteration', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime', 10);
    await manager.recordLoggedIteration(2);
    await autoresearch(ctx, ['off']);
    queuedInstructions = [];
    executeHooks.mockClear();

    const result = await autoresearch(ctx, ['focus', 'on', 'cache', 'setup']);

    expect(result).toContain('Resuming auto-research session: optimize test runtime');
    expect(queuedInstructions).toHaveLength(1);
    expect(queuedInstructions[0]).toContain('Additional context: focus on cache setup');
    const state = await manager.getState();
    expect(state).toEqual(expect.objectContaining({
      active: true,
      goal: 'optimize test runtime',
      iteration: 2,
      maxIterations: 10,
    }));
    expect(executeHooks).toHaveBeenCalledWith('autoresearch:start', expect.objectContaining({
      autoresearchGoal: 'optimize test runtime',
      autoresearchActive: true,
      autoresearchIteration: 2,
      autoresearchSubcommand: 'resume',
    }));
  });

  it('resumes from prompt.md when runtime state is missing', async () => {
    await writePromptMd(workspaceRoot, {
      goal: 'optimize persisted prompt runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
    });

    const result = await autoresearch(ctx, ['continue', 'from', 'logs']);

    expect(result).toContain('Resuming auto-research session: optimize persisted prompt runtime');
    const manager = new AutoResearchManager(workspaceRoot);
    expect((await manager.getState())?.goal).toBe('optimize persisted prompt runtime');
    expect(queuedInstructions[0]).toContain('Additional context: continue from logs');
    expect(executeHooks).toHaveBeenCalledWith('autoresearch:start', expect.objectContaining({
      autoresearchGoal: 'optimize persisted prompt runtime',
      autoresearchSubcommand: 'resume',
    }));
  });

  it('refuses to clear session state without explicit confirmation', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime');

    const result = await autoresearch(ctx, ['clear']);

    expect(result).toContain('requires confirmation');
    expect(result).toContain('/autoresearch clear --yes');
    expect((await manager.getState())?.goal).toBe('optimize test runtime');
  });

  it('clears session state after explicit confirmation', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime');

    const result = await autoresearch(ctx, ['clear', '--yes']);

    expect(result).toContain('cleared');
    expect(await manager.getState()).toBeNull();
  });

  it('reports session status', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime');

    const result = await autoresearch(ctx, ['status']);

    expect(result).toContain('optimize test runtime');
  });

  it('finalizes kept runs into a reviewable artifact', async () => {
    await writeConfigJson(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
    });
    await appendLogEntry(workspaceRoot, {
      run: 1,
      status: 'kept',
      metric: 100,
      description: 'baseline',
      commit: 'abc123',
      timestamp: '2026-07-08T00:00:00.000Z',
    });

    const result = await autoresearch(ctx, ['finalize']);

    expect(result).toContain('Finalize plan written');
    expect(result).toContain('.auto/finalize.md');
  });

  it('turns auto-research mode off and emits a pause hook', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime');

    const result = await autoresearch(ctx, ['off']);

    expect(result).toContain('paused');
    expect((await manager.getState())?.active).toBe(false);
    expect(executeHooks).toHaveBeenCalledWith('autoresearch:pause', expect.objectContaining({
      autoresearchGoal: 'optimize test runtime',
      autoresearchActive: false,
      autoresearchSubcommand: 'off',
    }));
  });
});

describe('auto-research CLI command helper', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-cli-'));
  });

  it('starts a session and returns the generated loop instruction', async () => {
    const result = await runAutoResearchCli(workspaceRoot, ['optimize', 'test', 'runtime']);

    expect(result).toContain('Auto-research session started');
    expect(result).toContain('Loop instruction');
    expect(result).toContain('run_experiment');
    expect(result).toContain('log_experiment');

    const manager = new AutoResearchManager(workspaceRoot);
    expect((await manager.getState())?.goal).toBe('optimize test runtime');
  });

  it('returns status output without requiring an interactive queue', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime');

    const result = await runAutoResearchCli(workspaceRoot, ['status']);

    expect(result).toContain('optimize test runtime');
    expect(result).not.toContain('Loop instruction');
  });

  it('is wired as the autohand auto-research top-level command', async () => {
    const indexSource = await fs.readFile(path.join(process.cwd(), 'src/index.ts'), 'utf-8');

    expect(indexSource).toContain(".command('auto-research [args...]')");
    expect(indexSource).toContain(".alias('autoresearch')");
    expect(indexSource).toContain('runAutoResearchCli');
  });
});
