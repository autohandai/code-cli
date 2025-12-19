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
