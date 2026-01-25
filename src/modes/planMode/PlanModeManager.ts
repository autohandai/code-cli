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
  'web_repo',
  // Memory
  'recall_memory',
  // Meta
  'tools_registry',
  'plan',
  'ask_followup_question',
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
   * Get i18n key for status description based on current phase
   */
  getStatusDescriptionKey(): string {
    if (!this.state.enabled) {
      return '';
    }

    if (this.state.phase === 'executing') {
      return 'ui.planModeExecuting';
    }

    return 'ui.planModeActive';
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
