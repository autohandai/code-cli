/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { plan, metadata, getPlanModeManager } from '../../src/commands/plan.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

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
