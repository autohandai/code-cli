/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import {
  registerReviewCommand,
  type ReviewCliCommandDependencies,
} from '../src/review/reviewCliCommand.js';

function programWith(dependencies: ReviewCliCommandDependencies): Command {
  const program = new Command();
  program.name('autohand').exitOverride();
  registerReviewCommand(program, dependencies);
  return program;
}

describe('review CLI command', () => {
  it('runs an architecture review as a non-interactive request', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const serve = vi.fn().mockResolvedValue(undefined);
    const program = programWith({ run, serve });

    await program.parseAsync([
      'node',
      'autohand',
      'review',
      'architecture',
      'packages/api',
      '--audience',
      'technical',
      '--base',
      'origin/main',
      '--focus',
      'tenant boundaries',
    ]);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      interactive: false,
      request: {
        kind: 'architecture',
        audience: 'technical',
        format: 'markdown',
        target: 'packages/api',
        base: 'origin/main',
        focus: 'tenant boundaries',
      },
    }));
    expect(serve).not.toHaveBeenCalled();
  });

  it('defaults to reviewing current changes', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const program = programWith({ run, serve: vi.fn() });

    await program.parseAsync(['node', 'autohand', 'review']);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      interactive: false,
      request: {
        kind: 'changes',
        audience: 'mixed',
        format: 'markdown',
      },
    }));
  });

  it('starts the self-hosted report viewer without invoking a model', async () => {
    const run = vi.fn();
    const serve = vi.fn().mockResolvedValue(undefined);
    const program = programWith({ run, serve });

    await program.parseAsync([
      'node',
      'autohand',
      'review',
      'serve',
      'reports/security.md',
      '--port',
      '4317',
      '--no-open',
    ]);

    expect(serve).toHaveBeenCalledWith(expect.objectContaining({
      reportPath: 'reports/security.md',
      port: 4317,
      open: false,
    }));
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects invalid review values before invoking either runtime', async () => {
    const run = vi.fn();
    const serve = vi.fn();
    const program = programWith({ run, serve });

    await expect(program.parseAsync([
      'node',
      'autohand',
      'review',
      'security',
      '--audience',
      'board',
    ])).rejects.toThrow('Invalid review audience');

    expect(run).not.toHaveBeenCalled();
    expect(serve).not.toHaveBeenCalled();
  });

  it('rejects invalid server ports', async () => {
    const serve = vi.fn();
    const program = programWith({ run: vi.fn(), serve });

    await expect(program.parseAsync([
      'node',
      'autohand',
      'review',
      'serve',
      '--port',
      '70000',
    ])).rejects.toThrow('port');

    expect(serve).not.toHaveBeenCalled();
  });

  it('advertises public beta and the advanced review kinds', () => {
    const program = programWith({ run: vi.fn(), serve: vi.fn() });
    const help = program.commands.find((command) => command.name() === 'review')?.helpInformation() ?? '';

    expect(help).toContain('public beta');
    expect(help).toContain('architecture');
    expect(help).toContain('forensics');
    expect(help).toContain('serve');
  });
});
