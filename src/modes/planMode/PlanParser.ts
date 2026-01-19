/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Plan Parser
 * Extracts numbered plans from LLM output text
 */

import type { Plan, PlanStep } from './types.js';

/**
 * Generate a unique plan ID
 */
function generateId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * PlanParser - detects and extracts numbered plans from text
 */
export class PlanParser {
  /**
   * Patterns to detect plan headers
   */
  private readonly headerPatterns = [
    /(?:^|\n)(?:Plan|Implementation Plan|Steps|Action Plan|Todo):\s*\n/im,
  ];

  /**
   * Pattern to extract numbered steps
   */
  private readonly stepPattern = /^\s*(\d+)[.)]\s+(.+)$/gm;

  /**
   * Parse text and extract a plan if present
   * Returns null if no valid plan is found
   */
  parse(text: string): Plan | null {
    // Try to find a plan with a header first
    for (const headerPattern of this.headerPatterns) {
      const headerMatch = text.match(headerPattern);
      if (headerMatch) {
        const headerEnd = (headerMatch.index ?? 0) + headerMatch[0].length;
        const planText = text.slice(headerEnd);
        const plan = this.extractPlan(planText);
        if (plan) {
          return plan;
        }
      }
    }

    // Try to find a plan without header (at least 3 numbered items)
    const plan = this.extractPlan(text, 3);
    return plan;
  }

  /**
   * Extract steps from text and build a Plan object
   * @param text - Text to extract steps from
   * @param minSteps - Minimum number of steps required (default: 1)
   */
  private extractPlan(text: string, minSteps: number = 1): Plan | null {
    const steps: PlanStep[] = [];
    let match: RegExpExecArray | null;

    // Reset regex state
    this.stepPattern.lastIndex = 0;

    while ((match = this.stepPattern.exec(text)) !== null) {
      const number = parseInt(match[1], 10);
      const description = match[2].trim();

      steps.push({
        number,
        description,
        status: 'pending',
      });
    }

    // Need at least minSteps to be considered a valid plan
    if (steps.length < minSteps) {
      return null;
    }

    // Extract the raw plan text (from first to last step)
    const rawText = steps.map(s => `${s.number}. ${s.description}`).join('\n');

    return {
      id: generateId(),
      steps,
      rawText,
      createdAt: Date.now(),
    };
  }
}
