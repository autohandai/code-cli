/**
 * AGENTS.md Updater
 *
 * Automatically updates AGENTS.md with discovered project patterns,
 * tech stack, commands, and skills used during auto-mode sessions.
 *
 * @license Apache-2.0
 */
import path from 'path';
import fs from 'fs-extra';
import type { ProjectPatterns } from './PatternDetector.js';

export interface AgentsUpdateOptions {
  patterns?: ProjectPatterns;
  usedSkills?: string[];
  conventions?: string[];
}

/**
 * AgentsMdUpdater updates AGENTS.md with discovered project information
 */
export class AgentsMdUpdater {
  private workspaceRoot: string;
  private agentsPath: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.agentsPath = path.join(workspaceRoot, 'AGENTS.md');
  }

  /**
   * Update AGENTS.md with discovered patterns and skills
   */
  async update(options: AgentsUpdateOptions): Promise<boolean> {
    const { patterns, usedSkills, conventions } = options;

    // Load or create AGENTS.md
    let content = await this.loadOrCreateAgentsMd();

    // Update sections
    if (patterns) {
      content = this.updateTechStackSection(content, patterns);
      content = this.updateCommandsSection(content, patterns);
    }

    if (usedSkills && usedSkills.length > 0) {
      content = this.updateSkillsSection(content, usedSkills);
    }

    if (conventions && conventions.length > 0) {
      content = this.updateConventionsSection(content, conventions);
    }

    // Write updated content
    await fs.writeFile(this.agentsPath, content, 'utf-8');
    return true;
  }

  /**
   * Load existing AGENTS.md or create a new one
   */
  private async loadOrCreateAgentsMd(): Promise<string> {
    if (await fs.pathExists(this.agentsPath)) {
      return await fs.readFile(this.agentsPath, 'utf-8');
    }

    // Return minimal template
    return `# Project Autopilot

This file is automatically updated by Autohand to help AI assistants understand your project.

`;
  }

  /**
   * Update the Tech Stack section
   */
  private updateTechStackSection(content: string, patterns: ProjectPatterns): string {
    if (patterns.techStack.length === 0) return content;

    const techStackContent = patterns.techStack.map(tech => `- ${tech}`).join('\n');
    const sectionContent = `## Tech Stack\n\n${techStackContent}\n`;

    return this.updateSection(content, 'Tech Stack', sectionContent);
  }

  /**
   * Update the Commands section
   */
  private updateCommandsSection(content: string, patterns: ProjectPatterns): string {
    const commands: string[] = [];

    if (patterns.packageManager) {
      commands.push(`- **Package Manager:** \`${patterns.packageManager}\``);
    }
    if (patterns.testCommand) {
      commands.push(`- **Test:** \`${patterns.testCommand}\``);
    }
    if (patterns.buildCommand) {
      commands.push(`- **Build:** \`${patterns.buildCommand}\``);
    }
    if (patterns.lintCommand) {
      commands.push(`- **Lint:** \`${patterns.lintCommand}\``);
    }
    if (patterns.framework) {
      commands.push(`- **Framework:** ${patterns.framework}`);
    }

    if (commands.length === 0) return content;

    const sectionContent = `## Commands\n\n${commands.join('\n')}\n`;
    return this.updateSection(content, 'Commands', sectionContent);
  }

  /**
   * Update the Skills section
   */
  private updateSkillsSection(content: string, usedSkills: string[]): string {
    if (usedSkills.length === 0) return content;

    // Count skill usage
    const skillCounts = usedSkills.reduce((acc, skill) => {
      acc[skill] = (acc[skill] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const skillsList = Object.entries(skillCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([skill, count]) => `- ${skill} (${count}x)`)
      .join('\n');

    const sectionContent = `## Skills Used\n\n${skillsList}\n`;
    return this.updateSection(content, 'Skills Used', sectionContent);
  }

  /**
   * Update the Conventions section
   */
  private updateConventionsSection(content: string, conventions: string[]): string {
    if (conventions.length === 0) return content;

    const conventionsList = conventions.map(c => `- ${c}`).join('\n');
    const sectionContent = `## Conventions\n\n${conventionsList}\n`;
    return this.updateSection(content, 'Conventions', sectionContent);
  }

  /**
   * Update or insert a section in the content
   */
  private updateSection(content: string, sectionName: string, newSectionContent: string): string {
    // Match section from ## header to next ## or end of file
    const sectionRegex = new RegExp(
      `## ${this.escapeRegex(sectionName)}[\\s\\S]*?(?=\\n## |$)`,
      'g'
    );

    if (sectionRegex.test(content)) {
      // Replace existing section
      return content.replace(sectionRegex, newSectionContent.trim() + '\n');
    }

    // Find best place to insert (before ## Conventions or at end)
    const conventionsMatch = content.match(/\n## Conventions/);
    if (conventionsMatch && conventionsMatch.index !== undefined) {
      // Insert before Conventions section
      return (
        content.slice(0, conventionsMatch.index) +
        '\n' +
        newSectionContent +
        '\n' +
        content.slice(conventionsMatch.index)
      );
    }

    // Append to end
    return content.trimEnd() + '\n\n' + newSectionContent;
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Check if AGENTS.md exists
   */
  async exists(): Promise<boolean> {
    return fs.pathExists(this.agentsPath);
  }

  /**
   * Get the detected patterns summary for display
   */
  static formatPatternsSummary(patterns: ProjectPatterns): string {
    const parts: string[] = [];

    if (patterns.techStack.length > 0) {
      parts.push(`Tech: ${patterns.techStack.join(', ')}`);
    }
    if (patterns.framework) {
      parts.push(`Framework: ${patterns.framework}`);
    }
    if (patterns.packageManager) {
      parts.push(`PM: ${patterns.packageManager}`);
    }

    return parts.join(' | ') || 'No patterns detected';
  }
}
