/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Plan Mode Types
 */

/**
 * Status of a plan step
 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/**
 * Phase of plan mode
 */
export type PlanPhase = 'planning' | 'executing' | 'completed';

/**
 * A single step in a plan
 */
export interface PlanStep {
  number: number;
  description: string;
  status: PlanStepStatus;
  completedAt?: number;
  output?: string;
}

/**
 * A complete plan with steps
 */
export interface Plan {
  id: string;
  steps: PlanStep[];
  rawText: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * State of plan mode
 */
export interface PlanModeState {
  enabled: boolean;
  phase: PlanPhase;
  plan: Plan | null;
  startedAt: number;
  executionStartedAt?: number;
}

/**
 * Progress information
 */
export interface PlanProgress {
  current: number;
  total: number;
  percentage: number;
}

/**
 * Options for accepting a plan
 */
export type PlanAcceptOption =
  | 'clear_context_auto_accept'  // Clear context and auto-accept edits (Shift+Tab)
  | 'manual_approve'             // Manually approve each edit
  | 'auto_accept';               // Auto-accept edits without clearing context

/**
 * Configuration for plan execution after acceptance
 */
export interface PlanAcceptConfig {
  option: PlanAcceptOption;
  clearContext: boolean;
  autoAcceptEdits: boolean;
}
