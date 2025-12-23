/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skills command - List and manage available skills
 */
import chalk from 'chalk';
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';

export interface SkillsCommandContext {
  skillsRegistry: SkillsRegistry;
}

/**
 * Skills command - lists all available skills
 * /skills - List all skills
 * /skills use <name> - Activate a skill
 * /skills deactivate <name> - Deactivate a skill
 */
export async function skills(ctx: SkillsCommandContext, args: string[] = []): Promise<string | null> {
  const { skillsRegistry } = ctx;

  if (!skillsRegistry) {
    console.log(chalk.red('Skills registry not available.'));
    return null;
  }

  const subcommand = args[0]?.toLowerCase();
  const skillName = args.slice(1).join(' ').trim() || args[1];

  switch (subcommand) {
    case 'use':
    case 'activate':
      return activateSkill(skillsRegistry, skillName);

    case 'deactivate':
    case 'off':
      return deactivateSkill(skillsRegistry, skillName);

    case 'info':
    case 'show':
      return showSkillInfo(skillsRegistry, skillName);

    default:
      return listSkills(skillsRegistry);
  }
}

/**
 * List all available skills
 */
function listSkills(registry: SkillsRegistry): string | null {
  const allSkills = registry.listSkills();
  const activeSkills = registry.getActiveSkills();

  console.log();
  console.log(chalk.bold.cyan('Available Skills'));
  console.log(chalk.gray('─'.repeat(50)));

  if (allSkills.length === 0) {
    console.log(chalk.gray('No skills found.'));
    console.log();
    console.log(chalk.gray('Tip: Skills can be added in:'));
    console.log(chalk.gray('  - ~/.autohand/skills/<skill-name>/SKILL.md'));
    console.log(chalk.gray('  - <project>/.autohand/skills/<skill-name>/SKILL.md'));
    return null;
  }

  // Group skills by source
  const bySource = new Map<string, typeof allSkills>();
  for (const skill of allSkills) {
    const existing = bySource.get(skill.source) ?? [];
    existing.push(skill);
    bySource.set(skill.source, existing);
  }

  // Display by source
  const sourceLabels: Record<string, string> = {
    'codex-user': 'Codex User Skills (~/.codex/skills/)',
    'claude-user': 'Claude User Skills (~/.claude/skills/)',
    'claude-project': 'Claude Project Skills (.claude/skills/)',
    'autohand-user': 'Autohand User Skills (~/.autohand/skills/)',
    'autohand-project': 'Autohand Project Skills (.autohand/skills/)',
  };

  for (const [source, skills] of bySource) {
    console.log();
    console.log(chalk.bold.yellow(sourceLabels[source] || source));
    console.log();

    for (const skill of skills) {
      const isActive = skill.isActive;
      const statusIcon = isActive ? chalk.green('●') : chalk.gray('○');
      const nameColor = isActive ? chalk.green : chalk.white;

      console.log(`  ${statusIcon} ${nameColor(skill.name)}`);
      console.log(chalk.gray(`      ${skill.description}`));
    }
  }

  console.log();
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`Total: ${allSkills.length} skills, ${activeSkills.length} active`));
  console.log();
  console.log(chalk.gray('Commands:'));
  console.log(chalk.gray('  /skills use <name>        Activate a skill'));
  console.log(chalk.gray('  /skills deactivate <name> Deactivate a skill'));
  console.log(chalk.gray('  /skills info <name>       Show skill details'));
  console.log(chalk.gray('  /skills new               Create a new skill'));

  return null;
}

/**
 * Activate a skill by name
 */
function activateSkill(registry: SkillsRegistry, name: string): string | null {
  if (!name) {
    console.log(chalk.red('Usage: /skills use <skill-name>'));
    return null;
  }

  const skill = registry.getSkill(name);
  if (!skill) {
    console.log(chalk.red(`Skill not found: ${name}`));

    // Suggest similar skills
    const similar = registry.findSimilar(name, 0.2);
    if (similar.length > 0) {
      console.log(chalk.gray('Did you mean:'));
      for (const match of similar.slice(0, 3)) {
        console.log(chalk.gray(`  - ${match.skill.name}`));
      }
    }
    return null;
  }

  if (skill.isActive) {
    console.log(chalk.yellow(`Skill "${name}" is already active.`));
    return null;
  }

  const success = registry.activateSkill(name);
  if (success) {
    console.log(chalk.green(`✓ Activated skill: ${name}`));
    console.log(chalk.gray(`  ${skill.description}`));
    return `Skill "${name}" is now active.`;
  } else {
    console.log(chalk.red(`Failed to activate skill: ${name}`));
    return null;
  }
}

/**
 * Deactivate a skill by name
 */
function deactivateSkill(registry: SkillsRegistry, name: string): string | null {
  if (!name) {
    console.log(chalk.red('Usage: /skills deactivate <skill-name>'));
    return null;
  }

  const skill = registry.getSkill(name);
  if (!skill) {
    console.log(chalk.red(`Skill not found: ${name}`));
    return null;
  }

  if (!skill.isActive) {
    console.log(chalk.yellow(`Skill "${name}" is not active.`));
    return null;
  }

  const success = registry.deactivateSkill(name);
  if (success) {
    console.log(chalk.green(`✓ Deactivated skill: ${name}`));
    return `Skill "${name}" is now inactive.`;
  } else {
    console.log(chalk.red(`Failed to deactivate skill: ${name}`));
    return null;
  }
}

/**
 * Show detailed info about a skill
 */
function showSkillInfo(registry: SkillsRegistry, name: string): string | null {
  if (!name) {
    console.log(chalk.red('Usage: /skills info <skill-name>'));
    return null;
  }

  const skill = registry.getSkill(name);
  if (!skill) {
    console.log(chalk.red(`Skill not found: ${name}`));
    return null;
  }

  console.log();
  console.log(chalk.bold.cyan(`Skill: ${skill.name}`));
  console.log(chalk.gray('─'.repeat(50)));
  console.log();
  console.log(chalk.white('Description: ') + skill.description);
  console.log(chalk.white('Status: ') + (skill.isActive ? chalk.green('Active') : chalk.gray('Inactive')));
  console.log(chalk.white('Source: ') + skill.source);
  console.log(chalk.white('Path: ') + chalk.gray(skill.path));

  if (skill.license) {
    console.log(chalk.white('License: ') + skill.license);
  }

  if (skill.compatibility) {
    console.log(chalk.white('Compatibility: ') + skill.compatibility);
  }

  if (skill['allowed-tools']) {
    console.log(chalk.white('Allowed Tools: ') + skill['allowed-tools']);
  }

  if (skill.metadata && Object.keys(skill.metadata).length > 0) {
    console.log(chalk.white('Metadata:'));
    for (const [key, value] of Object.entries(skill.metadata)) {
      console.log(chalk.gray(`  ${key}: ${value}`));
    }
  }

  console.log();
  console.log(chalk.bold('Content:'));
  console.log(chalk.gray('─'.repeat(50)));

  // Show first 500 chars of body
  const bodyPreview = skill.body.length > 500
    ? skill.body.slice(0, 500) + chalk.gray('\n... (truncated)')
    : skill.body;
  console.log(bodyPreview || chalk.gray('(no body content)'));

  return null;
}

export const metadata = {
  command: '/skills',
  description: 'list and manage available skills',
  implemented: true,
};

export const useMetadata = {
  command: '/skills use',
  description: 'activate a skill',
  implemented: true,
};
