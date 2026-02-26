/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import notifier from 'node-notifier';
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

// Resolve icon path once at module level.
// In dev (src/utils/) the icon is at ../../assets/icon.png;
// in prod (dist/) it's at ../assets/icon.png (shipped in package).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_ICON = path.resolve(__dirname, '../../assets/icon.png');
const PROD_ICON = path.resolve(__dirname, '../assets/icon.png');
const ICON_PATH = existsSync(DEV_ICON) ? DEV_ICON : PROD_ICON;

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
      this.sendNotification(title, options.body, sound, options.reason);
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

  // ── Private: notification dispatch via node-notifier ────────────

  private sendNotification(title: string, body: string, sound: boolean, reason: NotificationOptions['reason']): void {
    const contextTitle = reason === 'confirmation'
      ? `${title} - Approval Needed`
      : reason === 'question'
        ? `${title} - Question`
        : title; // task_complete keeps plain title

    notifier.notify({
      title: contextTitle,
      message: body,
      icon: ICON_PATH,
      sound,
      wait: reason !== 'task_complete',
      timeout: reason === 'task_complete' ? 5 : 15,
    });
  }
}
