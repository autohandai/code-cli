/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs-extra before importing modules that use it
vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    readJson: vi.fn().mockResolvedValue({}),
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockResolvedValue(''),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock chalk to avoid ANSI in tests
vi.mock('chalk', () => ({
  default: {
    gray: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    cyan: (s: string) => s,
    bold: {
      cyan: (s: string) => s,
      green: (s: string) => s,
    },
  },
}));

describe('PlanModeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should start with plan mode disabled by default', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      expect(manager.isEnabled()).toBe(false);
      expect(manager.getPhase()).toBe('planning');
    });

    it('should have null plan on initialization', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      expect(manager.getPlan()).toBeNull();
    });
  });

  describe('enable/disable', () => {
    it('should enable plan mode when enable() is called', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();

      expect(manager.isEnabled()).toBe(true);
      expect(manager.getPhase()).toBe('planning');
    });

    it('should disable plan mode when disable() is called', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();
      manager.disable();

      expect(manager.isEnabled()).toBe(false);
    });

    it('should emit "enabled" event when plan mode is enabled', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();
      const callback = vi.fn();

      manager.on('enabled', callback);
      manager.enable();

      expect(callback).toHaveBeenCalled();
    });

    it('should emit "disabled" event when plan mode is disabled', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();
      const callback = vi.fn();

      manager.enable();
      manager.on('disabled', callback);
      manager.disable();

      expect(callback).toHaveBeenCalled();
    });

    it('should toggle plan mode when toggle() is called', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      // First toggle: enable
      manager.toggle();
      expect(manager.isEnabled()).toBe(true);

      // Second toggle: disable
      manager.toggle();
      expect(manager.isEnabled()).toBe(false);
    });
  });

  describe('Shift+Tab toggle behavior', () => {
    it('should enable plan mode on Shift+Tab when disabled', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      expect(manager.isEnabled()).toBe(false);

      manager.handleShiftTab();

      expect(manager.isEnabled()).toBe(true);
    });

    it('should disable plan mode on Shift+Tab when enabled', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();
      expect(manager.isEnabled()).toBe(true);

      manager.handleShiftTab();

      expect(manager.isEnabled()).toBe(false);
    });

    it('should toggle on each Shift+Tab press', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      expect(manager.isEnabled()).toBe(false);

      manager.handleShiftTab(); // Enable
      expect(manager.isEnabled()).toBe(true);

      manager.handleShiftTab(); // Disable
      expect(manager.isEnabled()).toBe(false);

      manager.handleShiftTab(); // Enable again
      expect(manager.isEnabled()).toBe(true);
    });
  });

  describe('prompt indicator', () => {
    it('should return "[PLAN]" indicator when plan mode is enabled', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();

      expect(manager.getPromptIndicator()).toBe('[PLAN]');
    });

    it('should return empty string when plan mode is disabled', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      expect(manager.getPromptIndicator()).toBe('');
    });

    it('should return "[EXEC]" indicator during execution phase', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();
      // Set a plan so we can start execution
      manager.setPlan({
        id: 'test-plan',
        steps: [{ number: 1, description: 'Test step', status: 'pending' }],
        rawText: '1. Test step',
        createdAt: Date.now(),
      });
      manager.startExecution();

      expect(manager.getPromptIndicator()).toBe('[EXEC]');
    });
  });

  describe('plan management', () => {
    it('should store plan when setPlan() is called', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      const plan = {
        id: 'test-plan',
        steps: [
          { number: 1, description: 'Step 1', status: 'pending' as const },
          { number: 2, description: 'Step 2', status: 'pending' as const },
        ],
        rawText: '1. Step 1\n2. Step 2',
        createdAt: Date.now(),
      };

      manager.setPlan(plan);

      expect(manager.getPlan()).toEqual(plan);
    });

    it('should emit "plan:set" event when plan is set', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();
      const callback = vi.fn();

      manager.on('plan:set', callback);

      const plan = {
        id: 'test-plan',
        steps: [{ number: 1, description: 'Step 1', status: 'pending' as const }],
        rawText: '1. Step 1',
        createdAt: Date.now(),
      };

      manager.setPlan(plan);

      expect(callback).toHaveBeenCalledWith(plan);
    });
  });

  describe('execution phase', () => {
    it('should transition to executing phase when startExecution() is called', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();
      manager.setPlan({
        id: 'test-plan',
        steps: [{ number: 1, description: 'Step 1', status: 'pending' }],
        rawText: '1. Step 1',
        createdAt: Date.now(),
      });

      manager.startExecution();

      expect(manager.getPhase()).toBe('executing');
    });

    it('should throw error if startExecution() is called without a plan', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();

      expect(() => manager.startExecution()).toThrow('No plan to execute');
    });

    it('should emit "execution:started" event when execution begins', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();
      const callback = vi.fn();

      manager.on('execution:started', callback);
      manager.enable();
      manager.setPlan({
        id: 'test-plan',
        steps: [{ number: 1, description: 'Step 1', status: 'pending' }],
        rawText: '1. Step 1',
        createdAt: Date.now(),
      });

      manager.startExecution();

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('read-only tools', () => {
    it('should return list of read-only tools', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      const tools = manager.getReadOnlyTools();

      expect(tools).toContain('read_file');
      expect(tools).toContain('search');
      expect(tools).toContain('list_tree');
      expect(tools).toContain('git_status');
      expect(tools).toContain('git_log');
      expect(tools).toContain('web_search');
      expect(tools).toContain('fetch_url');
    });

    it('should NOT include write tools in read-only list', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      const tools = manager.getReadOnlyTools();

      expect(tools).not.toContain('write_file');
      expect(tools).not.toContain('apply_patch');
      expect(tools).not.toContain('git_commit');
    });
  });

  describe('bash command allowlist', () => {
    it('should allow read-only bash commands', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      expect(manager.isBashCommandAllowed('cat file.txt')).toBe(true);
      expect(manager.isBashCommandAllowed('grep pattern file')).toBe(true);
      expect(manager.isBashCommandAllowed('ls -la')).toBe(true);
      expect(manager.isBashCommandAllowed('git status')).toBe(true);
      expect(manager.isBashCommandAllowed('git log --oneline')).toBe(true);
    });

    it('should block write bash commands', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      expect(manager.isBashCommandAllowed('rm file.txt')).toBe(false);
      expect(manager.isBashCommandAllowed('git commit -m "test"')).toBe(false);
      expect(manager.isBashCommandAllowed('npm install express')).toBe(false);
      expect(manager.isBashCommandAllowed('git push origin main')).toBe(false);
    });

    it('should block dangerous commands', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      expect(manager.isBashCommandAllowed('sudo rm -rf /')).toBe(false);
      expect(manager.isBashCommandAllowed('kill -9 1234')).toBe(false);
      expect(manager.isBashCommandAllowed('chmod 777 file')).toBe(false);
    });
  });

  describe('plan acceptance options', () => {
    it('should accept plan with clear_context_auto_accept option', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();
      manager.setPlan({
        id: 'test-plan',
        steps: [{ number: 1, description: 'Test step', status: 'pending' }],
        rawText: '1. Test step',
        createdAt: Date.now(),
      });

      const config = manager.acceptPlan('clear_context_auto_accept');

      expect(config.clearContext).toBe(true);
      expect(config.autoAcceptEdits).toBe(true);
      expect(config.option).toBe('clear_context_auto_accept');
    });

    it('should accept plan with manual_approve option', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();
      manager.setPlan({
        id: 'test-plan',
        steps: [{ number: 1, description: 'Test step', status: 'pending' }],
        rawText: '1. Test step',
        createdAt: Date.now(),
      });

      const config = manager.acceptPlan('manual_approve');

      expect(config.clearContext).toBe(false);
      expect(config.autoAcceptEdits).toBe(false);
      expect(config.option).toBe('manual_approve');
    });

    it('should accept plan with auto_accept option (no context clear)', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();
      manager.setPlan({
        id: 'test-plan',
        steps: [{ number: 1, description: 'Test step', status: 'pending' }],
        rawText: '1. Test step',
        createdAt: Date.now(),
      });

      const config = manager.acceptPlan('auto_accept');

      expect(config.clearContext).toBe(false);
      expect(config.autoAcceptEdits).toBe(true);
      expect(config.option).toBe('auto_accept');
    });

    it('should emit "plan:accepted" event with config when plan is accepted', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();
      const callback = vi.fn();

      manager.on('plan:accepted', callback);
      manager.enable();
      manager.setPlan({
        id: 'test-plan',
        steps: [{ number: 1, description: 'Test step', status: 'pending' }],
        rawText: '1. Test step',
        createdAt: Date.now(),
      });

      manager.acceptPlan('clear_context_auto_accept');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          option: 'clear_context_auto_accept',
          clearContext: true,
          autoAcceptEdits: true,
        })
      );
    });

    it('should transition to executing phase when plan is accepted', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();
      manager.setPlan({
        id: 'test-plan',
        steps: [{ number: 1, description: 'Test step', status: 'pending' }],
        rawText: '1. Test step',
        createdAt: Date.now(),
      });

      manager.acceptPlan('auto_accept');

      expect(manager.getPhase()).toBe('executing');
    });

    it('should throw error if accepting plan without a plan', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      manager.enable();

      expect(() => manager.acceptPlan('auto_accept')).toThrow('No plan to accept');
    });

    it('should return accept options list', async () => {
      const { PlanModeManager } = await import('../../../src/modes/planMode/PlanModeManager.js');
      const manager = new PlanModeManager();

      const options = manager.getAcceptOptions();

      expect(options).toHaveLength(3);
      expect(options[0].id).toBe('clear_context_auto_accept');
      expect(options[0].label).toContain('clear context');
      expect(options[0].shortcut).toBe('shift+tab');
      expect(options[1].id).toBe('manual_approve');
      expect(options[2].id).toBe('auto_accept');
    });
  });
});
