/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Plan Mode Manager
 * Central coordinator for plan mode state and operations
 */

import { EventEmitter } from 'node:events';
import type { Plan, PlanModeState, PlanPhase, PlanAcceptOption, PlanAcceptConfig } from './types.js';

/**
 * Bash commands allowed in plan mode (read-only operations)
 */
const BASH_ALLOWLIST: Record<string, string[]> = {
  fileInspection: ['cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat'],
  search: ['grep', 'rg', 'ripgrep', 'ag', 'ack', 'find', 'fd'],
  directory: ['ls', 'pwd', 'tree', 'du', 'df'],
  gitRead: ['git status', 'git log', 'git diff', 'git show', 'git branch', 'git blame', 'git remote'],
  packageInfo: ['npm list', 'npm outdated', 'npm view', 'yarn list', 'yarn info', 'pnpm list', 'bun pm ls'],
  systemInfo: ['uname', 'whoami', 'date', 'uptime', 'env', 'which', 'type'],
  textProcessing: ['sort', 'uniq', 'diff', 'jq', 'yq'],
};

/**
 * Bash commands blocked in plan mode (write/dangerous operations)
 */
const BASH_BLOCKLIST = [
  'rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'ln',
  'git add', 'git commit', 'git push', 'git pull', 'git merge', 'git rebase', 'git reset', 'git checkout', 'git stash',
  'npm install', 'npm i ', 'npm ci', 'npm update', 'npm uninstall', 'npm link', 'npm publish',
  'yarn add', 'yarn remove', 'yarn install',
  'pnpm add', 'pnpm remove', 'pnpm install',
  'bun add', 'bun remove', 'bun install',
  'pip install', 'pip3 install', 'cargo install',
  'sudo', 'su', 'kill', 'killall', 'reboot', 'shutdown',
  'vim', 'vi', 'nano', 'emacs', 'code',
  'curl -X POST', 'curl -X PUT', 'curl -X DELETE', 'curl -d', 'curl --data',
  'wget',
];

/**
 * Tools that are read-only and allowed in plan mode
 */
const READ_ONLY_TOOLS = [
  // File reading
  'read_file',
  'search',
  'search_with_context',
  'semantic_search',
  'list_tree',
  'file_stats',
  'checksum',
  // Git read operations
  'git_status',
  'git_diff',
  'git_diff_range',
  'git_log',
  'git_branch',
  'git_stash_list',
  'git_worktree_list',
  'git_worktree_status_all',
  // Web/Research
  'web_search',
  'fetch_url',
  'package_info',
  // Memory
  'recall_memory',
  // Meta
  'tools_registry',
  'plan',
  'ask_followup_question',
  // Bash (filtered via allowlist)
  'run_command',
];

/**
 * PlanModeManager - manages plan mode state and behavior
 */
export class PlanModeManager extends EventEmitter {
  private state: PlanModeState;

  constructor() {
    super();
    this.state = {
      enabled: false,
      phase: 'planning',
      plan: null,
      startedAt: 0,
    };
  }

  /**
   * Check if plan mode is enabled
   */
  isEnabled(): boolean {
    return this.state.enabled;
  }

  /**
   * Get current phase
   */
  getPhase(): PlanPhase {
    return this.state.phase;
  }

  /**
   * Get current plan
   */
  getPlan(): Plan | null {
    return this.state.plan;
  }

  /**
   * Enable plan mode
   */
  enable(): void {
    if (this.state.enabled) return;

    this.state.enabled = true;
    this.state.phase = 'planning';
    this.state.startedAt = Date.now();
    this.emit('enabled');
  }

  /**
   * Disable plan mode
   */
  disable(): void {
    if (!this.state.enabled) return;

    this.state.enabled = false;
    this.emit('disabled');
  }

  /**
   * Toggle plan mode on/off
   */
  toggle(): void {
    if (this.state.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  /**
   * Handle Shift+Tab keypress - simple toggle on/off
   */
  handleShiftTab(): void {
    this.toggle();
  }

  /**
   * Get prompt indicator based on current state
   */
  getPromptIndicator(): string {
    if (!this.state.enabled) {
      return '';
    }

    if (this.state.phase === 'executing') {
      return '[EXEC]';
    }

    return '[PLAN]';
  }

  /**
   * Set the current plan
   */
  setPlan(plan: Plan): void {
    this.state.plan = plan;
    this.emit('plan:set', plan);
  }

  /**
   * Start plan execution
   * Transitions from planning to executing phase
   */
  startExecution(): void {
    if (!this.state.plan) {
      throw new Error('No plan to execute');
    }

    this.state.phase = 'executing';
    this.state.executionStartedAt = Date.now();
    this.emit('execution:started', this.state.plan);
  }

  /**
   * Get list of read-only tools allowed in plan mode
   */
  getReadOnlyTools(): string[] {
    return [...READ_ONLY_TOOLS];
  }

  /**
   * Check if a bash command is allowed in plan mode
   */
  isBashCommandAllowed(command: string): boolean {
    const normalized = command.toLowerCase().trim();

    // Check blocklist first (higher priority)
    for (const blocked of BASH_BLOCKLIST) {
      if (normalized.startsWith(blocked.toLowerCase())) {
        return false;
      }
    }

    // Check allowlist
    for (const category of Object.values(BASH_ALLOWLIST)) {
      for (const allowed of category) {
        if (normalized.startsWith(allowed.toLowerCase())) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get current state (for persistence/debugging)
   */
  getState(): PlanModeState {
    return { ...this.state };
  }

  /**
   * Restore state from persistence
   */
  restore(state: Partial<PlanModeState>): void {
    this.state = {
      ...this.state,
      ...state,
    };

    if (this.state.enabled) {
      this.emit('restored', this.state);
    }
  }

  /**
   * Accept the plan with specified option
   * This starts execution with the given configuration
   *
   * Options:
   * - clear_context_auto_accept: Clear context and auto-accept edits (best for plan adherence)
   * - manual_approve: Manually approve each edit
   * - auto_accept: Auto-accept edits without clearing context
   */
  acceptPlan(option: PlanAcceptOption): PlanAcceptConfig {
    if (!this.state.plan) {
      throw new Error('No plan to accept');
    }

    const config: PlanAcceptConfig = {
      option,
      clearContext: option === 'clear_context_auto_accept',
      autoAcceptEdits: option !== 'manual_approve',
    };

    // Transition to executing phase
    this.state.phase = 'executing';
    this.state.executionStartedAt = Date.now();

    this.emit('plan:accepted', config);
    this.emit('execution:started', this.state.plan);

    return config;
  }

  /**
   * Get available plan acceptance options for UI display
   */
  getAcceptOptions(): Array<{ id: PlanAcceptOption; label: string; description: string; shortcut?: string }> {
    return [
      {
        id: 'clear_context_auto_accept',
        label: 'Yes, clear context and auto-accept edits',
        description: 'Clears context for fresh start, improves plan adherence. Auto-accepts all edits.',
        shortcut: 'shift+tab',
      },
      {
        id: 'manual_approve',
        label: 'Yes, and manually approve edits',
        description: 'Keep context, review and approve each edit individually.',
      },
      {
        id: 'auto_accept',
        label: 'Yes, auto-accept edits',
        description: 'Keep context, auto-accept all edits without review.',
      },
    ];
  }
}
