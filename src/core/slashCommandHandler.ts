/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import terminalLink from 'terminal-link';
import type { SlashCommand } from './slashCommands.js';

import type { SlashCommandContext } from './slashCommandTypes.js';
import type { ExtensionRuntimeHost } from '../extensions/ExtensionRuntimeHost.js';
import {
  BROWSER_SLASH_COMMAND,
  LEGACY_BROWSER_SLASH_COMMAND,
  LEGACY_BROWSER_SLASH_COMMAND_WARNING,
} from '../browser/compatibility.js';

export class SlashCommandHandler {
  private readonly commandMap = new Map<string, SlashCommand>();

  constructor(
    private readonly ctx: SlashCommandContext,
    commands: SlashCommand[],
    private readonly extensionRuntime?: ExtensionRuntimeHost,
  ) {
    commands.forEach((cmd) => this.commandMap.set(cmd.command, cmd));
  }

  /**
   * Check if a command is supported (exists in the command map)
   */
  isCommandSupported(command: string): boolean {
    if (command === LEGACY_BROWSER_SLASH_COMMAND) {
      return this.commandMap.has(BROWSER_SLASH_COMMAND);
    }
    return this.commandMap.has(command) || this.extensionRuntime?.getCommand(command) !== undefined;
  }

  async handle(command: string, args: string[] = []): Promise<string | null> {
    if (command === LEGACY_BROWSER_SLASH_COMMAND) {
      if (!this.commandMap.has(BROWSER_SLASH_COMMAND)) {
        this.printUnsupported(command);
        return null;
      }
      const result = await this.handle(BROWSER_SLASH_COMMAND, args);
      return result
        ? `${LEGACY_BROWSER_SLASH_COMMAND_WARNING}\n${result}`
        : LEGACY_BROWSER_SLASH_COMMAND_WARNING;
    }

    const runtimeCommand = this.extensionRuntime?.getCommand(command);
    const meta = this.commandMap.get(command) ?? (runtimeCommand ? {
      command: runtimeCommand.command,
      description: runtimeCommand.description,
      implemented: true,
    } : undefined);
    if (!meta) {
      this.printUnsupported(command);
      return null;
    }
    if (meta && !meta.implemented) {
      this.printUnimplemented(meta);
      return null;
    }

    if (runtimeCommand) {
      try {
        const result = await runtimeCommand.execute({
          args,
          workspaceRoot: this.ctx.workspaceRoot,
          isNonInteractive: this.ctx.isNonInteractive === true,
          cli: {
            getOption: (name) => this.extensionRuntime?.getCliOption(name),
          },
          ui: {
            open: (viewId, props) => this.extensionRuntime!.createViewRequest(viewId, props),
          },
        });
        if (typeof result === 'object' && result?.type === 'extension-view') {
          const view = this.extensionRuntime?.getView(result.viewId);
          if (!view) {
            throw new Error(`Extension view "${result.viewId}" is unavailable`);
          }
          await this.ctx.onBeforeModal?.();
          try {
            const { showExtensionView } = await import('../extensions/ExtensionView.js');
            return await showExtensionView(view, {
              workspaceRoot: this.ctx.workspaceRoot,
              args,
              props: result.props,
            });
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        return typeof result === 'string' ? result : null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Extension command ${runtimeCommand.command} failed: ${message}`;
      }
    }

    // Guard: interactive-only commands are not available in RPC/ACP mode
    const INTERACTIVE_ONLY = new Set([
      '/model', '/cc', '/search', '/theme', '/language', '/feedback', '/skills new', '/skills-new',
      '/squad', '/statusline',
      '/publish-research', '/ps', '/stop',
    ]);
    if (this.ctx.isNonInteractive && INTERACTIVE_ONLY.has(command)) {
      return `Command ${command} requires an interactive terminal. Use the dedicated RPC method or API instead.`;
    }

    // Dynamically import and execute the command
    try {
      switch (command) {
        case '/model': {
          const { model } = await import('../commands/model.js');
          return model(this.ctx);
        }
        case '/cc': {
          const { cc } = await import('../commands/cc.js');
          return cc(this.ctx);
        }
        case '/search': {
          const { search } = await import('../commands/search.js');
          return search(this.ctx);
        }
        case '/init': {
          const { init } = await import('../commands/init.js');
          return init(this.ctx);
        }
        case '/quit': {
          const { quit } = await import('../commands/quit.js');
          return quit();
        }
        case '/exit': {
          const { exit } = await import('../commands/quit.js');
          return exit();
        }
        case '/help':
        case '/?': {
          const { help } = await import('../commands/help.js');
          await this.ctx.onBeforeModal?.();
          try {
            return help();
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        case '/about': {
          const { about } = await import('../commands/about.js');
          return about(this.ctx);
        }
        case '/agents': {
          const { handler } = await import('../commands/agents.js');
          await this.ctx.onBeforeModal?.();
          try {
            const output = await handler(args);
            if (output) {
              console.log(output);
            }
          } finally {
            await this.ctx.onAfterModal?.();
          }
          return null;
        }
        case '/agents new':
        case '/agents-new': {
          const { createAgent } = await import('../commands/agents-new.js');
          await this.ctx.onBeforeModal?.();
          try {
            return await createAgent(this.ctx);
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        case '/feedback': {
          const { feedback } = await import('../commands/feedback.js');
          await this.ctx.onBeforeModal?.();
          try {
            return await feedback(this.ctx);
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        case '/resume': {
          const { resume } = await import('../commands/resume.js');
          return resume({
            sessionManager: this.ctx.sessionManager,
            args,
            workspaceRoot: this.ctx.workspaceRoot,
            onBeforeModal: this.ctx.onBeforeModal,
            onAfterModal: this.ctx.onAfterModal,
            restoreSession: this.ctx.restoreSession,
          });
        }
        case '/sessions': {
          const { sessions } = await import('../commands/sessions.js');
          return sessions({ sessionManager: this.ctx.sessionManager, args });
        }
        case '/session': {
          const { session } = await import('../commands/session.js');
          return session({ sessionManager: this.ctx.sessionManager });
        }
        case '/undo': {
          const { undo } = await import('../commands/undo.js');
          return undo({
            workspaceRoot: this.ctx.workspaceRoot,
            undoFileMutation: this.ctx.undoFileMutation ?? (async () => {}),
            removeLastTurn: this.ctx.removeLastTurn ?? (() => {})
          });
        }
        case '/ps': {
          const { ps } = await import('../commands/ps.js');
          return ps({ backgroundProcessRegistry: this.ctx.backgroundProcessRegistry });
        }
        case '/new': {
          const { newConversation } = await import('../commands/new.js');
          return newConversation({
            resetConversation: this.ctx.resetConversation,
            sessionManager: this.ctx.sessionManager,
            memoryManager: this.ctx.memoryManager,
            llm: this.ctx.llm,
            workspaceRoot: this.ctx.workspaceRoot,
            model: this.ctx.model,
            hookManager: this.ctx.hookManager,
            clearScreen: this.ctx.clearScreen,
          });
        }
        case '/clear': {
          const { clearConversation } = await import('../commands/clear.js');
          return clearConversation({
            resetConversation: this.ctx.resetConversation,
            sessionManager: this.ctx.sessionManager,
            memoryManager: this.ctx.memoryManager,
            llm: this.ctx.llm,
            workspaceRoot: this.ctx.workspaceRoot,
            model: this.ctx.model,
            hookManager: this.ctx.hookManager,
            clearScreen: this.ctx.clearScreen,
          });
        }
        case '/settings': {
          const { settings } = await import('../commands/settings.js');
          if (!this.ctx.config) {
            console.log(chalk.yellow('Config not available.'));
            return null;
          }
          // Pause the InkRenderer for the entire /settings session.
          // settings() runs its own while(true) loop with multiple showModal
          // calls; without pause/resume the Composer's useInput races the
          // modal's useInput for stdin and ESC events get dropped.
          await this.ctx.onBeforeModal?.();
          try {
            return await settings({ config: this.ctx.config });
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        case '/statusline': {
          const { statusline } = await import('../commands/statusline.js');
          if (!this.ctx.config) {
            console.log(chalk.yellow('Config not available.'));
            return null;
          }
          await this.ctx.onBeforeModal?.();
          let result: string | null = null;
          try {
            result = await statusline({ config: this.ctx.config });
          } finally {
            await this.ctx.onAfterModal?.();
          }
          this.ctx.refreshStatusLine?.();
          return result;
        }
        case '/memory': {
          const { memory } = await import('../commands/memory.js');
          return memory({ memoryManager: this.ctx.memoryManager });
        }
        case '/formatters': {
          const { execute } = await import('../commands/formatters.js');
          await execute();
          return null;
        }
        case '/lint': {
          const { execute } = await import('../commands/lint.js');
          await execute();
          return null;
        }
        case '/completion': {
          const { execute } = await import('../commands/completion.js');
          await execute(args.join(' '));
          return null;
        }
        case '/export': {
          const { execute } = await import('../commands/export.js');
          await execute(args.join(' '), {
            sessionManager: this.ctx.sessionManager,
            currentSession: this.ctx.currentSession,
            workspaceRoot: this.ctx.workspaceRoot,
          });
          return null;
        }
        case '/share': {
          const { execute } = await import('../commands/share.js');
          await execute(args.join(' '), {
            sessionManager: this.ctx.sessionManager,
            currentSession: this.ctx.currentSession,
            model: this.ctx.model,
            provider: this.ctx.provider,
            config: this.ctx.config,
            getTotalTokensUsed: this.ctx.getTotalTokensUsed,
            workspaceRoot: this.ctx.workspaceRoot,
          });
          return null;
        }
        case '/go': {
          const { go } = await import('../commands/go.js');
          return go({
            sessionManager: this.ctx.sessionManager,
            currentSession: this.ctx.currentSession,
            workspaceRoot: this.ctx.workspaceRoot,
            model: this.ctx.model,
            provider: this.ctx.provider,
            config: this.ctx.config,
            enqueueInstruction: this.ctx.enqueueInstruction,
            enqueueMobileInstruction: this.ctx.enqueueMobileInstruction,
            enqueueInstructionWithImages: this.ctx.enqueueInstructionWithImages,
            enqueueMobileInstructionWithImages: this.ctx.enqueueMobileInstructionWithImages,
            onMobileRelayReady: this.ctx.onMobileRelayReady,
            onMobileConnected: this.ctx.onMobileConnected,
            onMobileDisconnected: this.ctx.onMobileDisconnected,
            applyPermissionMode: this.ctx.applyMobilePermissionMode,
          }, args);
        }
        case '/handoff session': {
          const { handoffSession } = await import('../commands/go.js');
          return handoffSession({
            sessionManager: this.ctx.sessionManager,
            currentSession: this.ctx.currentSession,
            workspaceRoot: this.ctx.workspaceRoot,
            model: this.ctx.model,
            provider: this.ctx.provider,
            config: this.ctx.config,
            enqueueInstruction: this.ctx.enqueueInstruction,
            enqueueMobileInstruction: this.ctx.enqueueMobileInstruction,
            enqueueInstructionWithImages: this.ctx.enqueueInstructionWithImages,
            enqueueMobileInstructionWithImages: this.ctx.enqueueMobileInstructionWithImages,
            onMobileRelayReady: this.ctx.onMobileRelayReady,
            onMobileConnected: this.ctx.onMobileConnected,
            onMobileDisconnected: this.ctx.onMobileDisconnected,
            applyPermissionMode: this.ctx.applyMobilePermissionMode,
            isFeatureEnabled: this.ctx.isFeatureEnabled,
            trackFeatureActivation: this.ctx.trackFeatureActivation,
          }, args);
        }
        case '/browser': {
          const { chrome } = await import('../commands/chrome.js');
          return chrome(this.ctx, args);
        }
        case '/review': {
          const { review } = await import('../commands/review.js');
          return review(this.ctx, args);
        }
        case '/deep-research':
        case '/deep-search': {
          const { deepResearch } = await import('../commands/deep-research.js');
          return deepResearch(this.ctx, args);
        }
        case '/publish-research': {
          const { publishResearch } = await import('../commands/publish-research.js');
          return publishResearch(this.ctx, args);
        }
        case '/autoresearch': {
          const { autoresearch } = await import('../commands/autoresearch.js');
          return autoresearch(this.ctx, args);
        }
        case '/extensions': {
          const { extensions } = await import('../commands/extensions.js');
          return extensions(this.ctx, args);
        }
        case '/pr-review': {
          const { prReview } = await import('../commands/pr-review.js');
          return prReview(this.ctx, args);
        }
        case '/status': {
          const { status } = await import('../commands/status.js');
          await this.ctx.onBeforeModal?.();
          try {
            return await status(this.ctx);
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        case '/usage': {
          const { usage } = await import('../commands/usage.js');
          return usage(this.ctx, args);
        }
        case '/login': {
          const { login } = await import('../commands/login.js');
          await this.ctx.onBeforeModal?.();
          try {
            return await login({ config: this.ctx.config });
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        case '/logout': {
          const { logout } = await import('../commands/logout.js');
          await this.ctx.onBeforeModal?.();
          try {
            return await logout({ config: this.ctx.config, currentSession: this.ctx.currentSession });
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        case '/permissions': {
          const { permissions } = await import('../commands/permissions.js');
          await this.ctx.onBeforeModal?.();
          try {
            return await permissions({
              permissionManager: this.ctx.permissionManager,
              configPath: this.ctx.config?.configPath,
            });
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        case '/hooks': {
          const { hooks } = await import('../commands/hooks.js');
          if (!this.ctx.hookManager) {
            return 'Hook manager not available.';
          }
          await this.ctx.onBeforeModal?.();
          try {
            return await hooks({ hookManager: this.ctx.hookManager });
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        case '/skills': {
          const { skills } = await import('../commands/skills.js');
          if (!this.ctx.skillsRegistry) {
            return 'Skills registry not available.';
          }
          return skills({
            skillsRegistry: this.ctx.skillsRegistry,
            workspaceRoot: this.ctx.workspaceRoot,
            hookManager: this.ctx.hookManager,
            isNonInteractive: this.ctx.isNonInteractive,
            onBeforeModal: this.ctx.onBeforeModal,
            onAfterModal: this.ctx.onAfterModal,
          }, args);
        }
        case '/skills install': {
          const { skillsInstall } = await import('../commands/skills-install.js');
          if (!this.ctx.skillsRegistry) {
            return 'Skills registry not available.';
          }
          const skillName = args.join(' ').trim() || undefined;
          return skillsInstall({
            skillsRegistry: this.ctx.skillsRegistry,
            workspaceRoot: this.ctx.workspaceRoot,
          }, skillName);
        }
        case '/skills new':
        case '/skills-new': {
          const { createSkill } = await import('../commands/skills-new.js');
          if (!this.ctx.skillsRegistry) {
            return 'Skills registry not available.';
          }
          return createSkill({
            llm: this.ctx.llm,
            skillsRegistry: this.ctx.skillsRegistry,
            workspaceRoot: this.ctx.workspaceRoot
          });
        }
        case '/theme': {
          const { theme } = await import('../commands/theme.js');
          if (!this.ctx.config) {
            console.log(chalk.yellow('Config not available for theme selection.'));
            return null;
          }
          return theme({
            config: this.ctx.config,
            onBeforeModal: this.ctx.onBeforeModal,
            onAfterModal: this.ctx.onAfterModal,
          });
        }
        case '/automode': {
          const { automode } = await import('../commands/automode.js');
          return automode({
            automodeManager: this.ctx.automodeManager,
            isInteractiveAutomodeEnabled: this.ctx.isInteractiveAutomodeEnabled,
            setInteractiveAutomodeEnabled: this.ctx.setInteractiveAutomodeEnabled,
            workspaceRoot: this.ctx.workspaceRoot,
          }, args);
        }
        case '/sync': {
          const { sync } = await import('../commands/sync.js');
          return sync(this.ctx);
        }
        case '/add-dir': {
          const { addDir } = await import('../commands/add-dir.js');
          if (!this.ctx.fileManager || !this.ctx.addAdditionalDir) {
            console.log(chalk.yellow('File manager not available for /add-dir command.'));
            return null;
          }
          return addDir({
            workspaceRoot: this.ctx.workspaceRoot,
            fileManager: this.ctx.fileManager,
            additionalDirs: this.ctx.additionalDirs ?? [],
            addAdditionalDir: this.ctx.addAdditionalDir,
          }, args);
        }
        case '/language': {
          const { language } = await import('../commands/language.js');
          if (!this.ctx.config) {
            console.log(chalk.yellow('Config not available for language selection.'));
            return null;
          }
          return language({
            config: this.ctx.config,
            onBeforeModal: this.ctx.onBeforeModal,
            onAfterModal: this.ctx.onAfterModal,
          });
        }
        case '/plan': {
          const { plan } = await import('../commands/plan.js');
          return plan(this.ctx, args.join(' '));
        }
        case '/ide': {
          const { ide } = await import('../commands/ide.js');
          return ide({
            workspaceRoot: this.ctx.workspaceRoot,
            onBeforeModal: this.ctx.onBeforeModal,
            onAfterModal: this.ctx.onAfterModal,
          });
        }
        case '/history': {
          const { history } = await import('../commands/history.js');
          return history({ ...this.ctx, args });
        }
        case '/mcp': {
          const { mcp } = await import('../commands/mcp.js');
          return mcp({
            mcpManager: this.ctx.mcpManager,
            config: this.ctx.config,
            workspaceRoot: this.ctx.workspaceRoot,
          }, args);
        }
        case '/mcp install': {
          const { mcpInstall } = await import('../commands/mcp-install.js');
          return mcpInstall({
            mcpManager: this.ctx.mcpManager,
            config: this.ctx.config,
          }, args.join(' ').trim() || undefined);
        }
        case '/skills use': {
          const { skills } = await import('../commands/skills.js');
          if (!this.ctx.skillsRegistry) {
            return 'Skills registry not available.';
          }
          return skills({
            skillsRegistry: this.ctx.skillsRegistry,
            workspaceRoot: this.ctx.workspaceRoot,
          }, ['use', ...args]);
        }
        case '/skills search': {
          const { skills } = await import('../commands/skills.js');
          if (!this.ctx.skillsRegistry) {
            return 'Skills registry not available.';
          }
          return skills({
            skillsRegistry: this.ctx.skillsRegistry,
            workspaceRoot: this.ctx.workspaceRoot,
            hookManager: this.ctx.hookManager,
            isNonInteractive: this.ctx.isNonInteractive,
          }, ['search', ...args]);
        }
        case '/skills trending': {
          const { skills } = await import('../commands/skills.js');
          if (!this.ctx.skillsRegistry) {
            return 'Skills registry not available.';
          }
          return skills({
            skillsRegistry: this.ctx.skillsRegistry,
            workspaceRoot: this.ctx.workspaceRoot,
          }, ['trending', ...args]);
        }
        case '/skills remove': {
          const { skills } = await import('../commands/skills.js');
          if (!this.ctx.skillsRegistry) {
            return 'Skills registry not available.';
          }
          return skills({
            skillsRegistry: this.ctx.skillsRegistry,
            workspaceRoot: this.ctx.workspaceRoot,
            isNonInteractive: this.ctx.isNonInteractive,
          }, ['remove', ...args]);
        }
        case '/learn': {
          const { learn } = await import('../commands/learn.js');
          if (!this.ctx.skillsRegistry) {
            return 'Skills registry not available.';
          }
          return learn({
            skillsRegistry: this.ctx.skillsRegistry,
            workspaceRoot: this.ctx.workspaceRoot,
            hookManager: this.ctx.hookManager,
            isNonInteractive: this.ctx.isNonInteractive,
            llm: this.ctx.llm,
            onBeforeModal: this.ctx.onBeforeModal,
            onAfterModal: this.ctx.onAfterModal,
            onTopRecommendation: this.ctx.onTopRecommendation,
          }, args);
        }
        case '/team': {
          const { team } = await import('../commands/team.js');
          return team({ teamManager: this.ctx.teamManager }, args);
        }
        case '/tasks': {
          const { tasks } = await import('../commands/tasks.js');
          return tasks({ teamManager: this.ctx.teamManager });
        }
        case '/message': {
          const { message } = await import('../commands/message.js');
          return message({ teamManager: this.ctx.teamManager }, args);
        }
        case '/import': {
          const { execute } = await import('../commands/import.js');
          return execute(args);
        }
        case '/repeat': {
          const { repeat } = await import('../commands/repeat.js');
          return repeat({ repeatManager: this.ctx.repeatManager, llm: this.ctx.llm }, args);
        }
        case '/setup': {
          const { setup } = await import('../commands/setup.js');
          await this.ctx.onBeforeModal?.();
          try {
            return await setup(this.ctx);
          } finally {
            await this.ctx.onAfterModal?.();
          }
        }
        case '/yolo': {
          const { toggleYolo } = await import('../commands/yolo.js');
          return toggleYolo(this.ctx);
        }
        case '/tools': {
          const { tools } = await import('../commands/tools.js');
          return tools({ toolsRegistry: this.ctx.toolsRegistry }, args);
        }
        case '/experiments': {
          const { features } = await import('../commands/features.js');
          const subcommand = (args[0] ?? '').toLowerCase();
          const opensModal = args.length === 0 || subcommand === 'list' || subcommand === 'ls';
          if (opensModal) {
            await this.ctx.onBeforeModal?.();
            try {
              const result = await features({ config: this.ctx.config, interactive: true }, args);
              this.ctx.refreshFeatureGatedTools?.();
              return result;
            } finally {
              await this.ctx.onAfterModal?.();
            }
          }
          const result = await features({ config: this.ctx.config, interactive: true }, args);
          this.ctx.refreshFeatureGatedTools?.();
          return result;
        }
        case '/fork': {
          const { forkSession } = await import('../commands/sessionBranching.js');
          return forkSession(this.ctx, args);
        }
        case '/clone': {
          const { cloneSession } = await import('../commands/sessionBranching.js');
          return cloneSession(this.ctx, args);
        }
        case '/tree': {
          const { sessionTree } = await import('../commands/sessionBranching.js');
          return sessionTree(this.ctx);
        }
        case '/goal': {
          const { goal } = await import('../commands/goal.js');
          return goal(this.ctx, args);
        }
        case '/squad': {
          const { squad } = await import('../commands/squad.js');
          return squad({ workspaceRoot: this.ctx.workspaceRoot, config: this.ctx.config }, args);
        }
        default:
          this.printUnsupported(command);
          return null;
      }
    } catch (error) {
      console.error(chalk.red(`Error executing command ${command}:`), error);
      return null;
    }
  }

  private printUnsupported(command: string): void {
    const docLink = terminalLink('docs.autohand.ai', 'https://docs.autohand.ai');
    console.log(
      chalk.yellow(`Command ${command} is not supported. Please visit ${docLink} for supported actions or type -help.`)
    );
  }

  private printUnimplemented(command: SlashCommand): void {
    console.log(chalk.yellow(`Command ${command.command} is not implemented yet.`));
    if (command.prd) {
      console.log(chalk.gray(`PRD: ${command.prd}`));
    }
  }
}

export function formatSlashCommandList(commands: SlashCommand[]): SlashCommand[] {
  return [...commands].sort((a, b) => a.command.localeCompare(b.command));
}
