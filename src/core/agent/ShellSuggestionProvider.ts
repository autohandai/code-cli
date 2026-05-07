/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getPrimaryShellCommandSuggestion, parseShellCommand } from '../../ui/shellCommand.js';
import type { AgentRuntime, LLMMessage } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';

interface ShellSuggestionConversation {
  history(): LLMMessage[];
}

export interface ShellSuggestionProviderOptions {
  runtime: Pick<AgentRuntime, 'workspaceRoot'>;
  conversation: ShellSuggestionConversation;
  getLlm: () => LLMProvider;
  getParallelismLimit: () => number;
}

export function normalizeShellSuggestionFromLlm(raw: string, partialInput: string): string | null {
  if (!raw) {
    return null;
  }

  const candidate = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0]
    ?.replace(/^`+|`+$/g, '')
    ?.replace(/^\$+\s*/, '')
    ?.trim();

  if (!candidate) {
    return null;
  }

  const normalized = candidate.startsWith('!')
    ? candidate
    : `! ${candidate}`;
  const compact = normalized.replace(/\s+/g, ' ').trim();
  const compactPartial = partialInput.replace(/\s+/g, ' ').trim();

  if (!compact.toLowerCase().startsWith(compactPartial.toLowerCase())) {
    return null;
  }
  if (compact.toLowerCase() === compactPartial.toLowerCase()) {
    return null;
  }

  return compact;
}

export class ShellSuggestionProvider {
  constructor(private readonly options: ShellSuggestionProviderOptions) {}

  abort(): void {
    // Shell autocomplete is local and deterministic; no in-flight model work to abort.
  }

  async resolve(inputLine: string): Promise<string | null> {
    const trimmedInput = inputLine.trim();
    if (!trimmedInput.startsWith('!')) {
      return null;
    }

    const partialCommand = parseShellCommand(trimmedInput);
    if (!partialCommand) {
      return null;
    }

    const suggestion = getPrimaryShellCommandSuggestion(trimmedInput, {
      cwd: this.options.runtime.workspaceRoot,
    });
    return suggestion && suggestion !== trimmedInput ? suggestion : null;
  }
}
