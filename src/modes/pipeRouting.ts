/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PipeHandoffOptions {
  pipedInput: string | null | undefined;
  hasExplicitPromptFlag: boolean;
  hasPromptText: boolean;
  stdoutIsTTY: boolean;
}

/**
 * Decide whether stdin-only pipe input should hand off to interactive mode.
 * Interactive handoff is valid only when stdout is interactive.
 */
export function shouldUseInteractivePipeHandoff(options: PipeHandoffOptions): boolean {
  return Boolean(
    options.pipedInput &&
    !options.hasExplicitPromptFlag &&
    !options.hasPromptText &&
    options.stdoutIsTTY
  );
}

