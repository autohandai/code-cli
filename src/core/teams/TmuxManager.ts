/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Manages tmux split-pane integration for agent teams.
 *
 * When autohand runs inside tmux, each teammate can be displayed in its own
 * tmux pane. The lead process occupies the main pane; teammates are spawned
 * in split panes created by this manager.
 */
export class TmuxManager {
  private paneIds: Map<string, string> = new Map();

  /**
   * Check if the current session is running inside tmux.
   */
  static isInTmux(): boolean {
    return !!process.env.TMUX;
  }

  /**
   * Detect the display mode: 'tmux' if inside tmux, 'in-process' otherwise.
   * Can be overridden by explicit user preference.
   */
  static detectDisplayMode(preference?: 'auto' | 'in-process' | 'tmux'): 'tmux' | 'in-process' {
    if (preference === 'tmux') return 'tmux';
    if (preference === 'in-process') return 'in-process';
    // auto: use tmux if available
    return TmuxManager.isInTmux() ? 'tmux' : 'in-process';
  }

  /**
   * Create a new tmux split pane for a teammate and run the given command in it.
   * Returns the pane ID for later management.
   *
   * @param name - Human-readable name for the pane (used as label)
   * @param command - Full command to run in the new pane
   * @param orientation - Split direction: 'horizontal' (side by side) or 'vertical' (stacked)
   */
  async createPane(
    name: string,
    command: string,
    orientation: 'horizontal' | 'vertical' = 'horizontal',
  ): Promise<string> {
    const splitFlag = orientation === 'horizontal' ? '-h' : '-v';

    try {
      const { stdout } = await execFileAsync('tmux', [
        'split-window', splitFlag, '-P', '-F', '#{pane_id}', command,
      ]);
      const paneId = stdout.trim();
      this.paneIds.set(name, paneId);

      // Set pane title for identification
      await execFileAsync('tmux', [
        'select-pane', '-t', paneId, '-T', name,
      ]).catch(() => {
        // Older tmux versions may not support -T
      });

      return paneId;
    } catch (err) {
      throw new Error(`Failed to create tmux pane for "${name}": ${(err as Error).message}`);
    }
  }

  /**
   * Close a teammate's tmux pane.
   */
  async closePane(name: string): Promise<void> {
    const paneId = this.paneIds.get(name);
    if (!paneId) return;

    try {
      await execFileAsync('tmux', ['kill-pane', '-t', paneId]);
    } catch {
      // Pane may already be closed
    }
    this.paneIds.delete(name);
  }

  /**
   * Close all managed panes.
   */
  async closeAllPanes(): Promise<void> {
    for (const [name] of this.paneIds) {
      await this.closePane(name);
    }
  }

  /**
   * Get the pane ID for a named teammate.
   */
  getPaneId(name: string): string | undefined {
    return this.paneIds.get(name);
  }

  /**
   * Get all managed pane names.
   */
  getManagedPanes(): string[] {
    return [...this.paneIds.keys()];
  }
}
