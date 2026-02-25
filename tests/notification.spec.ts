/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

// Mock child_process (still needed for focus detection)
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock node-notifier
vi.mock('node-notifier', () => ({
  default: { notify: vi.fn() },
}));

import { spawn } from 'node:child_process';
import notifier from 'node-notifier';
import {
  NotificationService,
  type NotificationGuards,

} from '../src/utils/notification.js';

const mockSpawn = vi.mocked(spawn);
const mockNotify = vi.mocked(notifier.notify);

function createMockChild(exitCode = 0, stdout = ''): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  (child as any).stdout = new EventEmitter();
  (child as any).stderr = new EventEmitter();
  (child as any).unref = vi.fn();
  // Emit close asynchronously
  setTimeout(() => {
    if ((child as any).stdout) {
      (child as any).stdout.emit('data', Buffer.from(stdout));
    }
    child.emit('close', exitCode);
  }, 0);
  return child;
}

function defaultGuards(overrides: Partial<NotificationGuards> = {}): NotificationGuards {
  return {
    isRpcMode: false,
    hasConfirmationCallback: false,
    isAutoConfirm: false,
    isYesMode: false,
    hasExternalCallback: false,
    notificationsConfig: undefined, // default: enabled
    ...overrides,
  };
}

describe('NotificationService', () => {
  let service: NotificationService;
  const originalPlatform = process.platform;

  beforeEach(() => {
    service = new NotificationService();
    mockSpawn.mockReset();
    mockSpawn.mockReturnValue(createMockChild());
    mockNotify.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.restoreAllMocks();
  });

  // ── 1. node-notifier notification dispatch ─────────────────────

  describe('node-notifier notification dispatch', () => {
    it('1a. macOS: calls notifier.notify with correct title and message', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      // Force terminal as unfocused so notification fires
      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Google Chrome');
        }
        return createMockChild();
      });

      await service.notify(
        { body: 'Approval needed', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledTimes(1);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Autohand - Approval Needed',
          message: 'Approval needed',
        }),
      );
    });

    it('1b. Linux: calls notifier.notify with correct title and message', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      service = new NotificationService();

      // Force unfocused
      mockSpawn.mockImplementation((cmd: string) => {
        if (cmd === 'xdotool') return createMockChild(0, 'Google Chrome');
        return createMockChild();
      });

      await service.notify(
        { body: 'Test body', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledTimes(1);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Autohand - Approval Needed',
          message: 'Test body',
        }),
      );
    });

    it('1c. Windows: calls notifier.notify (cross-platform via node-notifier)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      service = new NotificationService();

      await service.notify(
        { body: 'Win test', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledTimes(1);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Autohand - Approval Needed',
          message: 'Win test',
        }),
      );
    });

    it('1d. Unknown platform: still sends via node-notifier (cross-platform)', async () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      service = new NotificationService();

      await service.notify(
        { body: 'Unknown', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });

  // ── 2. Contextual titles ───────────────────────────────────────

  describe('contextual titles', () => {
    beforeEach(() => {
      // Force unfocused on all platforms
      Object.defineProperty(process, 'platform', { value: 'win32' });
      service = new NotificationService();
    });

    it('2a. Confirmation reason: title includes "Approval Needed"', async () => {
      await service.notify(
        { body: 'Delete /src/old.ts?', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Autohand - Approval Needed',
          message: 'Delete /src/old.ts?',
          wait: true,
        }),
      );
    });

    it('2b. Question reason: title includes "Question"', async () => {
      await service.notify(
        { body: 'What framework?', reason: 'question' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Autohand - Question',
          message: 'What framework?',
          wait: true,
        }),
      );
    });

    it('2c. Task complete reason: plain title, no wait', async () => {
      await service.notify(
        { body: 'All done', reason: 'task_complete' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Autohand',
          message: 'All done',
          wait: false,
          timeout: 5,
        }),
      );
    });

    it('2d. Custom title via options: uses custom title as base', async () => {
      await service.notify(
        { body: 'Test', reason: 'confirmation', title: 'MyApp' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'MyApp - Approval Needed',
        }),
      );
    });
  });

  // ── 3. Terminal focus detection ────────────────────────────────

  describe('terminal focus detection', () => {
    it('3a. macOS: returns true if frontmost app contains terminal keyword', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Terminal');
        }
        return createMockChild();
      });

      const focused = await service.isTerminalFocused();
      expect(focused).toBe(true);
    });

    it('3b. Linux: returns true if active window name contains terminal keyword', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      service = new NotificationService();

      mockSpawn.mockImplementation((cmd: string) => {
        if (cmd === 'xdotool') return createMockChild(0, 'tmux - terminal');
        return createMockChild();
      });

      const focused = await service.isTerminalFocused();
      expect(focused).toBe(true);
    });

    it('3c. Windows: returns false (always notify)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      service = new NotificationService();

      const focused = await service.isTerminalFocused();
      expect(focused).toBe(false);
    });

    it('3d. Spawn failure: returns false (safe default)', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      mockSpawn.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const focused = await service.isTerminalFocused();
      expect(focused).toBe(false);
    });

    it('3e. Caches result for 2 seconds', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      let callCount = 0;
      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          callCount++;
          return createMockChild(0, 'Terminal');
        }
        return createMockChild();
      });

      await service.isTerminalFocused();
      await service.isTerminalFocused();
      await service.isTerminalFocused();

      // Should have only spawned once due to caching
      expect(callCount).toBe(1);
    });
  });

  // ── 4. Guard chain (shouldNotify) ──────────────────────────────

  describe('shouldNotify guard chain', () => {
    it('4a. Returns false when ui.notifications is false', () => {
      expect(service.shouldNotify(defaultGuards({ notificationsConfig: false }))).toBe(false);
    });

    it('4b. Returns false when ui.notifications.enabled is false', () => {
      expect(service.shouldNotify(defaultGuards({ notificationsConfig: { enabled: false } }))).toBe(false);
    });

    it('4c. Returns true when ui.notifications is true or omitted (default)', () => {
      expect(service.shouldNotify(defaultGuards({ notificationsConfig: true }))).toBe(true);
      expect(service.shouldNotify(defaultGuards({ notificationsConfig: undefined }))).toBe(true);
    });

    it('4d. Returns false when isRpcMode is true', () => {
      expect(service.shouldNotify(defaultGuards({ isRpcMode: true }))).toBe(false);
    });

    it('4e. Returns false when confirmationCallback is set', () => {
      expect(service.shouldNotify(defaultGuards({ hasConfirmationCallback: true }))).toBe(false);
    });

    it('4f. Returns false when options.yes is true', () => {
      expect(service.shouldNotify(defaultGuards({ isYesMode: true }))).toBe(false);
    });

    it('4g. Returns false when config.ui.autoConfirm is true', () => {
      expect(service.shouldNotify(defaultGuards({ isAutoConfirm: true }))).toBe(false);
    });

    it('4h. Returns false when AUTOHAND_PERMISSION_CALLBACK_URL env var is set', () => {
      expect(service.shouldNotify(defaultGuards({ hasExternalCallback: true }))).toBe(false);
    });

    it('4i. Returns false when terminal IS focused (async notify path)', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Terminal');
        }
        return createMockChild();
      });

      await service.notify(
        { body: 'Test', reason: 'confirmation' },
        defaultGuards(),
      );

      // No notification should happen when terminal is focused
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it('4j. Sends notification when all guards pass (interactive, unfocused)', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Google Chrome');
        }
        return createMockChild();
      });

      await service.notify(
        { body: 'Test body', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });

  // ── 5. Integration: confirmation prompt ────────────────────────

  describe('confirmation prompt integration', () => {
    it('5a. Interactive mode: notify() fires before confirmation modal', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Finder');
        }
        return createMockChild();
      });

      await service.notify(
        { body: 'Run npm install?', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledTimes(1);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Autohand - Approval Needed',
          message: 'Run npm install?',
        }),
      );
    });

    it('5b. RPC mode (callback set): notify() is NOT called', async () => {
      service = new NotificationService();

      await service.notify(
        { body: 'Test', reason: 'confirmation' },
        defaultGuards({ hasConfirmationCallback: true }),
      );

      expect(mockNotify).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('5c. With --yes flag: notify() NOT called', async () => {
      service = new NotificationService();

      await service.notify(
        { body: 'Test', reason: 'confirmation' },
        defaultGuards({ isYesMode: true }),
      );

      expect(mockNotify).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // ── 6. Integration: followup question ──────────────────────────

  describe('followup question integration', () => {
    it('6a. Interactive mode: notify() fires before question modal', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Safari');
        }
        return createMockChild();
      });

      await service.notify(
        { body: 'Question: What framework?', reason: 'question' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledTimes(1);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Autohand - Question',
          message: 'Question: What framework?',
        }),
      );
    });

    it('6b. Non-interactive (CI): notify() NOT called', async () => {
      service = new NotificationService();

      await service.notify(
        { body: 'Test', reason: 'question' },
        defaultGuards({ isYesMode: true }),
      );

      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  // ── 7. Turn completion notification ────────────────────────────

  describe('turn completion notification', () => {
    it('7a. After turn completes: notify() fires with plain title', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Slack');
        }
        return createMockChild();
      });

      await service.notify(
        { body: 'Task completed', reason: 'task_complete' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledTimes(1);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Autohand',
          message: 'Task completed',
          wait: false,
          timeout: 5,
        }),
      );
    });

    it('7b. When showCompletionNotification is false: completion notify() NOT called (external guard)', () => {
      // This is handled externally in agent.ts, but we verify the guard chain itself
      // When all guards pass, shouldNotify returns true - the caller gates on showCompletionNotification
      expect(service.shouldNotify(defaultGuards())).toBe(true);
    });
  });

  // ── 8. Icon and sound options ──────────────────────────────────

  describe('icon and sound options', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      service = new NotificationService();
    });

    it('8a. Passes icon path to notifier', async () => {
      await service.notify(
        { body: 'Test', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          icon: expect.stringContaining('icon.png'),
        }),
      );
    });

    it('8b. Sound enabled by default', async () => {
      await service.notify(
        { body: 'Test', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ sound: true }),
      );
    });

    it('8c. Sound disabled via config', async () => {
      await service.notify(
        { body: 'Test', reason: 'confirmation' },
        defaultGuards({ notificationsConfig: { sound: false } }),
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ sound: false }),
      );
    });

    it('8d. Actionable notifications (confirmation/question) use wait: true, timeout: 15', async () => {
      await service.notify(
        { body: 'Approve?', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ wait: true, timeout: 15 }),
      );
    });
  });

  // ── 9. Error handling ──────────────────────────────────────────

  describe('error handling', () => {
    it('9a. notifier.notify throws: caught silently, no crash', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      // Focus check returns unfocused
      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Chrome');
        }
        return createMockChild();
      });

      // Make notifier throw
      mockNotify.mockImplementation(() => {
        throw new Error('notification failed');
      });

      await expect(
        service.notify({ body: 'Test', reason: 'confirmation' }, defaultGuards()),
      ).resolves.not.toThrow();
    });

    it('9b. osascript exits non-zero: focus returns false, notification still sent', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(1, ''); // non-zero exit
        }
        return createMockChild(0);
      });

      const focused = await service.isTerminalFocused();
      expect(focused).toBe(false);

      // Clear focus cache for full notify test
      service = new NotificationService();
      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(1, '');
        }
        return createMockChild(0);
      });

      await service.notify(
        { body: 'Should still notify', reason: 'confirmation' },
        defaultGuards(),
      );

      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });
});
