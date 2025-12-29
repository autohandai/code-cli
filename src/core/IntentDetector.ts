/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getTheme, isThemeInitialized } from '../ui/theme/index.js';

/**
 * User intent classification
 */
export type Intent = 'diagnostic' | 'implementation';

/**
 * Result of intent detection
 */
export interface IntentResult {
  intent: Intent;
  confidence: number; // 0-1 score
  keywords: string[]; // Matched keywords
  reason: string; // Human-readable explanation
}

/**
 * Tool permissions based on intent
 */
export interface ToolPermissions {
  allowFileEdits: boolean;
  allowCommands: 'all' | 'readonly' | 'none';
  allowGitOperations: boolean;
}

/**
 * Keyword weights for scoring
 */
interface KeywordConfig {
  pattern: string;
  weight: number;
}

/**
 * Classifies user instructions as DIAGNOSTIC (read-only) or IMPLEMENTATION (modifying).
 * Used to determine if bootstrap is needed and which tools are allowed.
 */
export class IntentDetector {
  private implKeywords: KeywordConfig[] = [
    // Strong action verbs (weight 3)
    { pattern: 'fix', weight: 3 },
    { pattern: 'add', weight: 3 },
    { pattern: 'create', weight: 3 },
    { pattern: 'implement', weight: 3 },
    { pattern: 'update', weight: 2 },
    { pattern: 'change', weight: 2 },
    { pattern: 'modify', weight: 2 },
    { pattern: 'refactor', weight: 2 },
    { pattern: 'delete', weight: 3 },
    { pattern: 'remove', weight: 2 },
    { pattern: 'write', weight: 2 },
    { pattern: 'build', weight: 2 },
    { pattern: 'install', weight: 2 },
    { pattern: 'upgrade', weight: 2 },
    { pattern: 'migrate', weight: 2 },
    { pattern: 'convert', weight: 2 },
    { pattern: 'replace', weight: 2 },
    { pattern: 'rename', weight: 2 },
    { pattern: 'move', weight: 2 },
    { pattern: 'copy', weight: 1 },
    { pattern: 'merge', weight: 2 },
    { pattern: 'split', weight: 2 },
    { pattern: 'run', weight: 2 },
    // Imperative phrases (weight 2)
    { pattern: 'make it', weight: 2 },
    { pattern: 'set up', weight: 2 },
    { pattern: 'configure', weight: 2 },
    { pattern: 'enable', weight: 2 },
    { pattern: 'disable', weight: 2 },
    { pattern: 'can you fix', weight: 3 },
    { pattern: 'please add', weight: 3 },
    { pattern: 'go ahead and', weight: 3 },
    { pattern: 'please', weight: 1 },
  ];

  private diagKeywords: KeywordConfig[] = [
    // Question words (weight 2)
    { pattern: 'what', weight: 2 },
    { pattern: 'why', weight: 2 },
    { pattern: 'how', weight: 2 },
    { pattern: 'where', weight: 2 },
    { pattern: 'when', weight: 1 },
    { pattern: 'which', weight: 1 },
    // Analysis verbs (weight 2)
    { pattern: 'explain', weight: 3 },
    { pattern: 'analyze', weight: 2 },
    { pattern: 'review', weight: 2 },
    { pattern: 'check', weight: 2 },
    { pattern: 'look at', weight: 2 },
    { pattern: 'understand', weight: 2 },
    { pattern: 'find', weight: 1 },
    { pattern: 'search', weight: 1 },
    { pattern: 'show', weight: 2 },
    { pattern: 'list', weight: 1 },
    { pattern: 'describe', weight: 2 },
    { pattern: 'compare', weight: 2 },
    { pattern: 'debug', weight: 1 },
    { pattern: 'trace', weight: 1 },
    { pattern: 'profile', weight: 1 },
    // Question phrases (weight 3)
    { pattern: 'what is', weight: 3 },
    { pattern: 'how does', weight: 3 },
    { pattern: 'why is', weight: 3 },
    { pattern: 'can you explain', weight: 3 },
    { pattern: 'tell me about', weight: 3 },
    { pattern: 'what are', weight: 2 },
    { pattern: 'is there', weight: 1 },
    { pattern: 'can you', weight: 1 },
  ];

  /**
   * Read-only tools allowed in diagnostic mode
   */
  private readOnlyTools = [
    'read_file',
    'search',
    'list_tree',
    'git_status',
    'git_diff',
    'git_log',
    'get_file_info',
    'list_directory',
  ];

  /**
   * Tools that modify files
   */
  private editTools = ['write_file', 'apply_patch', 'delete_path', 'rename_path', 'copy_path'];

  /**
   * Git operation tools
   */
  private gitTools = ['git_commit', 'git_push', 'git_merge', 'git_rebase', 'git_checkout'];

  /**
   * Command execution tools
   */
  private commandTools = ['run_command', 'custom_command'];

  /**
   * Detect intent from instruction text
   * @param instruction - User instruction text
   * @returns Intent detection result with confidence and matched keywords
   */
  detect(instruction: string): IntentResult {
    // Handle empty input
    if (!instruction || instruction.trim().length === 0) {
      return {
        intent: 'diagnostic',
        confidence: 0,
        keywords: [],
        reason: 'No input provided',
      };
    }

    const lower = instruction.toLowerCase();

    let implScore = 0;
    let diagScore = 0;
    const matchedKeywords: string[] = [];

    // Score implementation keywords
    for (const kw of this.implKeywords) {
      if (lower.includes(kw.pattern)) {
        implScore += kw.weight;
        if (!matchedKeywords.includes(kw.pattern)) {
          matchedKeywords.push(kw.pattern);
        }
      }
    }

    // Score diagnostic keywords
    for (const kw of this.diagKeywords) {
      if (lower.includes(kw.pattern)) {
        diagScore += kw.weight;
        if (!matchedKeywords.includes(kw.pattern)) {
          matchedKeywords.push(kw.pattern);
        }
      }
    }

    // Question mark strongly suggests diagnostic (but only if no impl keywords)
    if (instruction.trim().endsWith('?')) {
      if (implScore === 0) {
        diagScore += 3;
      } else {
        diagScore += 1; // Lower bonus when impl keywords present
      }
    }

    // Determine intent - implementation takes precedence when present
    // (safer to assume implementation if action keywords detected)
    let intent: Intent;
    if (implScore > 0) {
      // If implementation keywords found, they take precedence
      // unless diagnostic score is significantly higher (2x)
      if (diagScore > implScore * 2) {
        intent = 'diagnostic';
      } else {
        intent = 'implementation';
      }
    } else if (diagScore > 0) {
      intent = 'diagnostic';
    } else {
      // No keywords matched - default to diagnostic (safer for read-only)
      intent = 'diagnostic';
    }

    // Calculate confidence
    const total = implScore + diagScore || 1;
    const diff = Math.abs(implScore - diagScore);
    const confidence = Math.min(diff / total, 1);

    return {
      intent,
      confidence,
      keywords: matchedKeywords,
      reason: this.buildReason(intent, matchedKeywords),
    };
  }

  /**
   * Build human-readable reason for intent classification
   */
  private buildReason(intent: Intent, keywords: string[]): string {
    if (keywords.length === 0) {
      return intent === 'diagnostic'
        ? 'No action keywords detected, defaulting to read-only mode'
        : 'Defaulting to implementation mode';
    }

    const keywordList = keywords.slice(0, 3).join('", "');
    return intent === 'diagnostic'
      ? `Detected analysis keywords: "${keywordList}"`
      : `Detected action keywords: "${keywordList}"`;
  }

  /**
   * Get tool permissions for intent
   * @param intent - Detected intent
   * @returns Permission configuration
   */
  getPermissions(intent: Intent): ToolPermissions {
    if (intent === 'diagnostic') {
      return {
        allowFileEdits: false,
        allowCommands: 'readonly',
        allowGitOperations: false,
      };
    }
    return {
      allowFileEdits: true,
      allowCommands: 'all',
      allowGitOperations: true,
    };
  }

  /**
   * Check if a specific tool is allowed for intent
   * @param tool - Tool name
   * @param intent - Detected intent
   * @returns true if tool is allowed
   */
  isToolAllowed(tool: string, intent: Intent): boolean {
    // Read-only tools always allowed
    if (this.readOnlyTools.includes(tool)) {
      return true;
    }

    const permissions = this.getPermissions(intent);

    // Check edit tools
    if (this.editTools.includes(tool)) {
      return permissions.allowFileEdits;
    }

    // Check git tools
    if (this.gitTools.includes(tool)) {
      return permissions.allowGitOperations;
    }

    // Check command tools
    if (this.commandTools.includes(tool)) {
      return permissions.allowCommands !== 'none';
    }

    // Unknown tools allowed by default in implementation, blocked in diagnostic
    return intent === 'implementation';
  }

  /**
   * Get list of tools available for intent
   * @param intent - Detected intent
   * @returns Array of allowed tool names
   */
  getToolsForIntent(intent: Intent): string[] {
    const allTools = [
      ...this.readOnlyTools,
      ...this.editTools,
      ...this.gitTools,
      ...this.commandTools,
    ];

    return allTools.filter((tool) => this.isToolAllowed(tool, intent));
  }

  /**
   * Format intent for display
   * @param result - Intent detection result
   * @returns Formatted string for terminal display
   */
  formatDisplay(result: IntentResult): string {
    const { intent, keywords } = result;
    const useTheme = isThemeInitialized();
    const theme = useTheme ? getTheme() : null;

    // Helper functions for coloring
    const accent = (text: string) => (theme ? theme.fg('accent', text) : text);
    const warning = (text: string) => (theme ? theme.fg('warning', text) : text);
    const muted = (text: string) => (theme ? theme.fg('muted', text) : text);

    if (intent === 'diagnostic') {
      const header = accent('[DIAG]') + ' Mode: Diagnostic ' + muted('(read-only analysis)');
      if (keywords.length > 0) {
        const kws = keywords.slice(0, 3).join('", "');
        return `${header}\n       Detected: ${muted(`"${kws}"`)}`;
      }
      return header;
    }

    const header = warning('[IMPL]') + ' Mode: Implementation';
    if (keywords.length > 0) {
      const kws = keywords.slice(0, 3).join('", "');
      return `${header}\n       Detected: ${muted(`"${kws}"`)}`;
    }
    return header;
  }

  /**
   * Check if confidence is low enough to require clarification
   * @param confidence - Confidence score
   * @returns true if clarification should be requested
   */
  needsClarification(confidence: number): boolean {
    return confidence < 0.3;
  }
}
