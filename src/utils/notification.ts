/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import type { NotificationConfig } from '../types.js';

export interface NotificationGuards {
  isRpcMode: boolean;
  hasConfirmationCallback: boolean;
  isAutoConfirm: boolean;
  isYesMode: boolean;
  hasExternalCallback: boolean;
  notificationsConfig: boolean | NotificationConfig | undefined;
}

export interface NotificationOptions {
  body: string;
  reason: 'confirmation' | 'question' | 'task_complete';
  title?: string;
}

const TERMINAL_KEYWORDS = [
  'terminal', 'iterm', 'alacritty', 'kitty', 'wezterm', 'hyper',
  'warp', 'tmux', 'screen', 'konsole', 'gnome-terminal', 'xterm',
  'rxvt', 'st ', 'foot', 'ghostty',
];

const FOCUS_CACHE_TTL_MS = 2000;

export class NotificationService {
  private focusCache: { value: boolean; timestamp: number } | null = null;

  /**
   * Pure synchronous guard check. Returns false if notifications should be suppressed.
   */
  shouldNotify(guards: NotificationGuards): boolean {
    const { notificationsConfig } = guards;

    // Explicit disable via boolean false
    if (notificationsConfig === false) return false;

    // Explicit disable via config object
    if (typeof notificationsConfig === 'object' && notificationsConfig?.enabled === false) return false;

    // RPC / ACP / external callback modes have their own notification systems
    if (guards.isRpcMode) return false;
    if (guards.hasConfirmationCallback) return false;
    if (guards.hasExternalCallback) return false;

    // Auto-confirm modes don't wait for user, no need to notify
    if (guards.isYesMode) return false;
    if (guards.isAutoConfirm) return false;

    return true;
  }

  /**
   * Main entry: check guards, check focus, send notification if warranted.
   */
  async notify(options: NotificationOptions, guards: NotificationGuards): Promise<void> {
    if (!this.shouldNotify(guards)) return;

    // Check if terminal is focused - skip notification if user is already looking
    const focused = await this.isTerminalFocused();
    if (focused) return;

    const config = typeof guards.notificationsConfig === 'object' ? guards.notificationsConfig : {};
    const title = options.title ?? config.title ?? 'Autohand';
    const sound = config.sound !== false; // default: true

    try {
      this.sendNotification(title, options.body, sound);
    } catch {
      // Notifications must never crash the app
    }
  }

  /**
   * Detect whether the terminal window is currently focused.
   * Uses a 2-second cache to avoid excessive OS calls.
   */
  async isTerminalFocused(): Promise<boolean> {
    // Check cache
    if (this.focusCache && Date.now() - this.focusCache.timestamp < FOCUS_CACHE_TTL_MS) {
      return this.focusCache.value;
    }

    const platform = process.platform;
    let result = false;

    try {
      if (platform === 'darwin') {
        result = await this.checkMacFocus();
      } else if (platform === 'linux') {
        result = await this.checkLinuxFocus();
      } else {
        // Windows and unknown: return false (always notify)
        result = false;
      }
    } catch {
      // Spawn failure: safe default - assume unfocused so we notify
      result = false;
    }

    this.focusCache = { value: result, timestamp: Date.now() };
    return result;
  }

  // ── Private: platform focus checks ─────────────────────────────

  private checkMacFocus(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const script = 'tell application "System Events" to get name of first application process whose frontmost is true';
        const child = spawn('osascript', ['-e', script]);
        let stdout = '';

        child.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        child.on('close', (code) => {
          if (code !== 0) {
            resolve(false);
            return;
          }
          const appName = stdout.trim().toLowerCase();
          resolve(TERMINAL_KEYWORDS.some((kw) => appName.includes(kw)));
        });

        child.on('error', () => resolve(false));
      } catch {
        resolve(false);
      }
    });
  }

  private checkLinuxFocus(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const child = spawn('xdotool', ['getactivewindow', 'getwindowname']);
        let stdout = '';

        child.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        child.on('close', (code) => {
          if (code !== 0) {
            resolve(false);
            return;
          }
          const windowName = stdout.trim().toLowerCase();
          resolve(TERMINAL_KEYWORDS.some((kw) => windowName.includes(kw)));
        });

        child.on('error', () => resolve(false));
      } catch {
        resolve(false);
      }
    });
  }

  // ── Private: platform notification dispatch ────────────────────

  private sendNotification(title: string, body: string, sound: boolean): void {
    const platform = process.platform;

    if (platform === 'darwin') {
      this.sendMacNotification(title, body, sound);
    } else if (platform === 'linux') {
      this.sendLinuxNotification(title, body);
    } else if (platform === 'win32') {
      this.sendWindowsNotification(title, body);
    }
    // Unknown platforms: no-op
  }

  private sendMacNotification(title: string, body: string, sound: boolean): void {
    const escapedBody = body.replace(/"/g, '\\"');
    const escapedTitle = title.replace(/"/g, '\\"');
    let script = `display notification "${escapedBody}" with title "${escapedTitle}"`;
    if (sound) {
      script += ' sound name "Glass"';
    }

    const child = spawn('osascript', ['-e', script], { stdio: 'ignore' });
    child.unref();
  }

  private sendLinuxNotification(title: string, body: string): void {
    const child = spawn('notify-send', ['--app-name=Autohand', '--urgency=normal', title, body], {
      stdio: 'ignore',
    });
    child.unref();
  }

  private sendWindowsNotification(title: string, body: string): void {
    const escapedBody = body.replace(/'/g, "''");
    const escapedTitle = title.replace(/'/g, "''");
    const script = `
      [void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');
      $n = New-Object System.Windows.Forms.NotifyIcon;
      $n.Icon = [System.Drawing.SystemIcons]::Information;
      $n.Visible = $true;
      $n.ShowBalloonTip(5000, '${escapedTitle}', '${escapedBody}', 'Info');
      Start-Sleep -Seconds 6;
      $n.Dispose();
    `.trim();

    const child = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
    child.unref();
  }
}
