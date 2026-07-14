import chalk from 'chalk';
import fs from 'fs-extra';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { getAutoCommitInfo } from '../../actions/git.js';
import { FileActionManager } from '../../actions/filesystem.js';
import { AgentsGenerator } from '../../onboarding/agentsGenerator.js';
import { ProjectAnalyzer as OnboardingProjectAnalyzer } from '../../onboarding/projectAnalyzer.js';
import { showConfirm, showModal, type ModalOption } from '../../ui/ink/components/Modal.js';
import type { AgentRuntime } from '../../types.js';
import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { BootstrapResult } from '../EnvironmentBootstrap.js';
import type { IntentResult } from '../IntentDetector.js';
import type { CodeQualityPipeline } from '../CodeQualityPipeline.js';
import type { EnvironmentBootstrap } from '../EnvironmentBootstrap.js';
import { isAutohandDebugEnabled, writeAutohandDebugLine } from '../../utils/debugLog.js';

export interface AgentProjectOperationsHost {
  codeQualityPipeline: CodeQualityPipeline;
  environmentBootstrap: EnvironmentBootstrap;
  files: FileActionManager;
  memoryManager: MemoryManager;
  runtime: AgentRuntime;
  runInstruction(instruction: string, options?: { signal?: AbortSignal }): Promise<boolean>;
}

export async function performAgentAutoCommit(
  host: AgentProjectOperationsHost,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  const info = getAutoCommitInfo(host.runtime.workspaceRoot);

  if (!info.canCommit) {
    if (info.error !== 'No changes to commit') {
      console.log(chalk.yellow(`\n\u26a0 Cannot auto-commit: ${info.error}`));
    }
    return;
  }

  console.log(chalk.cyan('\n\u{1f9e0} Auto-commit: Changes detected'));
  info.filesChanged.slice(0, 5).forEach((file) => {
    console.log(chalk.gray(`   ${file}`));
  });
  if (info.filesChanged.length > 5) {
    console.log(chalk.gray(`   ... and ${info.filesChanged.length - 5} more files`));
  }

  const autoCommitPrompt = `You have uncommitted changes in the repository. Please perform the following steps:

1. **Lint**: Run the project's linter (try: bun run lint, npm run lint, or pnpm lint). If there are fixable issues, fix them.

2. **Test**: Run the project's tests (try: bun run test, npm test, or pnpm test). If tests fail, do NOT proceed with commit.

3. **Review Changes**: Use git diff to understand what changed.

4. **Commit**: If lint passes and tests pass (or no test script exists), create a commit with a meaningful message that:
   - Uses conventional commit format (feat:, fix:, docs:, refactor:, test:, chore:)
   - Describes WHAT changed and WHY (not just "update files")
   - Is concise but informative

Changed files:
${info.filesChanged.map((file) => `- ${file}`).join('\n')}

Diff summary:
${info.diffSummary || 'Use git diff to see changes'}

If lint or tests fail, report the issues but do NOT commit.`;

  console.log(chalk.cyan('\n\ud83d\udd04 Running lint, test, and generating commit message...\n'));

  try {
    if (signal?.aborted) return;
    await host.runInstruction(autoCommitPrompt, { signal });
  } catch (error) {
    console.log(chalk.red(`\n\u2717 Auto-commit failed: ${(error as Error).message}`));
  }
}

export async function handleAgentMemoryStore(
  host: AgentProjectOperationsHost,
  content: string
): Promise<void> {
  if (!content) {
    console.log(chalk.gray('Usage: # <text to remember>'));
    console.log(chalk.gray('Example: # Always use TypeScript strict mode'));
    return;
  }

  try {
    const levelOptions: ModalOption[] = [
      { label: 'Project level (.autohand/memory/) - specific to this project', value: 'project' },
      { label: 'User level (~/.autohand/memory/) - available in all projects', value: 'user' },
    ];

    const levelResult = await showModal({
      title: 'Where should this memory be stored?',
      options: levelOptions,
    });

    if (!levelResult) {
      return;
    }

    const level = levelResult.value as 'project' | 'user';

    const similar = await host.memoryManager.findSimilar(content, level);
    if (similar && similar.score >= 0.6) {
      console.log();
      console.log(chalk.yellow('Found similar existing memory:'));
      console.log(chalk.gray(`  "${similar.entry.content}"`));

      const shouldUpdate = await showConfirm({
        title: 'Update the existing memory instead of creating a new one?',
      });

      if (shouldUpdate) {
        await host.memoryManager.updateMemory(similar.entry.id, content, level);
        console.log(chalk.green('Memory updated.'));
        return;
      }
    }

    await host.memoryManager.store(content, level);
    console.log(chalk.green(`Memory saved to ${level} level.`));
  } catch (error) {
    if ((error as { isCanceled?: boolean }).isCanceled) {
      return;
    }
    console.error(chalk.red('Failed to store memory:'), (error as Error).message);
  }
}

export function printAgentGitDiff(host: AgentProjectOperationsHost): void {
  const status = spawnSync('git', ['status', '-sb'], {
    cwd: host.runtime.workspaceRoot,
    encoding: 'utf8',
  });
  if (status.status === 0 && status.stdout) {
    console.log('\n' + chalk.cyan('Git status:'));
    console.log(status.stdout.trim() + '\n');
  }

  const diff = spawnSync('git', ['diff', '--color=always'], {
    cwd: host.runtime.workspaceRoot,
    encoding: 'utf8',
  });

  if (diff.status === 0) {
    console.log(chalk.cyan('Git diff:'));
    console.log(diff.stdout || chalk.gray('No diff.'));
  } else {
    console.log(chalk.yellow('Unable to compute git diff. Is this a git repository?'));
  }
}

export async function undoAgentLastMutation(host: AgentProjectOperationsHost): Promise<void> {
  try {
    await host.files.undoLast();
    console.log(chalk.green('Reverted last mutation.'));
  } catch (error) {
    console.log(chalk.yellow((error as Error).message));
  }
}

export async function createAgentInstructionsFile(host: AgentProjectOperationsHost): Promise<void> {
  const target = path.join(host.runtime.workspaceRoot, 'AGENTS.md');
  if (await fs.pathExists(target)) {
    console.log(chalk.gray('AGENTS.md already exists in this workspace.'));
    return;
  }

  console.log(chalk.gray('Analyzing project structure...'));

  const analyzer = new OnboardingProjectAnalyzer(host.runtime.workspaceRoot);
  const projectInfo = await analyzer.analyze();

  if (Object.keys(projectInfo).length > 0) {
    console.log(chalk.gray('Detected:'));
    if (projectInfo.language) {
      console.log(chalk.white(`  - Language: ${projectInfo.language}`));
    }
    if (projectInfo.framework) {
      console.log(chalk.white(`  - Framework: ${projectInfo.framework}`));
    }
    if (projectInfo.packageManager) {
      console.log(chalk.white(`  - Package manager: ${projectInfo.packageManager}`));
    }
    if (projectInfo.testFramework) {
      console.log(chalk.white(`  - Test framework: ${projectInfo.testFramework}`));
    }
  }

  const generator = new AgentsGenerator();
  const content = generator.generateContent(projectInfo);

  await fs.writeFile(target, content, 'utf8');
  console.log(chalk.green('Created AGENTS.md based on your project. Customize it to guide the agent.'));
}

export function displayAgentIntentMode(result: IntentResult): void {
  if (!isAutohandDebugEnabled()) {
    return;
  }

  if (result.intent === 'diagnostic') {
    writeAutohandDebugLine(chalk.blue('[DIAG] Mode: Diagnostic (read-only analysis)'));
    if (result.keywords.length > 0) {
      const kws = result.keywords.slice(0, 3).join('", "');
      writeAutohandDebugLine(chalk.gray(`       Detected: "${kws}"`));
    }
  } else {
    writeAutohandDebugLine(chalk.yellow('[IMPL] Mode: Implementation'));
    if (result.keywords.length > 0) {
      const kws = result.keywords.slice(0, 3).join('", "');
      writeAutohandDebugLine(chalk.gray(`       Detected: "${kws}"`));
    }
  }
  writeAutohandDebugLine('');
}

export async function runAgentEnvironmentBootstrap(
  host: AgentProjectOperationsHost
): Promise<BootstrapResult> {
  const isDebug = isAutohandDebugEnabled();

  if (isDebug) {
    writeAutohandDebugLine(chalk.cyan('[BOOTSTRAP] Running environment setup...'));
  }

  const result = await host.environmentBootstrap.run(host.runtime.workspaceRoot);

  for (const step of result.steps) {
    const status = step.status === 'success' ? chalk.green('[OK]')
      : step.status === 'failed' ? chalk.red('[FAIL]')
      : step.status === 'skipped' ? chalk.gray('[SKIP]')
      : chalk.gray('[...]');

    const duration = step.duration ? chalk.gray(`(${(step.duration / 1000).toFixed(1)}s)`) : '';
    const detail = step.detail ? chalk.gray(` ${step.detail}`) : '';

    if (step.status === 'failed' || isDebug) {
      writeAutohandDebugLine(`  ${status} ${step.name.padEnd(14)} ${duration}${detail}`);
    }

    if (step.error) {
      writeAutohandDebugLine(chalk.red(`       Error: ${step.error}`));
    }
  }

  if (result.success && isDebug) {
    writeAutohandDebugLine(chalk.green(`\n[READY] Environment ready (${(result.duration / 1000).toFixed(1)}s)\n`));
  }

  return result;
}

export async function runAgentQualityPipeline(host: AgentProjectOperationsHost): Promise<void> {
  console.log(chalk.cyan('\n[QUALITY] Running quality checks...'));

  const result = await host.codeQualityPipeline.run(host.runtime.workspaceRoot);

  for (const check of result.checks) {
    const status = check.status === 'passed' ? chalk.green('[OK]')
      : check.status === 'failed' ? chalk.red('[FAIL]')
      : check.status === 'skipped' ? chalk.gray('[SKIP]')
      : chalk.gray('[...]');

    const duration = check.duration ? chalk.gray(`(${(check.duration / 1000).toFixed(1)}s)`) : '';

    console.log(`  ${status} ${check.name.padEnd(8)} ${check.command.padEnd(20)} ${duration}`);

    if (check.status === 'failed' && check.output) {
      const errorLines = check.output.split('\n').slice(0, 3);
      for (const line of errorLines) {
        if (line.trim()) {
          console.log(chalk.red(`       ${line}`));
        }
      }
    }
  }

  if (result.passed) {
    console.log(chalk.green(`\n[PASS] ${result.summary} (${(result.duration / 1000).toFixed(1)}s)`));
  } else {
    console.log(chalk.red(`\n[FAIL] ${result.summary}`));
  }
}
