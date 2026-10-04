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

const NUMBERED_ITEM = /^([ \t]*)(\d+)[.)]\s+(.+)$/;
const BULLET_ITEM = /^([ \t]*)[-*]\s+(.+)$/;
const CODE_FENCE = /^\s*(```|~~~)/;
const TAB_WIDTH = 4;
const MAX_FALLBACK_STEP_CHARS = 200;

interface ListItem {
  indent: number;
  number?: number;
  text: string;
}

function indentWidth(whitespace: string): number {
  return [...whitespace].reduce((width, char) => width + (char === '\t' ? TAB_WIDTH : 1), 0);
}

/** The outermost items of a list: nested items are detail of their parent, not steps. */
function topLevel(items: ListItem[]): ListItem[] {
  const outermost = Math.min(...items.map((item) => item.indent));
  return items.filter((item) => item.indent === outermost);
}

/**
 * Derives the steps of a plan from the notes the model wrote. The notes are
 * markdown and usually carry more than a list (a goal, sub-points, risks), so
 * only the outermost numbered list counts as steps; bullets are used when
 * nothing is numbered. The notes themselves are kept verbatim by the caller.
 */
export function parsePlanNotes(notes: string): PlanStep[] {
  const numbered: ListItem[] = [];
  const bullets: ListItem[] = [];
  let firstProseLine = '';
  let insideFence = false;

  for (const line of notes.split(/\r?\n/)) {
    if (CODE_FENCE.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) {
      continue;
    }
    const numberedMatch = NUMBERED_ITEM.exec(line);
    if (numberedMatch) {
      numbered.push({ indent: indentWidth(numberedMatch[1]), number: Number(numberedMatch[2]), text: numberedMatch[3].trim() });
      continue;
    }
    const bulletMatch = BULLET_ITEM.exec(line);
    if (bulletMatch) {
      bullets.push({ indent: indentWidth(bulletMatch[1]), text: bulletMatch[2].trim() });
      continue;
    }
    if (!firstProseLine && line.trim() && !line.trim().startsWith('#')) {
      firstProseLine = line.trim();
    }
  }

  if (numbered.length > 0) {
    const steps = topLevel(numbered);
    // Numbering that restarts (one list per section) would give two "step 1"s.
    const increasing = steps.every((step, index) => index === 0 || step.number! > steps[index - 1].number!);
    return steps.map((step, index) => ({
      number: increasing ? step.number! : index + 1,
      description: step.text,
      status: 'pending',
    }));
  }

  if (bullets.length > 0) {
    return topLevel(bullets).map((bullet, index) => ({
      number: index + 1,
      description: bullet.text,
      status: 'pending',
    }));
  }

  if (!firstProseLine) {
    return [];
  }
  const description = firstProseLine.length > MAX_FALLBACK_STEP_CHARS
    ? `${firstProseLine.slice(0, MAX_FALLBACK_STEP_CHARS - 1)}…`
    : firstProseLine;
  return [{ number: 1, description, status: 'pending' }];
}

function sameSteps(left: PlanStep[], right: PlanStep[]): boolean {
  return left.length === right.length && left.every((step, index) =>
    step.number === right[index].number && step.description === right[index].description);
}

/**
 * Folds the edits a user made to a saved plan file back into the plan under
 * review. Rewritten notes win and the steps are derived from them again;
 * otherwise an edited checklist is taken as it stands. Returns null when the
 * file says the same thing as the plan.
 */
export function applyPlanEdits(original: Plan, edited: Plan): Plan | null {
  if (edited.rawText !== original.rawText) {
    const steps = parsePlanNotes(edited.rawText);
    return { ...original, rawText: edited.rawText, steps: steps.length > 0 ? steps : edited.steps };
  }
  if (!sameSteps(original.steps, edited.steps)) {
    return { ...original, steps: edited.steps };
  }
  return null;
}
