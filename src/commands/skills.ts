/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skills command - List and manage available skills
 */
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';

export interface SkillsCommandContext {
  skillsRegistry: SkillsRegistry;
  workspaceRoot?: string;
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
    return 'Skills registry not available.';
  }

  const subcommand = args[0]?.toLowerCase();
  const skillName = args.slice(1).join(' ').trim() || args[1];

  switch (subcommand) {
    case 'install':
    case 'get':
    case 'add':
      return handleSkillsInstall(ctx, skillName);

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
 * Generate a smart suggestion prompt based on skill description
 */
function generateSkillSuggestion(skillName: string, description: string): string {
  const desc = description.toLowerCase();

  // Generate contextual suggestions based on skill type
  if (desc.includes('commit') || desc.includes('git')) {
    return `Help me write a great commit message for my recent changes`;
  }
  if (desc.includes('test') || desc.includes('testing')) {
    return `Write comprehensive tests for the code I'm working on`;
  }
  if (desc.includes('review') || desc.includes('code review')) {
    return `Review my code and suggest improvements`;
  }
  if (desc.includes('document') || desc.includes('docs')) {
    return `Generate documentation for the current file`;
  }
  if (desc.includes('refactor')) {
    return `Help me refactor this code for better readability`;
  }
  if (desc.includes('debug') || desc.includes('fix')) {
    return `Help me debug the issue I'm seeing`;
  }
  if (desc.includes('api') || desc.includes('endpoint')) {
    return `Help me design a new API endpoint`;
  }
  if (desc.includes('database') || desc.includes('sql') || desc.includes('schema')) {
    return `Help me design the database schema`;
  }
  if (desc.includes('ui') || desc.includes('component') || desc.includes('frontend')) {
    return `Create a new UI component`;
  }
  if (desc.includes('deploy') || desc.includes('ci') || desc.includes('pipeline')) {
    return `Help me set up the deployment pipeline`;
  }
  if (desc.includes('security') || desc.includes('auth')) {
    return `Review security concerns in my code`;
  }
  if (desc.includes('performance') || desc.includes('optimize')) {
    return `Analyze and optimize performance`;
  }

  // Default suggestion
  return `Use ${skillName} to help with: ${description.slice(0, 50)}...`;
}

/**
 * List all available skills
 */
function listSkills(registry: SkillsRegistry): string {
  const allSkills = registry.listSkills();
  const activeSkills = registry.getActiveSkills();
  const lines: string[] = [];

  lines.push('');
  lines.push('📚 **Available Skills**');
  lines.push('');

  if (allSkills.length === 0) {
    lines.push('No skills found yet.');
    lines.push('');
    lines.push('**Get started:**');
    lines.push('');
    lines.push('{{action:🌐 Browse Community Skills|/skills install}}');
    lines.push('{{action:✨ Create New Skill|/skills new}}');
    lines.push('');
    lines.push('_Skills can be added in:_');
    lines.push('- `~/.autohand/skills/<skill-name>/SKILL.md`');
    lines.push('- `<project>/.autohand/skills/<skill-name>/SKILL.md`');
    return lines.join('\n');
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
    'codex-user': '📁 Codex User Skills',
    'claude-user': '📁 Claude User Skills',
    'claude-project': '📁 Project Skills',
    'autohand-user': '📁 Autohand User Skills',
    'autohand-project': '📁 Project Skills',
  };

  for (const [source, skills] of bySource) {
    lines.push(`**${sourceLabels[source] || source}**`);
    lines.push('');

    for (const skill of skills) {
      const isActive = skill.isActive;
      const statusIcon = isActive ? '🟢' : '⚪';
      const statusText = isActive ? ' _(active)_' : '';

      lines.push(`${statusIcon} **${skill.name}**${statusText}`);
      lines.push(`   ${skill.description}`);

      // Add action buttons for each skill
      if (isActive) {
        const suggestion = generateSkillSuggestion(skill.name, skill.description);
        lines.push(`   {{action:💡 Try it|${suggestion}}} {{action:ℹ️ Info|/skills info ${skill.name}}} {{action:⏸️ Deactivate|/skills deactivate ${skill.name}}}`);
      } else {
        lines.push(`   {{action:▶️ Activate|/skills use ${skill.name}}} {{action:ℹ️ Info|/skills info ${skill.name}}}`);
      }
      lines.push('');
    }
  }

  lines.push('─'.repeat(40));
  lines.push(`📊 **${allSkills.length}** skills available, **${activeSkills.length}** active`);
  lines.push('');
  lines.push('**Quick Actions:**');
  lines.push('{{action:🌐 Browse Community|/skills install}} {{action:✨ Create New|/skills new}}');

  return lines.join('\n');
}

/**
 * Activate a skill by name
 */
function activateSkill(registry: SkillsRegistry, name: string): string {
  if (!name) {
    return 'Usage: /skills use <skill-name>';
  }

  const skill = registry.getSkill(name);
  if (!skill) {
    const lines = [`Skill not found: ${name}`];

    // Suggest similar skills
    const similar = registry.findSimilar(name, 0.2);
    if (similar.length > 0) {
      lines.push('Did you mean:');
      for (const match of similar.slice(0, 3)) {
        lines.push(`  - ${match.skill.name}`);
      }
    }
    return lines.join('\n');
  }

  if (skill.isActive) {
    return `Skill "${name}" is already active.`;
  }

  const success = registry.activateSkill(name);
  if (success) {
    return `✓ Activated skill: ${name}\n  ${skill.description}`;
  } else {
    return `Failed to activate skill: ${name}`;
  }
}

/**
 * Deactivate a skill by name
 */
function deactivateSkill(registry: SkillsRegistry, name: string): string {
  if (!name) {
    return 'Usage: /skills deactivate <skill-name>';
  }

  const skill = registry.getSkill(name);
  if (!skill) {
    return `Skill not found: ${name}`;
  }

  if (!skill.isActive) {
    return `Skill "${name}" is not active.`;
  }

  const success = registry.deactivateSkill(name);
  if (success) {
    return `✓ Deactivated skill: ${name}`;
  } else {
    return `Failed to deactivate skill: ${name}`;
  }
}

/**
 * Show detailed info about a skill
 */
function showSkillInfo(registry: SkillsRegistry, name: string): string {
  if (!name) {
    return 'Usage: /skills info <skill-name>';
  }

  const skill = registry.getSkill(name);
  if (!skill) {
    return `Skill not found: ${name}`;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(`📋 **Skill: ${skill.name}**`);
  lines.push('');

  // Status with action button
  if (skill.isActive) {
    lines.push(`**Status:** 🟢 Active`);
    const suggestion = generateSkillSuggestion(skill.name, skill.description);
    lines.push('');
    lines.push(`{{action:💡 Try it now|${suggestion}}} {{action:⏸️ Deactivate|/skills deactivate ${skill.name}}}`);
  } else {
    lines.push(`**Status:** ⚪ Inactive`);
    lines.push('');
    lines.push(`{{action:▶️ Activate|/skills use ${skill.name}}}`);
  }

  lines.push('');
  lines.push('─'.repeat(40));
  lines.push('');
  lines.push(`**Description:** ${skill.description}`);
  lines.push(`**Source:** ${skill.source}`);
  lines.push(`**Path:** \`${skill.path}\``);

  if (skill.license) {
    lines.push(`**License:** ${skill.license}`);
  }

  if (skill.compatibility) {
    lines.push(`**Compatibility:** ${skill.compatibility}`);
  }

  if (skill['allowed-tools']) {
    lines.push(`**Allowed Tools:** ${skill['allowed-tools']}`);
  }

  if (skill.metadata && Object.keys(skill.metadata).length > 0) {
    lines.push('');
    lines.push('**Metadata:**');
    for (const [key, value] of Object.entries(skill.metadata)) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  lines.push('');
  lines.push('**Content Preview:**');
  lines.push('```');
  // Show first 500 chars of body
  const bodyPreview = skill.body.length > 500
    ? skill.body.slice(0, 500) + '\n... (truncated)'
    : skill.body;
  lines.push(bodyPreview || '(no body content)');
  lines.push('```');

  lines.push('');
  lines.push('{{action:← Back to Skills|/skills}}');

  return lines.join('\n');
}

/**
 * Handle /skills install subcommand
 */
async function handleSkillsInstall(
  ctx: SkillsCommandContext,
  skillName?: string
): Promise<string> {
  const { skillsRegistry, workspaceRoot } = ctx;

  if (!workspaceRoot) {
    return 'Workspace root not available.';
  }

  // Dynamic import to avoid circular dependencies
  const { skillsInstall } = await import('./skills-install.js');

  const result = await skillsInstall(
    {
      skillsRegistry,
      workspaceRoot,
    },
    skillName
  );

  return result ?? 'Skills install completed.';
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

export const installMetadata = {
  command: '/skills install',
  description: 'browse and install community skills',
  implemented: true,
};
