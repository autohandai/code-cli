/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deepResearch,
  metadata,
  resolveAvailableResearchReportPath,
  slugifyResearchTopic,
} from '../../src/commands/deep-research.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

describe('/deep-research command', () => {
  let workspaceRoot: string;
  let queueInstruction: ReturnType<typeof vi.fn>;
  let activateSkill: ReturnType<typeof vi.fn>;
  let ctx: SlashCommandContext;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-deep-research-command-'));
    queueInstruction = vi.fn();
    activateSkill = vi.fn(() => true);
    ctx = {
      workspaceRoot,
      queueInstruction,
      skillsRegistry: {
        activateSkill,
      } as unknown as SlashCommandContext['skillsRegistry'],
    } as SlashCommandContext;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  it('exports slash metadata', () => {
    expect(metadata.command).toBe('/deep-research');
    expect(metadata.implemented).toBe(true);
    expect(metadata.description).toContain('research');
  });

  it('asks for a topic instead of queueing an empty research run', async () => {
    const result = await deepResearch(ctx, []);

    expect(result).toContain('Usage: /deep-research <topic>');
    expect(result).toContain('Hermes self evolving');
    expect(queueInstruction).not.toHaveBeenCalled();
    expect(activateSkill).not.toHaveBeenCalled();
  });

  it('slugifies topics into stable topic markdown filenames', async () => {
    expect(slugifyResearchTopic('Hermes self evolving')).toBe('hermes-self-evolving');
    expect(slugifyResearchTopic('DSPy')).toBe('dspy');
    expect(slugifyResearchTopic('  already---spaced__out  ')).toBe('already-spaced-out');
    expect(slugifyResearchTopic('???')).toBe('research');
  });

  it('avoids overwriting an existing research report', async () => {
    await fs.outputFile(
      path.join(workspaceRoot, '.autohand', 'research', 'topic-dspy.md'),
      '# Existing DSPy research\n'
    );

    const reportPath = await resolveAvailableResearchReportPath(workspaceRoot, 'DSPy');

    expect(reportPath).toBe(path.join(workspaceRoot, '.autohand', 'research', 'topic-dspy-2.md'));
  });

  it('activates the built-in skill, queues a full research instruction, and returns display output', async () => {
    const result = await deepResearch(ctx, ['Hermes', 'self', 'evolving']);

    expect(result).toContain('Deep research started');
    expect(result).toContain('.autohand/research/topic-hermes-self-evolving.md');
    expect(activateSkill).toHaveBeenCalledWith('deep-research');
    expect(queueInstruction).toHaveBeenCalledOnce();

    const queued = queueInstruction.mock.calls[0][0] as string;
    expect(queued).toContain('Hermes self evolving');
    expect(queued).toContain('.autohand/research/topic-hermes-self-evolving.md');
    expect(queued).toContain('web_search');
    expect(queued).toContain('fetch_url');
    expect(queued).toContain('write_file');
    expect(queued).toContain('Do not stop until');
    expect(queued).toContain('Research saved: .autohand/research/topic-hermes-self-evolving.md');
  });

  it('returns the prompt in non-interactive mode without queueing', async () => {
    const result = await deepResearch(
      {
        ...ctx,
        isNonInteractive: true,
      } as SlashCommandContext,
      ['DSPy']
    );

    expect(result).toContain('DSPy');
    expect(result).toContain('.autohand/research/topic-dspy.md');
    expect(result).toContain('Do not stop until');
    expect(queueInstruction).not.toHaveBeenCalled();
  });
});
