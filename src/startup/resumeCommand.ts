import type { Command } from 'commander';
import path from 'node:path';
import { selectResumeSession } from '../commands/resume.js';
import { SessionManager } from '../session/SessionManager.js';
import type { CLIOptions } from '../types.js';

interface ResumeCommandOptions extends CLIOptions {
  last?: boolean;
  all?: boolean;
}

interface ResumeCommandDependencies {
  run(options: CLIOptions): Promise<void>;
  sessionManager?: SessionManager;
  isInteractive?: () => boolean;
}

export function registerResumeCommand(program: Command, dependencies: ResumeCommandDependencies): Command {
  return program.command('resume [reference]')
    .description('Resume a saved session by ID, path, or unique ID prefix; otherwise open the project picker')
    .option('--last', 'Resume the most recently active session')
    .option('--all', 'Include sessions from all projects')
    .option('--path <path>', 'Workspace path to operate in and filter sessions by')
    .option('--config <path>', 'Path to the Autohand config file')
    .option('--model <model>', 'Override the configured LLM model')
    .option('--offline', 'Disable the model catalog refresh for this resumed session')
    .action(async (reference: string | undefined, _options: ResumeCommandOptions, command: Command) => {
      const { last, all, ...options } = command.optsWithGlobals<ResumeCommandOptions>();
      if (reference !== undefined && (last || all)) {
        command.error('A session reference cannot be combined with --last or --all.');
      }

      const workspaceRoot = path.resolve(options.path ?? process.cwd());
      const sessionManager = dependencies.sessionManager ?? new SessionManager();
      const projectFilter = all ? undefined : workspaceRoot;
      try {
        let sessionId: string | null;
        if (reference !== undefined) {
          sessionId = await sessionManager.resolveSessionReference(reference);
        } else if (last) {
          sessionId = (await sessionManager.getLastSession(projectFilter))?.sessionId ?? null;
          if (!sessionId) {
            console.log(projectFilter
              ? `No sessions found for project "${path.basename(projectFilter)}". Use autohand resume --last --all to search all projects.`
              : 'No sessions found. Start a new conversation to create a session.');
          }
        } else {
          sessionId = await selectResumeSession({
            sessionManager,
            workspaceRoot: projectFilter,
            interactive: dependencies.isInteractive?.() ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
            emptyHint: 'Use autohand resume --all to see sessions across projects.',
          });
        }
        if (sessionId) {
          await dependencies.run({ ...options, path: workspaceRoot, resumeSessionId: sessionId });
        }
      } catch (error) {
        command.error(error instanceof Error ? error.message : String(error));
      }
    });
}
