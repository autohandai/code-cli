/**
 * YOLO Mode - Granular Auto-Approve with Timeout
 *
 * Provides pattern-based tool allow/deny and time-bounded auto-approve.
 *
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PermissionSettings } from './types.js';

// ============================================================================
// Types
// ============================================================================

/** Parsed YOLO pattern describing which tools are auto-approved */
export interface YoloPattern {
  mode: 'allow' | 'deny';
  tools: string[];
}

const DEFAULT_YOLO_FILE_TOOLS = [
  'read_file',
  'write_file',
  'multi_file_edit',
  'list_dir',
  'file_search',
  'grep_search',
  'move_path',
  'copy_path',
];

export function getDefaultYoloPattern(): string {
  return `allow:${DEFAULT_YOLO_FILE_TOOLS.join(',')}`;
}

export function normalizeYoloInput(pattern: string | boolean | undefined): string | undefined {
  if (pattern === undefined || pattern === false) {
    return undefined;
  }

  if (pattern === true) {
    return getDefaultYoloPattern();
  }

  const trimmed = pattern.trim();
  return trimmed.length > 0 ? trimmed : getDefaultYoloPattern();
}

// ============================================================================
// Pattern Parsing
// ============================================================================

/**
 * Parse a YOLO pattern string into a structured YoloPattern.
 *
 * Supported formats:
 *   - 'allow:*'                  → allow all tools
 *   - 'allow:read,write,search'  → allow only listed tools
 *   - 'deny:delete,run_command'  → deny only listed tools, allow rest
 *   - 'true'                     → shorthand for allow:*
 *
 * @throws Error if the pattern is empty or malformed
 */
export function parseYoloPattern(pattern: string): YoloPattern {
  const trimmed = pattern.trim();

  if (trimmed.length === 0) {
    throw new Error('YOLO pattern cannot be empty');
  }

  // Boolean shorthand
  if (trimmed === 'true') {
    return { mode: 'allow', tools: ['*'] };
  }

  // Structured pattern: mode:tool1,tool2,...
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(
      `Invalid YOLO pattern "${pattern}". Expected format: allow:<tools> or deny:<tools>`
    );
  }

  const mode = trimmed.slice(0, colonIndex).trim().toLowerCase();
  const toolsPart = trimmed.slice(colonIndex + 1);

  if (mode !== 'allow' && mode !== 'deny') {
    throw new Error(
      `Invalid YOLO mode "${mode}". Must be "allow" or "deny".`
    );
  }

  const tools = toolsPart
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tools.length === 0) {
    throw new Error('YOLO pattern must specify at least one tool');
  }

  return { mode, tools };
}

// ============================================================================
// Tool Authorization
// ============================================================================

/**
 * Check whether a tool is allowed under the given YOLO pattern.
 *
 * - allow:*         → allows everything
 * - allow:specific  → allows only listed tools, denies rest
 * - deny:specific   → denies only listed tools, allows rest
 * - deny:*          → denies everything
 */
export function isToolAllowedByYolo(
  toolName: string,
  pattern: YoloPattern
): boolean {
  const isWildcard = pattern.tools.includes('*');
  const isListed = pattern.tools.includes(toolName);

  if (pattern.mode === 'allow') {
    return isWildcard || isListed;
  }

  // deny mode
  if (isWildcard) {
    return false;
  }
  return !isListed;
}

export function buildPermissionSettingsFromYolo(pattern: YoloPattern): Partial<PermissionSettings> {
  if (pattern.mode === 'allow' && pattern.tools.includes('*')) {
    return { mode: 'unrestricted' };
  }

  if (pattern.mode === 'allow') {
    const allowPatterns = pattern.tools.map((tool) => ({ kind: tool }));
    const fileTools = new Set(DEFAULT_YOLO_FILE_TOOLS);
    const allRequestedToolsAreFileTools = pattern.tools.every((tool) => fileTools.has(tool));

    return {
      allowPatterns,
      allPathsAllowed: allRequestedToolsAreFileTools,
    };
  }

  return {
    denyPatterns: pattern.tools.map((tool) => ({ kind: tool })),
  };
}

// ============================================================================
// Timer
// ============================================================================

/**
 * Time-bounded auto-approve timer.
 *
 * Once the timeout expires, `isActive()` returns false and callers should
 * fall back to normal permission prompting.
 */
export class YoloTimer {
  private readonly startTime: number;
  private readonly durationMs: number;

  constructor(timeoutSeconds: number) {
    this.startTime = Date.now();
    this.durationMs = timeoutSeconds * 1000;
  }

  /** Whether the timer is still active (within the timeout window). */
  isActive(): boolean {
    if (this.durationMs <= 0) {
      return false;
    }
    return Date.now() - this.startTime < this.durationMs;
  }

  /** Seconds remaining before the timer expires (minimum 0). */
  remainingSeconds(): number {
    if (this.durationMs <= 0) {
      return 0;
    }
    const elapsed = Date.now() - this.startTime;
    const remaining = Math.max(0, this.durationMs - elapsed);
    return Math.ceil(remaining / 1000);
  }
}
