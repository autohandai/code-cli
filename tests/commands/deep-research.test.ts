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
  aliasMetadata,
  deepResearch,
  metadata,
  resolveAvailableResearchReportPath,
  slugifyResearchTopic,
} from '../../src/commands/deep-research.js';
import { markDeepResearchRunStarted } from '../../src/deepResearch/session.js';
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
    expect(metadata.subcommands).toContainEqual({
      name: 'status',
      description: expect.stringContaining('active'),
    });
    expect(aliasMetadata.command).toBe('/deep-search');
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
    expect(result).toContain('/deep-research status');
    expect(activateSkill).toHaveBeenCalledWith('deep-research');
    expect(queueInstruction).toHaveBeenCalledOnce();

    const queued = queueInstruction.mock.calls[0][0] as string;
    const postTurnAction = queueInstruction.mock.calls[0][1];
    expect(queued).toContain('Hermes self evolving');
    expect(queued).toContain('.autohand/research/topic-hermes-self-evolving.md');
    expect(queued).toContain('web_search');
    expect(queued).toContain('fetch_url');
    expect(queued).toContain('write_file');
    expect(queued).toContain('Do not stop until');
    expect(queued).toContain('Research saved: .autohand/research/topic-hermes-self-evolving.md');
    expect(queued).toMatch(/AUTOHAND_DEEP_RESEARCH_RUN_ID: [a-f0-9-]+/);
    expect(postTurnAction).toEqual({
      kind: 'publish-research',
      reportPath: '.autohand/research/topic-hermes-self-evolving.md',
      runId: expect.stringMatching(/^[a-f0-9-]+$/),
    });
  });

  it('shows vital progress for the active research run', async () => {
    ctx.currentSession = {
      metadata: { sessionId: 'session-1' },
      getMessages: () => [],
    } as unknown as SlashCommandContext['currentSession'];
    await deepResearch(ctx, ['Hermes', 'self', 'evolving']);
    const queued = queueInstruction.mock.calls[0][0] as string;
    const runId = queued.match(/AUTOHAND_DEEP_RESEARCH_RUN_ID: ([a-f0-9-]+)/)?.[1];
    expect(runId).toBeDefined();
    await markDeepResearchRunStarted(workspaceRoot, runId!);

    ctx.getTotalTokensUsed = () => 12_345;
    ctx.getTokenUsageStatus = () => 'actual';
    ctx.getContextPercentLeft = () => 37;
    ctx.currentSession = {
      metadata: { sessionId: 'session-1' },
      getMessages: () => [
        {
          role: 'assistant',
          timestamp: new Date().toISOString(),
          content: '',
          toolCalls: [
            {
              id: 'todo-1',
              tool: 'todo_write',
              args: {
                tasks: [
                  { title: 'Scope the question', status: 'completed' },
                  { title: 'Verify repository claims', status: 'in_progress' },
                  { title: 'Write the cited report', status: 'pending' },
                ],
              },
            },
            { id: 'repo-1', tool: 'web_repo', args: { repo: 'github:pratic-ai/pratic' } },
            { id: 'fetch-1', tool: 'fetch_url', args: { url: 'https://example.com/source' } },
          ],
        },
        {
          role: 'tool',
          timestamp: new Date().toISOString(),
          name: 'web_repo',
          tool_call_id: 'repo-1',
          content: 'Repository not found. Check the URL/shorthand is correct.',
        },
      ],
    } as unknown as SlashCommandContext['currentSession'];

    const result = await deepResearch(ctx, ['status']);

    expect(result).toContain('State: Running');
    expect(result).toContain('Topic: Hermes self evolving');
    expect(result).toContain('Progress: 1/3 completed');
    expect(result).toContain('Current: Verify repository claims');
    expect(result).toContain('1 page fetched');
    expect(result).toContain('1 repository checked');
    expect(result).toContain('1 failed tool result');
    expect(result).toContain('Report: .autohand/research/topic-hermes-self-evolving.md (not written yet)');
    expect(result).toContain('Tokens: 12,345');
    expect(result).toContain('Context remaining: 37%');
  });

  it('does not replace a queued research run with a second topic', async () => {
    await deepResearch(ctx, ['first', 'topic']);
    const second = await deepResearch(ctx, ['second', 'topic']);

    expect(second).toContain('Deep research is already queued: first topic');
    expect(second).toContain('/deep-research status');
    expect(queueInstruction).toHaveBeenCalledOnce();
  });

  it('reports when no deep research run exists', async () => {
    const result = await deepResearch(ctx, ['status']);

    expect(result).toBe('No deep research run found. Start one with /deep-research <topic>.');
    expect(queueInstruction).not.toHaveBeenCalled();
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
