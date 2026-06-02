/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { getContextWindow } from '../context/tokenizer.js';
import type { AgentAction } from '../../types.js';
import type { McpServerConfig } from '../../mcp/types.js';
import { GitIgnoreParser } from '../../utils/gitIgnore.js';
import { prepareSessionWorktree } from '../../utils/sessionWorktree.js';
import { WorktreeManager } from '../../actions/worktree.js';
import { getPlanModeManager } from '../../commands/plan.js';
import { showDirectoryAccessModal } from '../../ui/directoryAccessModal.js';
import { showPlanAcceptModal } from '../../ui/planAcceptModal.js';
import { showQuestionModal } from '../../ui/questionModal.js';
import { confirm as unifiedConfirm, isExternalCallbackEnabled } from '../../ui/promptCallback.js';
import { safeSetRawMode } from '../../ui/rawMode.js';
import { isToolAllowedByYolo, normalizeYoloInput, parseYoloPattern } from '../../permissions/yoloMode.js';
import { normalizePermissionPromptResponse, type PermissionPromptResult } from '../../permissions/types.js';
import type { Plan } from '../../modes/planMode/types.js';
import { writeAutohandDebugLine } from '../../utils/debugLog.js';

export interface AgentCommandRuntimeHost {
  [key: string]: any;
}

interface SkillSummary {
  name: string;
  description?: string;
  source: string;
  path?: string;
  isActive: boolean;
  'allowed-tools'?: unknown;
}

interface SimilarSkillMatch {
  skill: {
    name: string;
  };
}

const INTERACTIVE_SLASH_COMMANDS = new Set([
  '/chrome', '/hooks', '/feedback', '/permissions', '/login', '/logout',
  '/agents-new', '/agents new', '/resume', '/theme', '/language',
  '/model', '/skills', '/skills install', '/skills-install',
  '/skills new', '/skills-new', '/mcp', '/mcp install', '/mcp-install',
  '/squad',
]);

export function applyAgentAcpMode(host: AgentCommandRuntimeHost, modeId: string): void {
    const unrestricted = modeId === 'unrestricted' || modeId === 'full-access' || modeId === 'auto-mode';
    const restricted = modeId === 'restricted' || modeId === 'dry-run';

    host.runtime.options.yes = unrestricted;
    host.runtime.options.unrestricted = unrestricted;
    host.runtime.options.restricted = modeId === 'restricted';
    host.runtime.options.dryRun = modeId === 'dry-run';

    if (restricted) {
      host.permissionManager.setMode('restricted');
      return;
    }
    if (unrestricted) {
      host.permissionManager.setMode('unrestricted');
      return;
    }
    host.permissionManager.setMode('interactive');
  }

export function applyAgentAcpModel(host: AgentCommandRuntimeHost, modelId: string): void {
    host.runtime.options.model = modelId;

    const provider = host.activeProvider ?? host.runtime.config.provider ?? 'openrouter';
    const providerConfig = host.runtime.config[provider] as { model?: string; contextWindow?: number } | undefined;
    if (providerConfig) {
      providerConfig.model = modelId;
    }

    writeAutohandDebugLine(`[DEBUG] Model changed via ACP: provider=${provider}, model=${modelId}`, host.writeDebugLine?.bind(host));

    host.llm.setModel(modelId);
    host.contextWindow = getContextWindow(modelId, providerConfig?.contextWindow);
    host.contextOrchestrator.setModel(modelId);
    host.contextOrchestrator.setContextWindow?.(host.contextWindow);
    host.contextPercentLeft = 100;
    host.syncProviderModelStatusLine(provider);
    host.emitStatus();
  }

export function applyAgentAcpConfigOption(host: AgentCommandRuntimeHost, configId: string, value: string): void {
    if (configId === 'thinking_level') {
      if (value === 'none' || value === 'normal' || value === 'extended') {
        host.runtime.options.thinking = value;
      }
      return;
    }

    if (configId === 'auto_commit') {
      host.runtime.options.autoCommit = value === 'on';
      return;
    }

    if (configId === 'context_compact') {
      host.contextOrchestrator.applyAcpConfig(configId, value);
    }
  }

export async function connectAgentAcpMcpServers(host: AgentCommandRuntimeHost, configs: McpServerConfig[]): Promise<void> {
    if (configs.length === 0) {
      return;
    }
    await host.mcpManager.connectAll(configs);
    host.syncMcpTools();
  }

export async function runAgentSlashCommandWithInput(host: AgentCommandRuntimeHost, command: string, args: string[]): Promise<string | null> {
    const queueEnabled = host.runtime.config.agent?.enableRequestQueue !== false;
    const isInteractive = INTERACTIVE_SLASH_COMMANDS.has(command);
    const canUsePersistentInput =
      process.stdout.isTTY && process.stdin.isTTY && queueEnabled && !host.inkRenderer && !isInteractive;

    let cleanupConsoleBridge: () => void = () => {};

    if (canUsePersistentInput) {
      host.persistentInput.start();
      host.persistentInputActiveTurn = true;
      // Install console bridge so console.log output from slash commands
      // (e.g. /learn progress messages) routes through writeAbove() into
      // the scroll region instead of landing on the fixed-region status line.
      cleanupConsoleBridge = host.installPersistentConsoleBridge();
    }

    try {
      const result = await host.handleSlashCommand(command, args);
      return result;
    } finally {
      if (host.persistentInputActiveTurn) {
        // Preserve any text the user typed while the slash command ran.
        // Prefer current input; if empty, take the first queued item as seed
        // so the user can review before submitting. Do NOT auto-process
        // queued items from a slash command context.
        const typed = host.persistentInput.getCurrentInput();
        if (typed.trim()) {
          host.promptSeedInput = typed;
        } else if (host.persistentInput.hasQueued()) {
          const first = host.persistentInput.dequeue();
          if (first) {
            host.promptSeedInput = first.text;
          }
        }
        // Drain remaining queued items — they should not be auto-processed
        while (host.persistentInput.hasQueued()) {
          host.persistentInput.dequeue();
        }
        host.persistentInput.stop();
        host.persistentInputActiveTurn = false;
      }
      cleanupConsoleBridge();
      if (isInteractive && host.inkRenderer?.isRunning()) {
        host.inkRenderer.clearInput();
      }
    }
  }

export async function handleAgentSlashCommand(host: AgentCommandRuntimeHost, command: string, args: string[] = []): Promise<string | null> {
    // /mcp depends on background startup state (notably MCP auto-connect).
    // Ensure startup init is settled before rendering server status/actions.
    if (command === '/mcp' || command === '/mcp install') {
      await host.ensureInitComplete();
      host.flushMcpStartupSummaryIfPending();
    }

    const result = await host.slashHandler.handle(command, args);
    if (command === '/mcp' || command === '/mcp install') {
      host.syncMcpTools();
    }
    return result;
  }

export function isAgentSlashCommand(_host: AgentCommandRuntimeHost, input: string): boolean {
    return input.trim().startsWith('/');
  }

export function isAgentSlashCommandSupported(host: AgentCommandRuntimeHost, command: string): boolean {
    return host.slashHandler.isCommandSupported(command);
  }

export function parseAgentSlashCommand(_host: AgentCommandRuntimeHost, input: string): { command: string; args: string[] } {
    const trimmed = input.trim();
    const parts = trimmed.split(/\s+/);

    // Check for two-word commands like "/skills install", "/mcp install"
    const twoWordCommands = ['/skills install', '/skills new', '/skills use', '/agents new', '/mcp install'];
    const potentialTwoWord = parts.slice(0, 2).join(' ');

    if (twoWordCommands.includes(potentialTwoWord)) {
      return {
        command: potentialTwoWord,
        args: parts.slice(2),
      };
    }

    return {
      command: parts[0],
      args: parts.slice(1),
    };
  }

export async function confirmAgentDangerousAction(host: AgentCommandRuntimeHost, message: string, context?: { tool?: string; path?: string; command?: string }): Promise<PermissionPromptResult> {
    const normalizedYolo = normalizeYoloInput(host.runtime.options.yolo as string | boolean | undefined);
    if (normalizedYolo && context?.tool) {
      try {
        const pattern = parseYoloPattern(normalizedYolo);
        if (isToolAllowedByYolo(context.tool, pattern)) {
          return { decision: 'allow_once' };
        }
      } catch {
        // Ignore malformed runtime YOLO values here; CLI validation handles normal entrypoints.
      }
    }

    if (host.runtime.options.yes || host.runtime.options.unrestricted || host.runtime.config.ui?.autoConfirm) {
      return { decision: 'allow_once' };
    }

    let decision: PermissionPromptResult;

    // Use confirmation callback if set (e.g., RPC mode)
    if (host.confirmationCallback) {
      decision = normalizePermissionPromptResponse(await host.confirmationCallback(message, context));
    } else if (isExternalCallbackEnabled()) {
      decision = normalizePermissionPromptResponse(await unifiedConfirm(message));
    } else {
      host.notificationService.notify(
        { body: message, reason: 'confirmation' },
        host.getNotificationGuards()
      ).catch(() => {});

      decision = await host.withModalPause(async () => {
        // Reset stdin to cooked mode for Modal prompts
        const wasRaw = process.stdin.isTTY && (process.stdin as any).isRaw;
        if (wasRaw) {
          safeSetRawMode(process.stdin as NodeJS.ReadStream, false);
        }
        return unifiedConfirm(message);
      });
    }

    if (context?.tool) {
      await host.permissionManager.applyPromptDecision(
        {
          tool: context.tool,
          path: context.path,
          command: context.command,
        },
        decision
      );
    }

    return decision;
  }

export function setAgentDirectoryAccessCallback(host: AgentCommandRuntimeHost, callback: (path: string, reason?: string) => Promise<string | undefined>): void {
    host.directoryAccessCallback = callback;
  }

export async function requestAgentDirectoryAccess(host: AgentCommandRuntimeHost, dirPath: string, reason?: string): Promise<string | undefined> {
    // In yolo/yes/unrestricted mode, auto-grant
    const normalizedYolo = normalizeYoloInput(host.runtime.options.yolo as string | boolean | undefined);
    if (normalizedYolo || host.runtime.options.yes || host.runtime.options.unrestricted) {
      return dirPath;
    }

    // Use callback if set (e.g., RPC mode)
    if (host.directoryAccessCallback) {
      return host.directoryAccessCallback(dirPath, reason);
    }

    // Interactive mode - show modal prompt via Ink
    if (host.useInkRenderer && host.inkRenderer) {
      return host.withModalPause(async () => {
        const result = await showDirectoryAccessModal({ path: dirPath, reason });
        return result ? dirPath : undefined;
      });
    }

    // Fallback - no callback and no Ink renderer
    return undefined;
  }

export async function executeAgentAskFollowupQuestion(host: AgentCommandRuntimeHost, question: string, suggestedAnswers?: string[]): Promise<string> {
    // Auto-approve mode: always answer "Yes" to unblock autonomous flows.
    if (host.runtime.options.yes || host.runtime.options.unrestricted) {
      console.log(chalk.yellow(`\n❓ ${question}`));
      console.log(chalk.gray('  (Auto-answered: Yes)\n'));
      return '<answer>Yes</answer>';
    }

    // Non-interactive mode fallback
    if (process.env.CI === '1' || process.env.AUTOHAND_NON_INTERACTIVE === '1') {
      console.log(chalk.yellow(`\n❓ ${question}`));
      console.log(chalk.gray('  (Auto-skipped in non-interactive mode)\n'));
      return '<answer>Skipped (non-interactive mode)</answer>';
    }

    host.notificationService.notify(
      { body: `Question: ${question.slice(0, 100)}`, reason: 'question' },
      host.getNotificationGuards()
    ).catch(() => {});

    return host.withModalPause(async () => {
      const answer = await showQuestionModal({
        question,
        suggestedAnswers
      });

      if (answer === null) {
        host.consecutiveCancellations++;
        console.log(chalk.yellow('\n  (Question cancelled)\n'));
        return '<answer>User cancelled host question. Do NOT call ask_followup_question again. Continue with your best judgment or provide a final response.</answer>';
      }

      host.consecutiveCancellations = 0;
      console.log(chalk.green(`\n✓ Answer: ${answer}\n`));
      return `<answer>${answer}</answer>`;
    });
  }

export async function handleAgentPlanCreated(host: AgentCommandRuntimeHost, plan: Plan, filePath: string): Promise<string> {
    const planManager = getPlanModeManager();

    // Guard: if plan mode is not enabled, just save the plan without
    // interacting with the manager. This prevents state corruption when
    // the LLM calls `plan` outside plan mode (which should no longer
    // happen since the tool is gated, but we keep host as a safety net).
    if (!planManager.isEnabled()) {
      console.log(chalk.cyan('\n' + '─'.repeat(60)));
      console.log(chalk.cyan.bold('📋 Plan Summary'));
      console.log(chalk.cyan('─'.repeat(60)));
      for (const step of plan.steps) {
        console.log(chalk.white(`  ${step.number}. ${step.description}`));
      }
      console.log(chalk.cyan('─'.repeat(60)));
      console.log(chalk.gray(`  Saved to: ${filePath}`));
      console.log(chalk.cyan('─'.repeat(60) + '\n'));

      return `Plan saved to ${filePath}. Plan mode is not active — enable it with /plan to use the acceptance flow.`;
    }

    // Store the plan in PlanModeManager
    planManager.setPlan(plan);

    // Display plan summary
    console.log(chalk.cyan('\n' + '─'.repeat(60)));
    console.log(chalk.cyan.bold('📋 Plan Summary'));
    console.log(chalk.cyan('─'.repeat(60)));

    for (const step of plan.steps) {
      console.log(chalk.white(`  ${step.number}. ${step.description}`));
    }

    console.log(chalk.cyan('─'.repeat(60)));
    console.log(chalk.gray(`  Saved to: ${filePath}`));
    console.log(chalk.cyan('─'.repeat(60) + '\n'));

    return `Plan saved to ${filePath} (${plan.steps.length} step(s)).\n\nCall \`exit_plan_mode\` when you are ready to present host plan to the user for approval.`;
  }

export async function handleAgentExitPlanMode(host: AgentCommandRuntimeHost, _summary?: string): Promise<string> {
    const planManager = getPlanModeManager();

    // Guard: must be in plan mode
    if (!planManager.isEnabled()) {
      return 'Error: Plan mode is not active. You can only call `exit_plan_mode` when plan mode is enabled.';
    }

    const plan = planManager.getPlan();
    if (!plan) {
      return 'Error: No plan has been created yet. Call the `plan` tool first to create a plan before calling `exit_plan_mode`.';
    }

    // Non-interactive mode: auto-accept with default option
    if (host.runtime.options.yes || host.runtime.options.unrestricted || process.env.CI === '1' || process.env.AUTOHAND_NON_INTERACTIVE === '1') {
      const config = planManager.acceptPlan('auto_accept');
      console.log(chalk.yellow('  (Auto-accepted in non-interactive mode)\n'));
      host.conversation.addSystemNote(
        `Plan accepted with option: ${config.option}. You may now proceed to execution.`
      );
      return `Plan accepted with option: ${config.option}. Starting execution...`;
    }

    // Get acceptance options from PlanModeManager
    const acceptOptions = planManager.getAcceptOptions();
    const filePath = `${plan.id}.md`;

    return host.withModalPause(async () => {
      const result = await showPlanAcceptModal({
        planFilePath: filePath,
        options: acceptOptions.map(opt => ({
          id: opt.id,
          label: opt.label,
          shortcut: opt.shortcut
        }))
      });

      // Handle result
      if (result.type === 'cancel') {
        console.log(chalk.yellow('\n  Plan not accepted. You can revise and try again.\n'));
        host.conversation.addSystemNote(
          'The user has reviewed the plan and did not accept it yet. ' +
          'Do NOT call the `plan` tool again automatically. ' +
          'Instead, ask the user what changes they would like, or provide your response summarizing the current plan.'
        );
        return 'Plan not accepted. Staying in planning mode for revisions.';
      }

      if (result.type === 'custom' && result.customText) {
        console.log(chalk.yellow(`\n  Feedback received: ${result.customText}\n`));
        host.conversation.addSystemNote(
          'The user has reviewed the plan and provided feedback. ' +
          'Do NOT call the `plan` tool again automatically. ' +
          'Revise the plan based on the user feedback and present the updated plan.'
        );
        return `User feedback on plan: ${result.customText}. Please revise the plan accordingly.`;
      }

      if (result.type === 'option' && result.optionId) {
        const selectedOption = acceptOptions.find(opt => opt.id === result.optionId);
        if (selectedOption) {
          const config = planManager.acceptPlan(selectedOption.id);

          console.log(chalk.green(`\n✓ Plan accepted: ${selectedOption.label}`));
          if (config.clearContext) {
            console.log(chalk.gray('  Context will be cleared for fresh execution.'));
            await host.resetConversationContext();
            console.log(chalk.gray('  Context cleared for fresh execution.'));
          }
          if (config.autoAcceptEdits) {
            console.log(chalk.gray('  Edits will be auto-accepted.'));
          }
          console.log();

          host.conversation.addSystemNote(
            `Plan accepted with option: ${config.option}. You may now proceed to execution.`
          );
          return `Plan accepted with option: ${config.option}. Ready for execution.\n\nSteps:\n${plan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}`;
        }
      }

      // Default: accept with manual approve if result wasn't recognized
      planManager.acceptPlan('manual_approve');
      console.log(chalk.green('\n✓ Plan accepted with manual approval for edits.\n'));
      host.conversation.addSystemNote(
        'Plan accepted with option: manual_approve. You may now proceed to execution.'
      );

      return `Plan accepted. Starting execution with manual edit approval.\n\nSteps:\n${plan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}`;
    });
  }

export function resolveAgentWorkspacePath(host: AgentCommandRuntimeHost, relativePath: string): string {
    const resolved = path.isAbsolute(relativePath)
      ? path.resolve(relativePath)
      : path.resolve(host.runtime.workspaceRoot, relativePath);
    const allowedRoots = host.files.getAllowedDirectories?.()
      ?? [host.runtime.workspaceRoot, ...(host.runtime.additionalDirs ?? [])];

    let probe = resolved;
    let realPath = resolved;

    while (true) {
      try {
        const realProbe = fs.realpathSync(probe);
        realPath = probe === resolved
          ? realProbe
          : path.join(realProbe, path.relative(probe, resolved));
        break;
      } catch {
        const parent = path.dirname(probe);
        if (parent === probe) {
          break;
        }
        probe = parent;
      }
    }

    for (const allowedRoot of allowedRoots) {
      let realRoot: string;
      try {
        realRoot = fs.realpathSync(allowedRoot);
      } catch {
        realRoot = path.resolve(allowedRoot);
      }

      const rootWithSep = realRoot.endsWith(path.sep)
        ? realRoot
        : `${realRoot}${path.sep}`;

      if (realPath === realRoot || realPath.startsWith(rootWithSep)) {
        return resolved;
      }
    }

    const allowedDirsList = allowedRoots.join(', ');
    throw new Error(
      `Path ${relativePath} escapes the allowed directories: ${allowedDirsList}. ` +
      'Tell the user to grant access with /add-dir <path> for host session or restart with --add-dir <path>.'
    );
  }

export async function switchAgentWorkspaceContext(host: AgentCommandRuntimeHost, workspaceRoot: string): Promise<void> {
    host.runtime.workspaceRoot = workspaceRoot;
    host.memoryManager.setWorkspace(workspaceRoot);
    host.hookManager.setWorkspaceRoot(workspaceRoot);
    host.files.setWorkspaceRoot(workspaceRoot);
    host.persistentInput.setWorkspaceRoot(workspaceRoot);
    host.ignoreFilter = new GitIgnoreParser(workspaceRoot, []);
    host.workspaceFileCollector.setWorkspace(workspaceRoot, host.ignoreFilter);
    await host.skillsRegistry.setWorkspace(workspaceRoot);
  }

export async function enterAgentSessionWorktree(host: AgentCommandRuntimeHost, name?: string): Promise<string> {
    if (host.sessionWorktreeState) {
      return `Already inside worktree ${host.sessionWorktreeState.worktreePath} (${host.sessionWorktreeState.branchName}). Exit it first with exit_worktree.`;
    }

    const originalWorkspaceRoot = host.runtime.workspaceRoot;
    const info = prepareSessionWorktree({
      cwd: originalWorkspaceRoot,
      worktree: name ?? true,
      mode: 'cli',
    });

    host.sessionWorktreeState = {
      ...info,
      originalWorkspaceRoot,
    };

    await host.switchWorkspaceContext(info.worktreePath);

    return [
      `Entered worktree ${info.worktreePath}.`,
      `Branch: ${info.branchName}${info.createdBranch ? ' (new)' : ''}`,
      `Original workspace: ${originalWorkspaceRoot}`,
    ].join('\n');
  }

export function handleAgentSkillTool(host: AgentCommandRuntimeHost, action: Extract<AgentAction, { type: 'skill' }>): string {
    if (action.command === 'list') {
      const skills = host.skillsRegistry.listSkills().map((skill: SkillSummary) => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        active: skill.isActive,
      }));
      return JSON.stringify(skills, null, 2);
    }

    if (!action.name?.trim()) {
      throw new Error(`skill ${action.command} requires a "name" argument.`);
    }

    const name = action.name.trim();
    const skill = host.skillsRegistry.getSkill(name);
    if (!skill) {
      const similar = host.skillsRegistry.findSimilar(name, 0.2)
        .slice(0, 3)
        .map((match: SimilarSkillMatch) => match.skill.name);
      const suggestion = similar.length > 0
        ? `\nDid you mean: ${similar.join(', ')}`
        : '';
      return `Skill "${name}" not found.${suggestion}`;
    }

    if (action.command === 'info') {
      return JSON.stringify({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        path: skill.path,
        active: skill.isActive,
        allowedTools: skill['allowed-tools'] ?? null,
      }, null, 2);
    }

    if (action.command === 'activate') {
      if (skill.isActive) {
        return `Skill "${name}" is already active.`;
      }
      const success = host.skillsRegistry.activateSkill(name);
      return success
        ? `Activated skill: ${name}\n${skill.description}`
        : `Failed to activate skill: ${name}`;
    }

    if (action.command === 'deactivate') {
      if (!skill.isActive) {
        return `Skill "${name}" is not active.`;
      }
      const success = host.skillsRegistry.deactivateSkill(name);
      return success
        ? `Deactivated skill: ${name}`
        : `Failed to deactivate skill: ${name}`;
    }

    throw new Error(`Unsupported skill command: ${action.command}`);
  }

export async function executeAgentSleepTool(host: AgentCommandRuntimeHost, seconds: number, reason?: string): Promise<string> {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error('sleep requires a non-negative "seconds" argument.');
    }
    if (seconds > 300) {
      throw new Error('sleep cannot exceed 300 seconds.');
    }

    await host.sleep(seconds * 1000);
    const units = seconds === 1 ? 'second' : 'seconds';
    return reason
      ? `Slept for ${seconds} ${units}.\nReason: ${reason}`
      : `Slept for ${seconds} ${units}.`;
  }

export async function exitAgentSessionWorktree(host: AgentCommandRuntimeHost, keep = false): Promise<string> {
    const state = host.sessionWorktreeState;
    if (!state) {
      return 'No active session worktree.';
    }

    if (!keep) {
      const manager = new WorktreeManager(state.repoRoot);
      await manager.remove(state.worktreePath, {
        force: true,
        deleteBranch: state.createdBranch,
      });
    }

    await host.switchWorkspaceContext(state.originalWorkspaceRoot);
    host.sessionWorktreeState = null;

    return keep
      ? `Exited worktree ${state.worktreePath} and returned to ${state.originalWorkspaceRoot}. Worktree kept on disk.`
      : `Exited worktree ${state.worktreePath} and returned to ${state.originalWorkspaceRoot}.`;
  }

export function isAgentDestructiveCommand(_host: AgentCommandRuntimeHost, command: string): boolean {
    const lowered = command.toLowerCase();
    return lowered.includes('rm ') || lowered.includes('sudo ') || lowered.includes('dd ');
  }
