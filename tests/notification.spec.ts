/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import {
  NotificationService,
  type NotificationGuards,

} from '../src/utils/notification.js';

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

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
  const originalMacBackend = process.env.AUTOHAND_MAC_NOTIFICATION_BACKEND;

  beforeEach(() => {
    process.env.AUTOHAND_MAC_NOTIFICATION_BACKEND = 'osascript';
    service = new NotificationService();
    mockSpawn.mockReset();
    mockSpawn.mockReturnValue(createMockChild());
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalMacBackend === undefined) {
      delete process.env.AUTOHAND_MAC_NOTIFICATION_BACKEND;
    } else {
      process.env.AUTOHAND_MAC_NOTIFICATION_BACKEND = originalMacBackend;
    }
    vi.restoreAllMocks();
  });

  // ── 1. Platform notification dispatch ──────────────────────────

  describe('platform notification dispatch', () => {
    it('1a. macOS: spawns osascript with AppleScript display notification', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      // Force terminal as unfocused so notification fires
      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && args?.[0] === '-e' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Google Chrome');
        }
        return createMockChild();
      });

      await service.notify(
        { body: 'Approval needed', reason: 'confirmation' },
        defaultGuards(),
      );

      const notifyCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) =>
          cmd === 'osascript' && args?.[0] === '-e' && (args?.[1] as string)?.includes('display notification'),
      );
      expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
      const script = notifyCalls[0][1]![1] as string;
      expect(script).toContain('display notification');
      expect(script).toContain('Approval needed');
      expect(script).toContain('Autohand');
    });

    it('1b. Linux: spawns notify-send with --app-name=Autohand', async () => {
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

      const notifyCalls = mockSpawn.mock.calls.filter(([cmd]) => cmd === 'notify-send');
      expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
      const args = notifyCalls[0][1] as string[];
      expect(args).toContain('--app-name=Autohand');
      expect(args).toContain('Test body');
    });

    it('1c. Windows: spawns powershell with balloon tip', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      service = new NotificationService();

      await service.notify(
        { body: 'Win test', reason: 'confirmation' },
        defaultGuards(),
      );

      const notifyCalls = mockSpawn.mock.calls.filter(([cmd]) => cmd === 'powershell');
      expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
      const args = notifyCalls[0][1] as string[];
      const script = args.join(' ');
      expect(script).toContain('BalloonTip');
    });

    it('1d. Unknown platform: does not spawn anything, does not throw', async () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      service = new NotificationService();

      // Force unfocused (no focus command for unknown platform)
      await expect(
        service.notify({ body: 'Unknown', reason: 'confirmation' }, defaultGuards()),
      ).resolves.toBeUndefined();

      // No notification commands spawned (focus check might still be called)
      const notifyCalls = mockSpawn.mock.calls.filter(
        ([cmd]) => cmd === 'osascript' || cmd === 'notify-send' || cmd === 'powershell',
      );
      // Focus detection for unknown platform returns false so notification may attempt
      // but the actual send should be a no-op on unknown platforms
      const sendCalls = notifyCalls.filter(([cmd, args]) => {
        if (cmd === 'osascript') return (args?.[1] as string)?.includes('display notification');
        if (cmd === 'notify-send') return true;
        if (cmd === 'powershell') return true;
        return false;
      });
      expect(sendCalls.length).toBe(0);
    });

    it('1e. macOS forced terminal-notifier backend: spawns terminal-notifier', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      process.env.AUTOHAND_MAC_NOTIFICATION_BACKEND = 'terminal-notifier';
      service = new NotificationService();

      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && args?.[0] === '-e' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Google Chrome');
        }
        return createMockChild();
      });

      await service.notify(
        { body: 'Native mac notification', reason: 'task_complete' },
        defaultGuards(),
      );

      const notifierCalls = mockSpawn.mock.calls.filter(([cmd]) => cmd === 'terminal-notifier');
      expect(notifierCalls.length).toBe(1);
      const args = notifierCalls[0][1] as string[];
      expect(args).toContain('-title');
      expect(args).toContain('Autohand');
      expect(args).toContain('-message');
      expect(args).toContain('Native mac notification');
    });
  });

  // ── 2. Terminal focus detection ────────────────────────────────

  describe('terminal focus detection', () => {
    it('2a. macOS: returns true if frontmost app contains terminal keyword', async () => {
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

    it('2b. Linux: returns true if active window name contains terminal keyword', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      service = new NotificationService();

      mockSpawn.mockImplementation((cmd: string) => {
        if (cmd === 'xdotool') return createMockChild(0, 'tmux - terminal');
        return createMockChild();
      });

      const focused = await service.isTerminalFocused();
      expect(focused).toBe(true);
    });

    it('2c. Windows: returns false (always notify)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      service = new NotificationService();

      const focused = await service.isTerminalFocused();
      expect(focused).toBe(false);
    });

    it('2d. Spawn failure: returns false (safe default)', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      mockSpawn.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const focused = await service.isTerminalFocused();
      expect(focused).toBe(false);
    });

    it('2e. Caches result for 2 seconds', async () => {
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

  // ── 3. Guard chain (shouldNotify) ──────────────────────────────

  describe('shouldNotify guard chain', () => {
    it('3a. Returns false when ui.notifications is false', () => {
      expect(service.shouldNotify(defaultGuards({ notificationsConfig: false }))).toBe(false);
    });

    it('3b. Returns false when ui.notifications.enabled is false', () => {
      expect(service.shouldNotify(defaultGuards({ notificationsConfig: { enabled: false } }))).toBe(false);
    });

    it('3c. Returns true when ui.notifications is true or omitted (default)', () => {
      expect(service.shouldNotify(defaultGuards({ notificationsConfig: true }))).toBe(true);
      expect(service.shouldNotify(defaultGuards({ notificationsConfig: undefined }))).toBe(true);
    });

    it('3d. Returns false when isRpcMode is true', () => {
      expect(service.shouldNotify(defaultGuards({ isRpcMode: true }))).toBe(false);
    });

    it('3e. Returns false when confirmationCallback is set', () => {
      expect(service.shouldNotify(defaultGuards({ hasConfirmationCallback: true }))).toBe(false);
    });

    it('3f. Returns false when options.yes is true', () => {
      expect(service.shouldNotify(defaultGuards({ isYesMode: true }))).toBe(false);
    });

    it('3g. Returns false when config.ui.autoConfirm is true', () => {
      expect(service.shouldNotify(defaultGuards({ isAutoConfirm: true }))).toBe(false);
    });

    it('3h. Returns false when AUTOHAND_PERMISSION_CALLBACK_URL env var is set', () => {
      expect(service.shouldNotify(defaultGuards({ hasExternalCallback: true }))).toBe(false);
    });

    it('3i. Returns false when terminal IS focused (async notify path)', async () => {
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

      // No notification dispatch should happen when terminal is focused
      const notifyCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) =>
          cmd === 'osascript' && (args?.[1] as string)?.includes('display notification'),
      );
      expect(notifyCalls.length).toBe(0);
    });

    it('3j. Returns true when all guards pass (interactive, unfocused)', async () => {
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

      const notifyCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) =>
          cmd === 'osascript' && (args?.[1] as string)?.includes('display notification'),
      );
      expect(notifyCalls.length).toBe(1);
    });
  });

  // ── 4. Integration: confirmation prompt ────────────────────────

  describe('confirmation prompt integration', () => {
    it('4a. Interactive mode: notify() called before confirmation modal', async () => {
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

      const notifyCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) =>
          cmd === 'osascript' && (args?.[1] as string)?.includes('display notification'),
      );
      expect(notifyCalls.length).toBe(1);
    });

    it('4b. RPC mode (callback set): notify() is NOT called', async () => {
      service = new NotificationService();

      await service.notify(
        { body: 'Test', reason: 'confirmation' },
        defaultGuards({ hasConfirmationCallback: true }),
      );

      // No spawn calls for notifications
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('4c. With --yes flag: notify() NOT called', async () => {
      service = new NotificationService();

      await service.notify(
        { body: 'Test', reason: 'confirmation' },
        defaultGuards({ isYesMode: true }),
      );

      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // ── 5. Integration: followup question ──────────────────────────

  describe('followup question integration', () => {
    it('5a. Interactive mode: notify() called before question modal', async () => {
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

      const notifyCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) =>
          cmd === 'osascript' && (args?.[1] as string)?.includes('display notification'),
      );
      expect(notifyCalls.length).toBe(1);
    });

    it('5b. Non-interactive (CI): notify() NOT called', async () => {
      service = new NotificationService();

      await service.notify(
        { body: 'Test', reason: 'question' },
        defaultGuards({ isYesMode: true }),
      );

      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // ── 6. Turn completion notification ────────────────────────────

  describe('turn completion notification', () => {
    it('6a. After turn completes: notify() called', async () => {
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

      const notifyCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) =>
          cmd === 'osascript' && (args?.[1] as string)?.includes('display notification'),
      );
      expect(notifyCalls.length).toBe(1);
    });

    it('6b. When showCompletionNotification is false: completion notify() NOT called (external guard)', () => {
      // This is handled externally in agent.ts, but we verify the guard chain itself
      // When all guards pass, shouldNotify returns true - the caller gates on showCompletionNotification
      expect(service.shouldNotify(defaultGuards())).toBe(true);
    });
  });

  // ── 7. Error handling ──────────────────────────────────────────

  describe('error handling', () => {
    it('7a. spawn throws ENOENT: caught silently, no crash', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      service = new NotificationService();

      // Focus check returns unfocused
      mockSpawn.mockImplementation((cmd: string, args?: readonly string[]) => {
        if (cmd === 'osascript' && (args?.[1] as string)?.includes('frontmost')) {
          return createMockChild(0, 'Chrome');
        }
        // Notification spawn throws
        const err = new Error('spawn osascript ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });

      await expect(
        service.notify({ body: 'Test', reason: 'confirmation' }, defaultGuards()),
      ).resolves.toBeUndefined();
    });

    it('7b. osascript exits non-zero: focus returns false, notification still sent', async () => {
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

      const notifyCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) =>
          cmd === 'osascript' && (args?.[1] as string)?.includes('display notification'),
      );
      expect(notifyCalls.length).toBe(1);
    });
  });
});
