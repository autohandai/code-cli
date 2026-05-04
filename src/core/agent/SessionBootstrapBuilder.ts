/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';

interface BootstrapSkill {
  name: string;
  description: string;
}

export interface SessionBootstrapBuilderOptions {
  workspaceRoot: string;
  getContextMemories: (limit: number) => Promise<string>;
  getActiveSkills: () => BootstrapSkill[];
}

export async function buildSessionBootstrap(options: SessionBootstrapBuilderOptions): Promise<string> {
  const parts: string[] = ['[Session Bootstrap]'];

  const memories = await options.getContextMemories(3);
  if (memories) {
    parts.push('', '## Memories & Preferences', memories);
  }

  const agentsPath = path.join(options.workspaceRoot, 'AGENTS.md');
  if (await fs.pathExists(agentsPath)) {
    const content = await fs.readFile(agentsPath, 'utf-8');
    const summary = content.split('\n').slice(0, 20).join('\n');
    if (summary.trim()) {
      parts.push('', '## Project Instructions (AGENTS.md)', summary);
    }
  }

  const activeSkills = options.getActiveSkills();
  if (activeSkills.length > 0) {
    parts.push('', '## Active Skills');
    for (const skill of activeSkills) {
      parts.push(`- **${skill.name}**: ${skill.description}`);
    }
  }

  const keyFiles = ['package.json', 'README.md', 'tsconfig.json', ' Cargo.toml', 'pyproject.toml', 'go.mod'];
  const foundKeys: string[] = [];
  for (const file of keyFiles) {
    if (await fs.pathExists(path.join(options.workspaceRoot, file.trim()))) {
      foundKeys.push(file.trim());
    }
  }
  if (foundKeys.length > 0) {
    parts.push('', `## Project Structure`, `Key files detected: ${foundKeys.join(', ')}`);
  }

  return parts.join('\n');
}
