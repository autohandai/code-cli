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

  it('stores notifications as display events without changing active status', () => {
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
    expect(renderer.getState().chatMessages).toEqual([
      {
        role: 'notification',
        content: 'Session sync failed. Run /logout and /login if you continue to see this message.',
      },
    ]);
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
});
