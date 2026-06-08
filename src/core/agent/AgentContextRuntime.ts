import chalk from 'chalk';
import fs from 'fs-extra';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getPlanModeManager } from '../../commands/plan.js';
import { getProviderConfig } from '../../config.js';
import { t } from '../../i18n/index.js';
import type {
  AgentRuntime,
  ExplorationEvent,
  FunctionDefinition,
  LLMMessage,
  ProviderName,
} from '../../types.js';
import type { VersionCheckResult } from '../../utils/versionCheck.js';
import { getInstallHint } from '../../utils/versionCheck.js';
import { runWithConcurrency, type ParallelTaskSpec } from '../../utils/parallel.js';
import { calculateContextUsage, estimateMessagesTokens } from '../context/tokenizer.js';
import type { SessionDiffStatsTracker } from '../SessionDiffStatsTracker.js';
import { buildSessionBootstrap } from './SessionBootstrapBuilder.js';
import { formatStatusLineLeft, getConfigStatusLineSettings } from './StatusLineSettings.js';

const execFileAsync = promisify(execFile);

interface MentionContext {
  block: string;
  files: string[];
}

interface ProjectKnowledge {
  antiPatterns: Array<{ pattern: string; reason: string; confidence: number }>;
  bestPractices: Array<{ pattern: string; reason: string; confidence: number }>;
}

export interface AgentContextRuntimeHost {
  activeProvider: ProviderName;
  contextPercentLeft: number;
  contextWindow: number;
  conversation: {
    addSystemNote(content: string, label?: string): void;
    history(): LLMMessage[];
    reset(systemPrompt: string): void;
  };
  ignoreFilter: { isIgnored(path: string): boolean };
  inkRenderer: {
    getQueueCount?(): number;
    setContextPercent(percent: number): void;
  } | null;
  memoryManager: { getContextMemories(limit?: number): Promise<string> };
  mentionResolver: {
    clear(): void;
    flush(): MentionContext | null;
  };
  persistentInput: { getQueueLength(): number };
  sessionDiffStatsTracker?: Pick<SessionDiffStatsTracker, 'getStats'>;
  projectManager: {
    getKnowledge(workspaceRoot: string): Promise<ProjectKnowledge | null>;
  };
  runtime: AgentRuntime;
  skillsRegistry: { getActiveSkills(): Array<{ name: string; description: string }> };
  versionCheckResult?: VersionCheckResult;
  buildSystemPrompt(): Promise<string>;
  emitStatus(): void;
  generateSessionBootstrap(): Promise<string>;
  getParallelismLimit(): number;
  recordExploration(event: ExplorationEvent): void;
  updateContextUsage(messages: LLMMessage[], tools?: FunctionDefinition[]): void;
}

export async function buildAgentUserMessage(
  host: AgentContextRuntimeHost,
  instruction: string
): Promise<string> {
  const context = await collectAgentContextSummary(host);

  const userPromptParts = [
    `Workspace: ${context.workspaceRoot}`,
    context.gitStatus ? `Git status:\n${context.gitStatus}` : 'Git status: clean or unavailable.',
    `Recent files: ${context.recentFiles.join(', ') || 'none'}`,
    host.runtime.options.path ? `Target path: ${host.runtime.options.path}` : undefined,
    `Options: dryRun=${host.runtime.options.dryRun ?? false}, yes=${host.runtime.options.yes ?? false}`,
    `Instruction: ${instruction}`,
  ]
    .filter(Boolean)
    .map(String);

  const mentionContext = host.mentionResolver.flush();
  if (mentionContext) {
    if (mentionContext.files.length) {
      host.recordExploration({ kind: 'read', target: mentionContext.files.join(', ') });
    }
    userPromptParts.push(`Mentioned files context:\n${mentionContext.block}`);
  }

  return userPromptParts.join('\n\n');
}

export async function collectAgentContextSummary(
  host: AgentContextRuntimeHost
): Promise<{ workspaceRoot: string; gitStatus?: string; recentFiles: string[] }> {
  const [gitStatus, entries] = await Promise.all([
    execFileAsync('git', ['status', '-sb'], {
      cwd: host.runtime.workspaceRoot,
      encoding: 'utf8',
    })
      .then(({ stdout }) => String(stdout || '').trim() || undefined)
      .catch(() => undefined),
    fs.readdir(host.runtime.workspaceRoot),
  ]);
  const recentFiles = entries
    .filter((entry) => !host.ignoreFilter.isIgnored(entry))
    .slice(0, 20);

  return {
    workspaceRoot: host.runtime.workspaceRoot,
    gitStatus,
    recentFiles,
  };
}

export async function loadAgentInstructionFiles(host: AgentContextRuntimeHost): Promise<string[]> {
  if (host.runtime.options.bare) {
    return [];
  }

  const workspace = host.runtime.workspaceRoot;
  const agentsPath = path.join(workspace, 'AGENTS.md');
  const envAutohandHome = process.env.AUTOHAND_HOME?.trim();
  const autohandHome = envAutohandHome
    ? path.resolve(envAutohandHome.startsWith('~/') ? path.join(os.homedir(), envAutohandHome.slice(2)) : envAutohandHome)
    : null;
  const agentHomeInstructionsPath = autohandHome ? path.join(autohandHome, 'AGENTS.md') : null;
  const providerFile = host.activeProvider.includes('anthropic') || host.activeProvider === 'openrouter'
    ? 'CLAUDE.md'
    : host.activeProvider.includes('google')
      ? 'GEMINI.md'
      : null;
  const tasks: ParallelTaskSpec<string | null>[] = [
    {
      label: 'agents_instructions',
      run: async () => {
        if (!(await fs.pathExists(agentsPath))) {
          return null;
        }
        const content = await fs.readFile(agentsPath, 'utf-8');
        return `## Project Instructions (AGENTS.md)\n${content}`;
      },
    },
  ];

  if (agentHomeInstructionsPath && path.resolve(agentHomeInstructionsPath) !== path.resolve(agentsPath)) {
    tasks.push({
      label: 'agent_profile_instructions',
      run: async () => {
        if (!(await fs.pathExists(agentHomeInstructionsPath))) {
          return null;
        }
        const content = await fs.readFile(agentHomeInstructionsPath, 'utf-8');
        return `## Agent Profile Instructions ($AUTOHAND_HOME/AGENTS.md)\n${content}`;
      },
    });
  }

  if (providerFile) {
    const providerPath = path.join(workspace, providerFile);
    tasks.push({
      label: 'provider_instructions',
      run: async () => {
        if (!(await fs.pathExists(providerPath))) {
          return null;
        }
        const content = await fs.readFile(providerPath, 'utf-8');
        return `## Provider Instructions (${providerFile})\n${content}`;
      },
    });
  }

  const instructions = await runWithConcurrency(tasks, host.getParallelismLimit());
  return instructions.filter((instruction): instruction is string => Boolean(instruction));
}

export async function injectAgentProjectKnowledge(host: AgentContextRuntimeHost): Promise<void> {
  const knowledge = await host.projectManager.getKnowledge(host.runtime.workspaceRoot);
  if (!knowledge) return;

  const parts: string[] = [];

  if (knowledge.antiPatterns.length > 0) {
    parts.push('Avoid these past failures:');
    knowledge.antiPatterns.forEach((pattern) => {
      parts.push(`- ${pattern.pattern}: ${pattern.reason} (confidence: ${pattern.confidence.toFixed(2)})`);
    });
  }

  if (knowledge.bestPractices.length > 0) {
    parts.push('Follow these successful patterns:');
    knowledge.bestPractices.forEach((pattern) => {
      parts.push(`- ${pattern.pattern}: ${pattern.reason} (confidence: ${pattern.confidence.toFixed(2)})`);
    });
  }

  if (parts.length > 0) {
    host.conversation.addSystemNote(
      `Project Knowledge:\n${parts.join('\n')}`
    );
  }
}

export function updateAgentContextUsage(
  host: AgentContextRuntimeHost,
  messages: LLMMessage[],
  tools?: FunctionDefinition[]
): void {
  if (!host.contextWindow) {
    return;
  }

  if (tools) {
    const model = host.runtime.options.model
      ?? getProviderConfig(host.runtime.config, host.activeProvider)?.model
      ?? 'unconfigured';
    const usage = calculateContextUsage(
      messages,
      tools,
      model,
      undefined,
      host.contextWindow
    );
    host.contextPercentLeft = Math.round((1 - usage.usagePercent) * 100);
  } else {
    const usage = estimateMessagesTokens(messages);
    const percent = Math.max(0, Math.min(1 - usage / host.contextWindow, 1));
    host.contextPercentLeft = Math.round(percent * 100);
  }

  if (host.inkRenderer) {
    host.inkRenderer.setContextPercent(host.contextPercentLeft);
  }

  host.emitStatus();
}

export function formatAgentStatusLine(host: AgentContextRuntimeHost): { left: string; right: string } {
  const percent = Number.isFinite(host.contextPercentLeft)
    ? Math.max(0, Math.min(100, host.contextPercentLeft))
    : 100;

  const queueCount = host.inkRenderer?.getQueueCount?.() ?? host.persistentInput.getQueueLength();

  const planModeManager = getPlanModeManager();

  const planIndicator = planModeManager.isEnabled()
    ? chalk.bgCyan.black.bold(' PLAN ') + ' '
    : '';

  const left = formatStatusLineLeft({
    contextPercentLeft: percent,
    commandHint: t('ui.commandHint'),
    queueCount,
    settings: getConfigStatusLineSettings(host.runtime?.config),
    planIndicator,
    sessionDiffStats: host.sessionDiffStatsTracker?.getStats(),
  });

  let right = '';
  if (host.versionCheckResult?.updateAvailable) {
    const hint = getInstallHint(host.versionCheckResult.channel);
    right = chalk.yellow('Update available! ') + chalk.cyan(`Run: ${hint}`);
  }

  return { left, right };
}

export async function resetAgentConversationContext(host: AgentContextRuntimeHost): Promise<void> {
  const systemPrompt = await host.buildSystemPrompt();
  host.conversation.reset(systemPrompt);
  host.mentionResolver.clear();
  host.updateContextUsage(host.conversation.history());
}

export async function generateAgentSessionBootstrap(host: AgentContextRuntimeHost): Promise<string> {
  if (host.runtime.options.bare) {
    return '[Session Bootstrap]';
  }

  return buildSessionBootstrap({
    workspaceRoot: host.runtime.workspaceRoot,
    getContextMemories: (limit) => host.memoryManager.getContextMemories(limit),
    getActiveSkills: () => host.skillsRegistry.getActiveSkills(),
  });
}

export async function injectAgentSessionBootstrap(host: AgentContextRuntimeHost): Promise<void> {
  try {
    const bootstrap = await host.generateSessionBootstrap();
    if (bootstrap && bootstrap.length > '[Session Bootstrap]'.length + 10) {
      host.conversation.addSystemNote(bootstrap, '[Session Bootstrap]');
    }
  } catch {
    // Bootstrap is best-effort; never block session start.
  }
}
