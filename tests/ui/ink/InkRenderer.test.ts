/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';

describe('InkRenderer live command blocks', () => {
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
