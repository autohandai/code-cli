/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auto-Skill Generation - Analyzes project structure and generates world-class skills
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import { PROJECT_DIR_NAME } from '../constants.js';
import type { LLMProvider } from '../providers/LLMProvider.js';

/**
 * Available tools that skills can reference
 */
export const AVAILABLE_TOOLS = {
  file: [
    'read_file',
    'write_file',
    'append_file',
    'apply_patch',
    'search',
    'search_replace',
    'search_with_context',
    'semantic_search',
    'list_tree',
    'file_stats',
    'create_directory',
    'delete_path',
    'rename_path',
    'copy_path',
    'multi_file_edit',
  ],
  git: [
    'git_status',
    'git_diff',
    'git_diff_range',
    'git_log',
    'git_add',
    'git_commit',
    'git_branch',
    'git_switch',
    'git_stash',
    'git_stash_list',
    'git_stash_pop',
    'git_merge',
    'git_rebase',
    'git_cherry_pick',
    'git_fetch',
    'git_pull',
    'git_push',
    'auto_commit',
  ],
  command: [
    'run_command',
    'custom_command',
  ],
  dependencies: [
    'add_dependency',
    'remove_dependency',
  ],
  memory: [
    'save_memory',
    'recall_memory',
  ],
  planning: [
    'plan',
    'todo_write',
  ],
} as const;

/**
 * Get all tools as a flat array
 */
export function getAllTools(): string[] {
  return Object.values(AVAILABLE_TOOLS).flat();
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: keyof typeof AVAILABLE_TOOLS): readonly string[] {
  return AVAILABLE_TOOLS[category];
}

/**
 * Result of project analysis
 */
export interface ProjectAnalysis {
  projectName: string;
  languages: string[];
  frameworks: string[];
  patterns: string[];
  dependencies: string[];
  filePatterns: string[];
  platform: 'darwin' | 'linux' | 'win32' | 'unknown';
  hasGit: boolean;
  hasTests: boolean;
  hasCI: boolean;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'pip' | 'cargo' | 'go' | null;
}

/**
 * Generated skill data
 */
export interface GeneratedSkill {
  name: string;
  description: string;
  body: string;
  allowedTools?: string[];
}

/**
 * Result of auto-skill generation
 */
export interface AutoSkillResult {
  success: boolean;
  skillsGenerated: number;
  skills: string[];
  error?: string;
}

// Framework detection patterns for package.json
const JS_FRAMEWORKS: Record<string, string[]> = {
  react: ['react', 'react-dom'],
  nextjs: ['next'],
  vue: ['vue'],
  angular: ['@angular/core'],
  svelte: ['svelte'],
  express: ['express'],
  fastify: ['fastify'],
  nestjs: ['@nestjs/core'],
  electron: ['electron'],
  tauri: ['@tauri-apps/api'],
};

// Framework detection patterns for Python requirements
const PYTHON_FRAMEWORKS: Record<string, string[]> = {
  flask: ['flask'],
  django: ['django'],
  fastapi: ['fastapi'],
  pytest: ['pytest'],
  numpy: ['numpy', 'pandas'],
  tensorflow: ['tensorflow'],
  pytorch: ['torch'],
};

/**
 * Analyzes project structure to detect languages, frameworks, and patterns
 */
export class ProjectAnalyzer {
  constructor(private readonly projectRoot: string) {}

  /**
   * Perform full project analysis
   */
  async analyze(): Promise<ProjectAnalysis> {
    const analysis: ProjectAnalysis = {
      projectName: path.basename(this.projectRoot),
      languages: [],
      frameworks: [],
      patterns: [],
      dependencies: [],
      filePatterns: [],
      platform: this.detectPlatform(),
      hasGit: false,
      hasTests: false,
      hasCI: false,
      packageManager: null,
    };

    // Check for git
    analysis.hasGit = await fs.pathExists(path.join(this.projectRoot, '.git'));

    // Check for CI
    analysis.hasCI =
      (await fs.pathExists(path.join(this.projectRoot, '.github', 'workflows'))) ||
      (await fs.pathExists(path.join(this.projectRoot, '.gitlab-ci.yml'))) ||
      (await fs.pathExists(path.join(this.projectRoot, '.circleci')));

    // Check for package.json (Node.js/JavaScript/TypeScript)
    await this.analyzePackageJson(analysis);

    // Check for Python files
    await this.analyzePython(analysis);

    // Check for Rust
    await this.analyzeRust(analysis);

    // Check for Go
    await this.analyzeGo(analysis);

    // Detect additional patterns
    await this.detectPatterns(analysis);

    return analysis;
  }

  /**
   * Detect the current platform
   */
  private detectPlatform(): 'darwin' | 'linux' | 'win32' | 'unknown' {
    const platform = os.platform();
    if (platform === 'darwin' || platform === 'linux' || platform === 'win32') {
      return platform;
    }
    return 'unknown';
  }

  /**
   * Analyze package.json for Node.js projects
   */
  private async analyzePackageJson(analysis: ProjectAnalysis): Promise<void> {
    const packageJsonPath = path.join(this.projectRoot, 'package.json');

    if (!(await fs.pathExists(packageJsonPath))) {
      return;
    }

    try {
      const pkg = await fs.readJson(packageJsonPath);
      analysis.projectName = pkg.name || analysis.projectName;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      const depNames = Object.keys(allDeps);
      analysis.dependencies.push(...depNames);

      // Detect package manager
      if (await fs.pathExists(path.join(this.projectRoot, 'bun.lockb'))) {
        analysis.packageManager = 'bun';
      } else if (await fs.pathExists(path.join(this.projectRoot, 'pnpm-lock.yaml'))) {
        analysis.packageManager = 'pnpm';
      } else if (await fs.pathExists(path.join(this.projectRoot, 'yarn.lock'))) {
        analysis.packageManager = 'yarn';
      } else if (await fs.pathExists(path.join(this.projectRoot, 'package-lock.json'))) {
        analysis.packageManager = 'npm';
      }

      // Detect TypeScript
      if (allDeps.typescript) {
        analysis.languages.push('typescript');
        analysis.languages.push('javascript');
      }

      // Detect JavaScript from .js files if TypeScript not detected
      if (!allDeps.typescript) {
        const jsFiles = await this.findFiles('*.js', 3);
        if (jsFiles.length > 0) {
          analysis.languages.push('javascript');
        }
      }

      // Detect frameworks
      for (const [framework, deps] of Object.entries(JS_FRAMEWORKS)) {
        if (deps.some((d) => allDeps[d])) {
          analysis.frameworks.push(framework);
        }
      }

      // Detect CLI pattern
      if (pkg.bin || allDeps.commander || allDeps.yargs || allDeps.meow || allDeps.inquirer) {
        analysis.patterns.push('cli');
      }

      // Detect testing
      if (allDeps.vitest || allDeps.jest || allDeps.mocha || allDeps.ava) {
        analysis.patterns.push('testing');
        analysis.hasTests = true;
      }

      // Detect monorepo
      if (pkg.workspaces) {
        analysis.patterns.push('monorepo');
      }

      // Detect bundler
      if (allDeps.webpack || allDeps.vite || allDeps.esbuild || allDeps.rollup || allDeps.tsup) {
        analysis.patterns.push('bundling');
      }

      // Detect linting/formatting
      if (allDeps.eslint || allDeps.prettier || allDeps.biome) {
        analysis.patterns.push('linting');
      }
    } catch {
      // Ignore parse errors
    }
  }

  /**
   * Analyze Python project files
   */
  private async analyzePython(analysis: ProjectAnalysis): Promise<void> {
    const requirementsPath = path.join(this.projectRoot, 'requirements.txt');
    const pyprojectPath = path.join(this.projectRoot, 'pyproject.toml');

    let hasPython = false;

    if (await fs.pathExists(requirementsPath)) {
      hasPython = true;
      analysis.packageManager = 'pip';
      try {
        const content = await fs.readFile(requirementsPath, 'utf-8');
        const lines = content.toLowerCase();

        for (const [framework, deps] of Object.entries(PYTHON_FRAMEWORKS)) {
          if (deps.some((d) => lines.includes(d))) {
            analysis.frameworks.push(framework);
          }
        }

        if (lines.includes('pytest')) {
          analysis.hasTests = true;
          analysis.patterns.push('testing');
        }
      } catch {
        // Ignore read errors
      }
    }

    if (await fs.pathExists(pyprojectPath)) {
      hasPython = true;
    }

    if (hasPython) {
      analysis.languages.push('python');
    }
  }

  /**
   * Analyze Rust project
   */
  private async analyzeRust(analysis: ProjectAnalysis): Promise<void> {
    const cargoPath = path.join(this.projectRoot, 'Cargo.toml');

    if (await fs.pathExists(cargoPath)) {
      analysis.languages.push('rust');
      analysis.packageManager = 'cargo';
    }
  }

  /**
   * Analyze Go project
   */
  private async analyzeGo(analysis: ProjectAnalysis): Promise<void> {
    const goModPath = path.join(this.projectRoot, 'go.mod');

    if (await fs.pathExists(goModPath)) {
      analysis.languages.push('go');
      analysis.packageManager = 'go';
    }
  }

  /**
   * Detect additional project patterns
   */
  private async detectPatterns(analysis: ProjectAnalysis): Promise<void> {
    // Check for Docker
    if (await fs.pathExists(path.join(this.projectRoot, 'Dockerfile'))) {
      analysis.patterns.push('docker');
    }

    // Check for database patterns
    const dbFiles = await this.findFiles('**/migrations/**', 2);
    if (dbFiles.length > 0) {
      analysis.patterns.push('database');
    }

    // Check for API patterns
    if (
      analysis.frameworks.includes('express') ||
      analysis.frameworks.includes('fastify') ||
      analysis.frameworks.includes('nestjs') ||
      analysis.frameworks.includes('flask') ||
      analysis.frameworks.includes('fastapi') ||
      analysis.frameworks.includes('django')
    ) {
      analysis.patterns.push('api');
    }
  }

  /**
   * Find files matching a pattern (shallow search)
   */
  private async findFiles(pattern: string, maxDepth: number): Promise<string[]> {
    const results: string[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await walk(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (pattern === '*.js' && ext === '.js') {
              results.push(fullPath);
            } else if (pattern === '*.ts' && ext === '.ts') {
              results.push(fullPath);
            } else if (pattern.includes('migrations') && fullPath.includes('migrations')) {
              results.push(fullPath);
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    await walk(this.projectRoot, 0);
    return results;
  }
}

/**
 * Build the comprehensive skill generation prompt
 */
function buildSkillGenerationPrompt(analysis: ProjectAnalysis): string {
  const parts: string[] = [];

  parts.push(`# Project Analysis for Skill Generation`);
  parts.push('');
  parts.push(`**Project:** ${analysis.projectName}`);
  parts.push(`**Platform:** ${analysis.platform === 'win32' ? 'Windows (use PowerShell commands)' : analysis.platform === 'darwin' ? 'macOS (use bash commands)' : 'Linux (use bash commands)'}`);

  if (analysis.languages.length > 0) {
    parts.push(`**Languages:** ${analysis.languages.join(', ')}`);
  }

  if (analysis.frameworks.length > 0) {
    parts.push(`**Frameworks:** ${analysis.frameworks.join(', ')}`);
  }

  if (analysis.patterns.length > 0) {
    parts.push(`**Patterns:** ${analysis.patterns.join(', ')}`);
  }

  if (analysis.packageManager) {
    parts.push(`**Package Manager:** ${analysis.packageManager}`);
  }

  parts.push(`**Has Git:** ${analysis.hasGit ? 'Yes' : 'No'}`);
  parts.push(`**Has Tests:** ${analysis.hasTests ? 'Yes' : 'No'}`);
  parts.push(`**Has CI/CD:** ${analysis.hasCI ? 'Yes' : 'No'}`);

  if (analysis.dependencies.length > 0) {
    const topDeps = analysis.dependencies.slice(0, 30);
    parts.push(`**Key Dependencies:** ${topDeps.join(', ')}`);
  }

  parts.push('');
  parts.push('# Available Tools');
  parts.push('Skills can specify which tools they need. Available tools by category:');
  parts.push('');
  parts.push('**File Operations:** ' + AVAILABLE_TOOLS.file.join(', '));
  parts.push('**Git Operations:** ' + AVAILABLE_TOOLS.git.join(', '));
  parts.push('**Commands:** ' + AVAILABLE_TOOLS.command.join(', '));
  parts.push('**Dependencies:** ' + AVAILABLE_TOOLS.dependencies.join(', '));
  parts.push('**Memory:** ' + AVAILABLE_TOOLS.memory.join(', '));
  parts.push('**Planning:** ' + AVAILABLE_TOOLS.planning.join(', '));

  return parts.join('\n');
}

/**
 * Get the system prompt for skill generation
 */
function getSkillGenerationSystemPrompt(): string {
  return `You are an expert at creating Agent Skills - modular packages that extend AI coding assistants with specialized workflows.

## Your Task
Generate 3 high-quality, actionable skills based on the project analysis provided. Each skill should be practical and immediately useful.

## Skill Quality Guidelines

1. **Clear Purpose**: Each skill should solve a specific, recurring problem
2. **Concrete Examples**: Include 2-3 usage examples showing exact prompts
3. **Actionable Steps**: Provide step-by-step workflows, not vague guidance
4. **Tool Awareness**: Specify which tools the skill needs in allowed-tools
5. **Platform Aware**: Use appropriate commands for the detected OS

## Required Skill Categories (pick 3 most relevant)

1. **Changelog Generator**: For any project with git - turns commits into user-friendly release notes
2. **Code Reviewer**: Analyzes code for the specific stack (TypeScript patterns, React best practices, etc.)
3. **Test Generator**: Creates tests appropriate for the detected testing framework
4. **Documentation Generator**: Creates docs matching the project's patterns
5. **Refactoring Guide**: Stack-specific refactoring patterns and best practices
6. **Debug Helper**: Debugging workflows for the specific stack
7. **Deployment Guide**: CI/CD and deployment workflows based on detected patterns
8. **Performance Analyzer**: Performance optimization for the detected frameworks

## Response Format

Return a JSON array with exactly 3 skills. Each skill object must have:
- name: kebab-case, descriptive (e.g., "typescript-refactoring-guide")
- description: 1-2 sentences explaining when to use this skill
- allowedTools: array of tool names from the available tools list
- body: Markdown content with sections:
  - Purpose/overview (2-3 sentences)
  - "## When to Use This Skill" (bullet list)
  - "## How to Use" with example prompts
  - "## Workflow" with numbered steps
  - "## Tips" (optional but recommended)

## Example Skill Structure

{
  "name": "changelog-generator",
  "description": "Creates user-facing changelogs from git commits. Use when preparing releases or documenting updates.",
  "allowedTools": ["git_log", "git_diff_range", "read_file", "write_file", "run_command"],
  "body": "# Changelog Generator\\n\\nTransforms git commits into polished, user-friendly changelogs.\\n\\n## When to Use This Skill\\n\\n- Preparing release notes\\n- Creating weekly update summaries\\n- Documenting changes for customers\\n\\n## How to Use\\n\\n\`\`\`\\nCreate a changelog from commits since the last release\\n\`\`\`\\n\\n\`\`\`\\nGenerate release notes for version 2.5.0\\n\`\`\`\\n\\n## Workflow\\n\\n1. Scan git history for the specified range\\n2. Categorize commits (features, fixes, breaking changes)\\n3. Transform technical commits into user-friendly language\\n4. Format as clean markdown\\n\\n## Tips\\n\\n- Run from repository root\\n- Specify date ranges for focused changelogs\\n- Review output before publishing"
}

Return ONLY the JSON array, no other text.`;
}

/**
 * Generate skills based on project analysis using LLM
 */
export async function generateAutoSkills(
  analysis: ProjectAnalysis,
  llm: LLMProvider
): Promise<GeneratedSkill[]> {
  const prompt = buildSkillGenerationPrompt(analysis);

  try {
    const response = await llm.complete({
      messages: [
        {
          role: 'system',
          content: getSkillGenerationSystemPrompt(),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      maxTokens: 4000,
    });

    const content = response.content.trim();

    if (!content) {
      return [];
    }

    // Try to extract JSON from the response
    let skills: GeneratedSkill[] = [];
    try {
      skills = JSON.parse(content) as GeneratedSkill[];
    } catch {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }
      try {
        skills = JSON.parse(jsonMatch[0]) as GeneratedSkill[];
      } catch {
        return [];
      }
    }

    // Validate each skill
    return skills.filter(
      (s) =>
        s &&
        typeof s.name === 'string' &&
        typeof s.description === 'string' &&
        typeof s.body === 'string' &&
        /^[a-z0-9-]+$/.test(s.name)
    );
  } catch {
    return [];
  }
}

/**
 * Save a generated skill to the project skills directory
 */
async function saveSkill(
  skill: GeneratedSkill,
  skillsDir: string
): Promise<boolean> {
  const skillDir = path.join(skillsDir, skill.name);
  const skillPath = path.join(skillDir, 'SKILL.md');

  try {
    await fs.ensureDir(skillDir);

    // Build frontmatter with optional allowed-tools
    let frontmatter = `---
name: ${skill.name}
description: ${skill.description}`;

    if (skill.allowedTools && skill.allowedTools.length > 0) {
      frontmatter += `\nallowed-tools: ${skill.allowedTools.join(' ')}`;
    }

    frontmatter += `\n---\n\n`;

    const content = frontmatter + skill.body + '\n';

    await fs.writeFile(skillPath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Main entry point for auto-skill generation
 */
export async function runAutoSkillGeneration(
  workspaceRoot: string,
  llm: LLMProvider
): Promise<AutoSkillResult> {
  const result: AutoSkillResult = {
    success: false,
    skillsGenerated: 0,
    skills: [],
  };

  console.log(chalk.cyan('Analyzing project structure...'));

  // Analyze the project
  const analyzer = new ProjectAnalyzer(workspaceRoot);
  let analysis: ProjectAnalysis;

  try {
    analysis = await analyzer.analyze();
  } catch {
    result.error = 'Failed to analyze project';
    return result;
  }

  // Check if we detected anything useful
  if (analysis.languages.length === 0 && analysis.frameworks.length === 0) {
    console.log(chalk.yellow('Could not detect project type. No skills generated.'));
    result.error = 'Could not detect project type';
    return result;
  }

  const detected = [...analysis.languages, ...analysis.frameworks, ...analysis.patterns].join(', ');
  console.log(chalk.gray(`Detected: ${detected}`));
  console.log(chalk.gray(`Platform: ${analysis.platform}`));
  console.log(chalk.cyan('Generating skills...'));

  // Generate skills using LLM
  const skills = await generateAutoSkills(analysis, llm);

  if (skills.length === 0) {
    console.log(chalk.yellow('No skills generated.'));
    result.error = 'No skills generated';
    return result;
  }

  // Save skills to project .autohand/skills directory
  const skillsDir = path.join(workspaceRoot, PROJECT_DIR_NAME, 'skills');

  for (const skill of skills) {
    const saved = await saveSkill(skill, skillsDir);
    if (saved) {
      result.skillsGenerated++;
      result.skills.push(skill.name);
      console.log(chalk.green(`  ✓ ${skill.name}`));
      if (skill.allowedTools && skill.allowedTools.length > 0) {
        console.log(chalk.gray(`    Tools: ${skill.allowedTools.slice(0, 5).join(', ')}${skill.allowedTools.length > 5 ? '...' : ''}`));
      }
    }
  }

  if (result.skillsGenerated > 0) {
    result.success = true;
    console.log(chalk.green(`\n✓ Generated ${result.skillsGenerated} skills in ${skillsDir}`));
    console.log(chalk.gray(`  Use "/skills" to view and "/skills use <name>" to activate`));
  }

  return result;
}
