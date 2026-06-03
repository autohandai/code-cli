/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { readInstruction } from '../../ui/inputPrompt.js';
import { renderTerminalMarkdown } from '../immediateCommandRouter.js';
import { isLikelyFilePathSlashInput } from '../slashInputDetection.js';
import { SLASH_COMMANDS } from '../slashCommands.js';
import { isAutohandDebugEnabled, writeAutohandDebugLine } from '../../utils/debugLog.js';
import { BARE_SLASH_COMMANDS_DISABLED_MESSAGE } from '../../runtime/bareMode.js';

export interface AgentPromptInstructionHost {
  [key: string]: any;
}

interface PromptSkillSummary {
  name: string;
  description?: string;
  isActive: boolean;
  source: string;
}

export async function promptForAgentInstruction(host: AgentPromptInstructionHost): Promise<string | null> {
    // Use cached workspace files for instant prompt display.
    // Files are pre-loaded during runInteractive() init and cached for 30s.
    // Trigger a background refresh without blocking the prompt.
    host.workspaceFileCollector.collectWorkspaceFiles().catch(() => {});
    const statusLine = host.formatStatusLine();
    const initialValue = host.promptSeedInput;
    host.promptSeedInput = '';
    // Wait for the pending suggestion LLM call to finish.
    // Startup: don't block — show the prompt instantly. The user wants to
    // start typing immediately. If the suggestion resolved already, great;
    // otherwise the default placeholder is shown.
    // Turns: wait up to 3s. The user is still reading output so a brief
    // wait for contextual ghost text is acceptable.
    // Next-prompt suggestion uses a lazy provider: each render cycle in the
    // prompt reads the latest value via getNextPromptSuggestion(). This eliminates the race condition
    // where the LLM takes >3s and the static snapshot was always undefined.
    // The pendingSuggestion promise triggers a re-render when it resolves,
    // so the ghost text appears as soon as the LLM responds — even if the
    // prompt is already displayed.
    const pendingSuggestion = host.pendingSuggestion;
    host.isStartupSuggestion = false;
    host.pendingSuggestion = null;

    const debugSuggestion = isAutohandDebugEnabled();
    if (debugSuggestion) {
      const state = pendingSuggestion ? 'pending' : 'none';
      host.writeDebugLine(`[SUGGESTION] Provider mode — pending=${state}, engine=${host.suggestionEngine ? 'exists' : 'null'}`);
    }

    const engine = host.suggestionEngine;
    host.readlinePromptActive = true;
    let input: string | null;
    try {
      input = await readInstruction(
        () => host.workspaceFileCollector.getCachedFiles(),
        host.runtime.options.bare ? [] : SLASH_COMMANDS,
        statusLine,
        {}, // default IO
        (data, mimeType, filename) => host.imageManager.add(data, mimeType, filename),
        host.runtime.workspaceRoot,
        initialValue,
        () => engine?.getNextPromptSuggestion() ?? undefined,
        (line) => host.resolveLlmShellSuggestion(line),
        pendingSuggestion ?? undefined,
        () =>
          host.skillsRegistry.listSkills().map((s: PromptSkillSummary) => ({
            name: s.name,
            description: s.description ?? '',
            isActive: s.isActive,
            source: s.source,
          })),
      );
    } finally {
      host.readlinePromptActive = false;
      host.flushDeferredDebugLines();
    }
    // Only exit on explicit ABORT (double Ctrl+C). Palette cancel or dismiss should continue.
    if (input === 'ABORT') { // double Ctrl+C from prompt
      return '/exit';
    }
    if (input === null) {
      // keep interactive loop running
      return null;
    }

    let normalized = input.trim();
    if (!normalized) {
      return null;
    }

    if (normalized === '/') {
      console.log(chalk.gray(
        host.runtime.options.bare
          ? BARE_SLASH_COMMANDS_DISABLED_MESSAGE
          : 'Type a slash command name (e.g. /diff) and press Enter.'
      ));
      return null;
    }

    if (normalized.startsWith('/')) {
      if (host.runtime.options.bare && !isLikelyFilePathSlashInput(normalized)) {
        console.log(chalk.gray(BARE_SLASH_COMMANDS_DISABLED_MESSAGE));
        return null;
      }

      // Always prioritize known slash commands, even when args contain '/'
      // (e.g. package specs like "@playwright/mcp@latest").
      const parsed = host.parseSlashCommand(normalized);
      const isKnownSlashCommand = host.isSlashCommandSupported(parsed.command);
      if (!isKnownSlashCommand && isLikelyFilePathSlashInput(normalized)) {
        // Looks like an absolute file path, not a command.
        // Fall through to normal prompt handling below.
      } else {
        const command = parsed.command;
        const args = parsed.args;

        // /quit and /exit return themselves as pass-through instructions
        // so the interactive loop's special exit handler (line 963) can catch them.
        // Skip the slash handler for these - they're control-flow, not commands.
        if (command === '/quit' || command === '/exit') {
          return command;
        }

        // Clear any residual status line content from the readline prompt
        // before rendering the slash command output. The readline status
        // row can leave artefacts when the terminal wraps or resizes.
        process.stdout.write('\x1b[0J');

        // Echo the user's slash command to the chat log so it's visible
        console.log(chalk.white(`\n› ${normalized}`));

        const handled = await host.runSlashCommandWithInput(command, args);
        if (handled !== null) {
          // Slash command returned display output - print it, don't send to LLM
          // Convert markdown formatting (**bold**, _italic_) to ANSI terminal codes
          console.log(renderTerminalMarkdown(handled));
        }
        writeAutohandDebugLine('[DEBUG] promptForInstruction: slash command handled, returning null', host.writeDebugLine?.bind(host));
        return null;
      }
    }

    // Handle # trigger for storing memories
    if (normalized.startsWith('#')) {
      await host.handleMemoryStore(normalized.slice(1).trim());
      return null;
    }

    if (normalized) {
      normalized = await host.mentionResolver.resolve(normalized);
      return normalized;
    }
    return null;
  }
