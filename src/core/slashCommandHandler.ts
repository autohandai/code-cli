/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import terminalLink from 'terminal-link';
import type { SlashCommand } from './slashCommands.js';
import type { SessionManager } from '../session/SessionManager.js';

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
          if (!this.ctx.sessionManager) {
            console.log(chalk.red('Session manager not available'));
            return null;
          }
          const { resume } = await import('../commands/resume.js');
          return resume({ sessionManager: this.ctx.sessionManager, args });
        }
        case '/sessions': {
          if (!this.ctx.sessionManager) {
            console.log(chalk.red('Session manager not available'));
            return null;
          }
          const { sessions } = await import('../commands/sessions.js');
          return sessions({ sessionManager: this.ctx.sessionManager, args });
        }
        case '/session': {
          if (!this.ctx.sessionManager) {
            console.log(chalk.red('Session manager not available'));
            return null;
          }
          const { session } = await import('../commands/session.js');
          return session({ sessionManager: this.ctx.sessionManager });
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
