/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';

describe('InkRenderer live command blocks', () => {
  it('replaces a queued instruction without changing queue order', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    renderer.addQueuedInstruction('first');
    renderer.addQueuedInstruction('second');
    renderer.addQueuedInstruction('third');

    expect(renderer.replaceQueuedInstruction(1, 'updated second')).toBe(true);
    expect(renderer.getState().queuedInstructions).toEqual(['first', 'updated second', 'third']);
  });

  it('removes a queued instruction and preserves FIFO order for the rest', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    renderer.addQueuedInstruction('first');
    renderer.addQueuedInstruction('second');
    renderer.addQueuedInstruction('third');

    expect(renderer.removeQueuedInstruction(1)).toBe(true);
    expect(renderer.getState().queuedInstructions).toEqual(['first', 'third']);
    expect(renderer.dequeueInstruction()).toBe('first');
    expect(renderer.dequeueInstruction()).toBe('third');
  });

  it('archives a completed final response before the next user turn starts', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    renderer.addUserMessage('tell me a good joke about dogs');
    renderer.setFinalResponse('What do dogs use after a bath? A hair dryer.');

    renderer.setWorking(true, 'Reasoning...');
    renderer.addUserMessage('another about monkeys');

    expect(renderer.getState().finalResponse).toBeNull();
    expect(renderer.getState().chatMessages).toEqual([
      { role: 'user', content: 'tell me a good joke about dogs' },
      { role: 'assistant', content: 'What do dogs use after a bath? A hair dryer.' },
      { role: 'user', content: 'another about monkeys' },
    ]);
  });

  it('records grouped parallel tool output as a single batch chat message', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    renderer.addToolCall('read_file', 'src/a.ts, src/b.ts (+2 more)');
    renderer.addToolOutputBatch([
      { tool: 'read_file', label: 'src/a.ts', detail: '10 lines - 120 B', success: true },
      { tool: 'read_file', label: 'src/b.ts', detail: '20 lines - 240 B', success: true },
      { tool: 'read_file', label: 'src/c.ts', detail: '30 lines - 360 B', success: true },
      { tool: 'read_file', label: 'src/d.ts', detail: '40 lines - 480 B', success: false },
    ]);

    const state = renderer.getState();
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual({
      role: 'tool_call',
      tool: 'read_file',
      content: 'src/a.ts, src/b.ts (+2 more)',
    });
    expect(state.chatMessages[1]).toMatchObject({
      role: 'tool_batch',
      success: false,
      groups: [
        {
          tool: 'read_file',
          items: [
            { tool: 'read_file', label: 'src/a.ts', detail: '10 lines - 120 B', success: true },
            { tool: 'read_file', label: 'src/b.ts', detail: '20 lines - 240 B', success: true },
            { tool: 'read_file', label: 'src/c.ts', detail: '30 lines - 360 B', success: true },
            { tool: 'read_file', label: 'src/d.ts', detail: '40 lines - 480 B', success: false },
          ],
        },
      ],
    });
    expect(state.toolOutputs).toHaveLength(1);
    expect(state.toolOutputs[0]).toMatchObject({ type: 'batch', allSuccess: false });
  });

  it('keeps completed turns in chronological transcript order', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    renderer.addUserMessage('where am I?');
    renderer.setThinking('Need to inspect the current directory.');
    renderer.addToolOutput('run_command', true, '$ pwd\n/tmp/project');
    renderer.setElapsed('1s');
    renderer.setTokens('10 tokens');
    renderer.setWorking(false);
    renderer.setFinalResponse('You are in /tmp/project.');
    renderer.setWorking(true, 'Reasoning...');
    renderer.addUserMessage('thanks');

    expect(renderer.getState().chatMessages).toEqual([
      { role: 'user', content: 'where am I?' },
      {
        role: 'tool',
        tool: 'run_command',
        success: true,
        content: '$ pwd\n/tmp/project',
      },
      { role: 'assistant', content: 'You are in /tmp/project.' },
      { role: 'completion', content: 'Completed in 1s · 10 tokens' },
      { role: 'user', content: 'thanks' },
    ]);
  });

  it('archives failed turn stats without labeling the turn completed', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    renderer.addUserMessage('research competitors');
    renderer.setElapsed('6m 43s');
    renderer.setTokens('543.4k tokens');
    renderer.setWorking(false, 'Session failed', { succeeded: false });
    renderer.setWorking(true, 'Reasoning...');
    renderer.addUserMessage('continue');

    expect(renderer.getState().chatMessages).toContainEqual({
      role: 'completion',
      content: 'Failed in 6m 43s · 543.4k tokens',
    });
  });

  it('records tool-call starts in chat history before completed output', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    renderer.addUserMessage('inspect the entrypoint');
    renderer.addToolCall('read_file', 'src/index.ts');
    renderer.addToolOutput('read_file', true, 'export async function main() {}');

    expect(renderer.getState().chatMessages).toEqual([
      { role: 'user', content: 'inspect the entrypoint' },
      { role: 'tool_call', tool: 'read_file', content: 'src/index.ts' },
      {
        role: 'tool',
        tool: 'read_file',
        success: true,
        content: 'export async function main() {}',
      },
    ]);
  });

  it('does not move the previous assistant answer after an immediately echoed next prompt', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    renderer.addUserMessage('tell me a joke');
    renderer.setElapsed('2s');
    renderer.setTokens('13.1k tokens');
    renderer.setWorking(false);
    renderer.setFinalResponse('Because it had too many unresolved dependencies.');

    renderer.addUserMessage('what about this repo?');
    renderer.setWorking(true, 'Bootstrapping...');

    expect(renderer.getState().chatMessages).toEqual([
      { role: 'user', content: 'tell me a joke' },
      { role: 'assistant', content: 'Because it had too many unresolved dependencies.' },
      { role: 'completion', content: 'Completed in 2s · 13.1k tokens' },
      { role: 'user', content: 'what about this repo?' },
    ]);
  });

  it('stores notifications outside chat history without changing active status', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    renderer.setWorking(true, 'Parsing...');
    renderer.setElapsed('0m 34s');
    renderer.setTokens('40.7k tokens');
    renderer.addNotification('Session sync failed. Run /logout and /login if you continue to see this message.');

    expect(renderer.getState().status).toBe('Parsing...');
    expect(renderer.getState().notifications).toEqual([
      'Session sync failed. Run /logout and /login if you continue to see this message.',
    ]);
    expect(renderer.getState().chatMessages).toEqual([]);
  });

  it('tracks a running command and finalizes it into tool output', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    const commandId = renderer.startLiveCommand('! bun run proof');

    // Output is buffered to prevent flickering - not immediately visible in state
    renderer.appendLiveCommandOutput(commandId, 'stdout', 'line 1\n');
    renderer.appendLiveCommandOutput(commandId, 'stderr', 'warn 1\n');

    expect(renderer.getState().liveCommands).toHaveLength(1);
    expect(renderer.getState().liveCommands[0]?.command).toBe('! bun run proof');

    // Finish the command to flush the buffer
    renderer.finishLiveCommand(commandId, true);

    expect(renderer.getState().liveCommands).toHaveLength(0);
    expect(renderer.getState().toolOutputs).toHaveLength(1);
    expect(renderer.getState().toolOutputs[0]).toMatchObject({
      tool: 'shell',
      success: true,
    });
    expect((renderer.getState().toolOutputs[0] as { output: string }).output).toContain('! bun run proof');
    expect((renderer.getState().toolOutputs[0] as { output: string }).output).toContain('line 1');
    expect((renderer.getState().toolOutputs[0] as { output: string }).output).toContain('warn 1');
  });

  it('starts live commands collapsed and toggles the active command expansion state', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    const commandId = renderer.startLiveCommand('! bun run proof');

    expect(renderer.getState().liveCommands[0]?.isExpanded).toBe(false);

    renderer.toggleActiveLiveCommandExpanded();
    expect(renderer.getState().liveCommands[0]?.isExpanded).toBe(true);

    renderer.toggleActiveLiveCommandExpanded();
    expect(renderer.getState().liveCommands[0]?.isExpanded).toBe(false);

    renderer.finishLiveCommand(commandId, true);
  });

  it('shows buffered live command output immediately when the user expands it', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    const commandId = renderer.startLiveCommand('! bun run proof');
    renderer.appendLiveCommandOutput(commandId, 'stdout', 'running tests\n');

    renderer.toggleActiveLiveCommandExpanded();

    expect(renderer.getState().liveCommands[0]).toMatchObject({
      id: commandId,
      isExpanded: true,
      stdout: 'running tests\n',
    });

    renderer.finishLiveCommand(commandId, true);
  });

  it('bounds long-running live command output while preserving the newest lines', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    const commandId = renderer.startLiveCommand('! bun dev');
    renderer.appendLiveCommandOutput(
      commandId,
      'stdout',
      `${'old-output\n'.repeat(30_000)}latest-background-line\n`,
    );

    renderer.toggleActiveLiveCommandExpanded();

    const stdout = renderer.getState().liveCommands[0]?.stdout ?? '';
    expect(stdout.length).toBeLessThanOrEqual(256 * 1024);
    expect(stdout).toContain('[earlier live output truncated]');
    expect(stdout).toContain('latest-background-line');

    renderer.finishLiveCommand(commandId, true);
  });

  it('keeps completed background output concise without losing the command or newest lines', () => {
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });

    const commandId = renderer.startLiveCommand('! bun run proof');
    renderer.appendLiveCommandOutput(
      commandId,
      'stdout',
      `${'old-stdout\n'.repeat(30_000)}latest-completed-line\n`,
    );
    renderer.appendLiveCommandOutput(
      commandId,
      'stderr',
      `${'old-stderr\n'.repeat(30_000)}latest-completed-warning\n`,
    );

    renderer.finishLiveCommand(commandId, true);

    const output = (renderer.getState().toolOutputs[0] as { output: string }).output;
    expect(output.length).toBeLessThanOrEqual(64 * 1024);
    expect(output).toContain('$ ! bun run proof');
    expect(output).toContain('[earlier live output truncated]');
    expect(output).toContain('latest-completed-line');
    expect(output).toContain('latest-completed-warning');
  });
});
