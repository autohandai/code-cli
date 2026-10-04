/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Plan File Storage
 * Saves/loads plans to/from .autohand/plans/ directory
 */

import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_PATHS } from '../../constants.js';
import type { Plan, PlanStep, PlanStepStatus } from './types.js';

const NOTES_HEADING = '## Notes';

function stepsAsText(steps: PlanStep[]): string {
  return steps.map((step) => `${step.number}. ${step.description}`).join('\n');
}

/**
 * PlanFileStorage - manages plan persistence to markdown files
 */
export class PlanFileStorage {
  private readonly plansDir: string;

  constructor() {
    this.plansDir = AUTOHAND_PATHS.plans;
  }

  /**
   * Get the plans directory path
   */
  getPlansDirectory(): string {
    return this.plansDir;
  }

  /**
   * Save a plan to a markdown file
   * Returns the file path
   */
  async savePlan(plan: Plan): Promise<string> {
    await fs.ensureDir(this.plansDir);

    const filePath = path.join(this.plansDir, `${plan.id}.md`);
    const content = this.formatPlanAsMarkdown(plan);

    await fs.writeFile(filePath, content, 'utf8');

    return filePath;
  }

  /**
   * Load a plan from file by ID
   * Returns null if not found
   */
  async loadPlan(planId: string): Promise<Plan | null> {
    const filePath = path.join(this.plansDir, `${planId}.md`);

    if (!await fs.pathExists(filePath)) {
      return null;
    }

    const content = await fs.readFile(filePath, 'utf8');
    return this.parsePlanFromMarkdown(content, planId);
  }

  /**
   * List all plan IDs in the plans directory
   */
  async listPlans(): Promise<string[]> {
    if (!await fs.pathExists(this.plansDir)) {
      return [];
    }

    const files = await fs.readdir(this.plansDir);
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, ''));
  }

  /**
   * Delete a plan file by ID
   * Returns true if deleted, false if not found
   */
  async deletePlan(planId: string): Promise<boolean> {
    const filePath = path.join(this.plansDir, `${planId}.md`);

    if (!await fs.pathExists(filePath)) {
      return false;
    }

    await fs.remove(filePath);
    return true;
  }

  /**
   * Format a plan as markdown content
   */
  private formatPlanAsMarkdown(plan: Plan): string {
    const createdDate = new Date(plan.createdAt).toISOString();

    const lines: string[] = [
      `# Plan: ${plan.id}`,
      '',
      `Created: ${createdDate}`,
      '',
      '## Steps',
      '',
    ];

    for (const step of plan.steps) {
      const checkbox = this.getCheckboxForStatus(step.status);
      lines.push(`- ${checkbox} ${step.number}. ${step.description}`);
    }

    lines.push('');

    // The checklist is the machine-readable part; the notes are the plan as
    // the model wrote it (goal, detail, risks) and are what a person reads.
    const notes = plan.rawText.trim();
    if (notes && notes !== stepsAsText(plan.steps)) {
      lines.push(NOTES_HEADING, '', notes, '');
    }

    return lines.join('\n');
  }

  /**
   * Get markdown checkbox for step status
   */
  private getCheckboxForStatus(status: PlanStepStatus): string {
    switch (status) {
      case 'completed':
        return '[x]';
      case 'in_progress':
        return '[>]';
      case 'skipped':
        return '[-]';
      default:
        return '[ ]';
    }
  }

  /**
   * Parse markdown content back to a Plan object
   */
  private parsePlanFromMarkdown(content: string, planId: string): Plan {
    const steps: PlanStep[] = [];

    // Only the checklist holds steps: the notes below it are free-form markdown.
    const notesStart = content.indexOf(`\n${NOTES_HEADING}\n`);
    const checklist = notesStart === -1 ? content : content.slice(0, notesStart);
    const notes = notesStart === -1 ? '' : content.slice(notesStart + NOTES_HEADING.length + 2).trim();

    // Parse steps from markdown checkboxes
    const stepPattern = /^-\s+\[([ x>\-])\]\s+(\d+)\.\s+(.+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = stepPattern.exec(checklist)) !== null) {
      const checkboxChar = match[1];
      const number = parseInt(match[2], 10);
      const description = match[3].trim();

      steps.push({
        number,
        description,
        status: this.parseStatusFromCheckbox(checkboxChar),
      });
    }

    // Parse created date
    const dateMatch = checklist.match(/Created:\s*(.+)/);
    const createdAt = dateMatch ? new Date(dateMatch[1]).getTime() : Date.now();

    return {
      id: planId,
      steps,
      rawText: notes || stepsAsText(steps),
      createdAt,
    };
  }

  /**
   * Parse step status from checkbox character
   */
  private parseStatusFromCheckbox(char: string): PlanStepStatus {
    switch (char) {
      case 'x':
        return 'completed';
      case '>':
        return 'in_progress';
      case '-':
        return 'skipped';
      default:
        return 'pending';
    }
  }
}
