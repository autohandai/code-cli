/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import terminalLink from 'terminal-link';
import type { SlashCommand } from './slashCommands.js';

import type { SlashCommandContext } from './slashCommandTypes.js';

export class SlashCommandHandler {
  private readonly commandMap = new Map<string, SlashCommand>();

  constructor(private readonly ctx: SlashCommandContext, commands: SlashCommand[]) {
    commands.forEach((cmd) => this.commandMap.set(cmd.command, cmd));
  }

  /**
   * Check if a command is supported (exists in the command map)
   */
  isCommandSupported(command: string): boolean {
    return this.commandMap.has(command);
  }

  async handle(command: string, args: string[] = []): Promise<string | null> {
    const meta = this.commandMap.get(command);
    if (!meta) {
      this.printUnsupported(command);
      return null;
    }
    if (meta && !meta.implemented) {
      this.printUnimplemented(meta);
      return null;
    }

    // Dynamically import and execute the command
    try {
      switch (command) {
        case '/model': {
          const { model } = await import('../commands/model.js');
          return model(this.ctx);
        }
        case '/init': {
          const { init } = await import('../commands/init.js');
          return init(this.ctx);
        }
        case '/quit': {
          const { quit } = await import('../commands/quit.js');
          return quit();
        }
        case '/help':
        case '/?': {
          const { help } = await import('../commands/help.js');
          return help();
        }
        case '/agents': {
          const { handler } = await import('../commands/agents.js');
          const output = await handler();
          if (output) {
            console.log(output);
          }
          return null;
        }
        case '/agents new':
        case '/agents-new': {
          const { createAgent } = await import('../commands/agents-new.js');
          return createAgent(this.ctx);
        }
        case '/feedback': {
          const { feedback } = await import('../commands/feedback.js');
          return feedback(this.ctx);
        }
        case '/resume': {
          const { resume } = await import('../commands/resume.js');
          return resume({ sessionManager: this.ctx.sessionManager, args });
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
        case '/new': {
          const { newConversation } = await import('../commands/new.js');
          return newConversation({
            resetConversation: this.ctx.resetConversation,
            sessionManager: this.ctx.sessionManager,
            workspaceRoot: this.ctx.workspaceRoot,
            model: this.ctx.model
          });
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
        case '/status': {
          const { status } = await import('../commands/status.js');
          return status(this.ctx);
        }
        case '/login': {
          const { login } = await import('../commands/login.js');
          return login({ config: this.ctx.config });
        }
        case '/logout': {
          const { logout } = await import('../commands/logout.js');
          return logout({ config: this.ctx.config });
        }
        case '/permissions': {
          const { permissions } = await import('../commands/permissions.js');
          return permissions({ permissionManager: this.ctx.permissionManager });
        }
        case '/hooks': {
          const { hooks } = await import('../commands/hooks.js');
          if (!this.ctx.hookManager) {
            return 'Hook manager not available.';
          }
          return hooks({ hookManager: this.ctx.hookManager });
        }
        case '/skills': {
          const { skills } = await import('../commands/skills.js');
          if (!this.ctx.skillsRegistry) {
            return 'Skills registry not available.';
          }
          return skills({
            skillsRegistry: this.ctx.skillsRegistry,
            workspaceRoot: this.ctx.workspaceRoot,
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
          return theme({ config: this.ctx.config });
        }
        case '/automode': {
          const { automode } = await import('../commands/automode.js');
          return automode({
            automodeManager: this.ctx.automodeManager,
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
          return language({ config: this.ctx.config });
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
