/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { plan, metadata, getPlanModeManager } from '../../src/commands/plan.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';
import type { InteractionMode } from '../../src/core/agent/InteractionModeController.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

describe('/plan command', () => {
  const mockCtx = {} as SlashCommandContext;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Reset plan mode state
    const manager = getPlanModeManager();
    if (manager.isEnabled()) {
      manager.disable();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has correct command name', () => {
      expect(metadata.command).toBe('/plan');
    });

    it('is marked as implemented', () => {
      expect(metadata.implemented).toBe(true);
    });

    it('has a description', () => {
      expect(metadata.description).toBeTruthy();
    });
  });

  describe('toggle behavior', () => {
    it('selects plan through the canonical interaction mode controller', async () => {
      let interactionMode: InteractionMode = 'yolo';
      const setInteractionMode = vi.fn((mode: InteractionMode) => {
        interactionMode = mode;
        return mode;
      });
      const ctx = {
        getInteractionMode: () => interactionMode,
        setInteractionMode,
      } as unknown as SlashCommandContext;

      await plan(ctx, '');

      expect(setInteractionMode).toHaveBeenCalledWith('plan');
      expect(interactionMode).toBe('plan');
    });

    it('enables plan mode when called without args and disabled', async () => {
      const manager = getPlanModeManager();
      expect(manager.isEnabled()).toBe(false);

      await plan(mockCtx, '');

      expect(manager.isEnabled()).toBe(true);
    });

    it('disables plan mode when called without args and enabled', async () => {
      const manager = getPlanModeManager();
      manager.enable();
      expect(manager.isEnabled()).toBe(true);

      await plan(mockCtx, '');

      expect(manager.isEnabled()).toBe(false);
    });

    it('prints only the canonical plan status when enabling plan mode', async () => {
      const output: string[] = [];

      await plan(mockCtx, '', { output: (message) => output.push(stripAnsi(message)) });

      expect(output).toEqual(['[PLAN] Plan mode active - tools are read-only']);
      expect(output.join('\n')).not.toContain('Plan mode enabled.');
      expect(output.join('\n')).not.toContain('Tools are now read-only.');
    });
  });

  describe('explicit on/off', () => {
    it('enables plan mode with "on" arg', async () => {
      await plan(mockCtx, 'on');

      const manager = getPlanModeManager();
      expect(manager.isEnabled()).toBe(true);
    });

    it('enables plan mode with "enable" arg', async () => {
      await plan(mockCtx, 'enable');

      const manager = getPlanModeManager();
      expect(manager.isEnabled()).toBe(true);
    });

    it('disables plan mode with "off" arg', async () => {
      const manager = getPlanModeManager();
      manager.enable();

      await plan(mockCtx, 'off');

      expect(manager.isEnabled()).toBe(false);
    });

    it('disables plan mode with "disable" arg', async () => {
      const manager = getPlanModeManager();
      manager.enable();

      await plan(mockCtx, 'disable');

      expect(manager.isEnabled()).toBe(false);
    });
  });

  describe('status', () => {
    it('shows status when requested', async () => {
      const result = await plan(mockCtx, 'status');

      expect(console.log).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('handles unknown subcommand gracefully', async () => {
      const result = await plan(mockCtx, 'unknown');

      expect(console.log).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('getPlanModeManager', () => {
    it('returns the same instance on multiple calls', () => {
      const manager1 = getPlanModeManager();
      const manager2 = getPlanModeManager();

      expect(manager1).toBe(manager2);
    });
  });
});
