/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression tests for UI flickering issues.
 * These tests verify that state updates are batched and stable,
 * preventing unnecessary re-renders that cause terminal flickering.
 */

import { describe, expect, it } from 'vitest';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';

describe('InkRenderer flickering prevention', () => {
  describe('appendLiveCommandOutput batching', () => {
    it('should buffer output and flush on finishLiveCommand', () => {
      const renderer = new InkRenderer({
        onInstruction: () => {},
        onEscape: () => {},
        onCtrlC: () => {},
      });

      const commandId = renderer.startLiveCommand('! bun test');

      // Simulate rapid output (like a fast command producing many chunks)
      const chunks = Array.from({ length: 20 }, (_, i) => `line ${i}\n`);
      chunks.forEach((chunk) => {
        renderer.appendLiveCommandOutput(commandId, 'stdout', chunk);
      });

      // Output is buffered, not immediately in state (prevents flickering)
      const state = renderer.getState();
      expect(state.liveCommands).toHaveLength(1);
      // Buffer is not flushed yet, so stdout is still empty in state
      expect(state.liveCommands[0]?.stdout).toBe('');

      // Finishing the command flushes the buffer
      renderer.finishLiveCommand(commandId, true);

      const finalState = renderer.getState();
      expect(finalState.liveCommands).toHaveLength(0);
      expect(finalState.toolOutputs).toHaveLength(1);
      const output = (finalState.toolOutputs[0] as { output: string }).output;
      expect(output).toContain('line 0');
      expect(output).toContain('line 19');
    });

    it('should handle interleaved stdout and stderr without losing data', () => {
      const renderer = new InkRenderer({
        onInstruction: () => {},
        onEscape: () => {},
        onCtrlC: () => {},
      });

      const commandId = renderer.startLiveCommand('! npm run build');

      renderer.appendLiveCommandOutput(commandId, 'stdout', 'building...\n');
      renderer.appendLiveCommandOutput(commandId, 'stderr', 'warning: deprecated\n');
      renderer.appendLiveCommandOutput(commandId, 'stdout', 'done\n');

      // Finish to flush buffer
      renderer.finishLiveCommand(commandId, true);

      const state = renderer.getState();
      expect(state.toolOutputs).toHaveLength(1);
      const output = (state.toolOutputs[0] as { output: string }).output;
      expect(output).toContain('building...');
      expect(output).toContain('done');
      expect(output).toContain('warning: deprecated');
    });
  });

  describe('state update stability', () => {
    it('should not create new array references when no live commands exist', () => {
      const renderer = new InkRenderer({
        onInstruction: () => {},
        onEscape: () => {},
        onCtrlC: () => {},
      });

      const state1 = renderer.getState();
      const state2 = renderer.getState();

      // Same reference when no mutations occurred
      expect(state1.liveCommands).toBe(state2.liveCommands);
    });

    it('should preserve toolOutputs reference when only updating status', () => {
      const renderer = new InkRenderer({
        onInstruction: () => {},
        onEscape: () => {},
        onCtrlC: () => {},
      });

      const state1 = renderer.getState();
      renderer.setStatus('Working...');
      const state2 = renderer.getState();

      // toolOutputs should not change when only status is updated
      expect(state1.toolOutputs).toBe(state2.toolOutputs);
    });

    it('should preserve liveCommands reference when only updating status', () => {
      const renderer = new InkRenderer({
        onInstruction: () => {},
        onEscape: () => {},
        onCtrlC: () => {},
      });

      const state1 = renderer.getState();
      renderer.setStatus('Working...');
      const state2 = renderer.getState();

      // liveCommands should not change when only status is updated
      expect(state1.liveCommands).toBe(state2.liveCommands);
    });
  });

  describe('finishLiveCommand cleanup', () => {
    it('should remove live command and add to toolOutputs atomically', () => {
      const renderer = new InkRenderer({
        onInstruction: () => {},
        onEscape: () => {},
        onCtrlC: () => {},
      });

      const commandId = renderer.startLiveCommand('! echo hello');
      renderer.appendLiveCommandOutput(commandId, 'stdout', 'hello\n');

      const beforeState = renderer.getState();
      expect(beforeState.liveCommands).toHaveLength(1);
      expect(beforeState.toolOutputs).toHaveLength(0);

      renderer.finishLiveCommand(commandId, true);

      const afterState = renderer.getState();
      expect(afterState.liveCommands).toHaveLength(0);
      expect(afterState.toolOutputs).toHaveLength(1);
      expect(afterState.toolOutputs[0]?.tool).toBe('shell');
      expect(afterState.toolOutputs[0]?.success).toBe(true);
    });

    it('should handle finishing a non-existent command gracefully', () => {
      const renderer = new InkRenderer({
        onInstruction: () => {},
        onEscape: () => {},
        onCtrlC: () => {},
      });

      // Should not throw
      expect(() => renderer.finishLiveCommand('non-existent', false)).not.toThrow();
    });
  });

  describe('setWorking state transitions', () => {
    it('should clear finalResponse when starting work', () => {
      const renderer = new InkRenderer({
        onInstruction: () => {},
        onEscape: () => {},
        onCtrlC: () => {},
      });

      renderer.setFinalResponse('Previous answer');
      expect(renderer.getState().finalResponse).toBe('Previous answer');

      renderer.setWorking(true, 'Starting...');
      expect(renderer.getState().finalResponse).toBeNull();
    });

    it('should save completion stats when stopping work', () => {
      const renderer = new InkRenderer({
        onInstruction: () => {},
        onEscape: () => {},
        onCtrlC: () => {},
      });

      renderer.setElapsed('5s');
      renderer.setTokens('1000 tokens');
      renderer.setWorking(true, 'Working...');
      renderer.setWorking(false, 'Done');

      const state = renderer.getState();
      expect(state.completionStats).toEqual({
        elapsed: '5s',
        tokens: '1000 tokens'
      });
    });

    it('should clear completion stats when starting new work', () => {
      const renderer = new InkRenderer({
        onInstruction: () => {},
        onEscape: () => {},
        onCtrlC: () => {},
      });

      renderer.setElapsed('5s');
      renderer.setTokens('1000 tokens');
      renderer.setWorking(true, 'Working...');
      renderer.setWorking(false, 'Done');
      expect(renderer.getState().completionStats).not.toBeNull();

      renderer.setWorking(true, 'New work...');
      expect(renderer.getState().completionStats).toBeNull();
    });
  });
});
