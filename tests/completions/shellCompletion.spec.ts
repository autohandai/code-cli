/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  createCompletionConfig,
  generateCompletion as generateCompletionScript,
  setRuntimeCompletionConfig,
} from '../../src/completions/index.js';

const ROOT = join(import.meta.dirname, '..', '..');

function generateCompletion(shell: 'bash' | 'zsh' | 'fish'): string {
  return execFileSync('bun', ['src/index.ts', 'completion', shell], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      AUTOHAND_DISABLE_UPDATE_CHECK: '1',
    },
  });
}

describe('shell completion command', () => {
  it('generates Bash completions from the current CLI command and option surface', () => {
    const script = generateCompletion('bash');

    expect(script).toContain('auto-research');
    expect(script).toContain('experiments');
    expect(script).toContain('queue');
    expect(script).toContain('--offline');
    expect(script).toContain('--output-format');
    expect(script).toContain(
      '[[ "${COMP_WORDS[1]}" == "mcp" ]] && [[ "${COMP_WORDS[2]}" == "add" ]]',
    );
    expect(script).toContain('--transport');
    expect(script).toContain(
      'complete -F _autohand_completions autohand autohand-code agent',
    );
  });

  it('generates Zsh completions for current subcommands and all executable names', () => {
    const script = generateCompletion('zsh');

    expect(script).toContain("'auto-research:");
    expect(script).toContain("'experiments:");
    expect(script).toContain("'queue:");
    expect(script).toContain("'--offline[");
    expect(script).toContain("'add')");
    expect(script).toContain("'{-t,--transport}[");
    expect(script).toContain(
      'compdef _autohand autohand autohand-code agent',
    );
  });

  it('generates Fish completions for current subcommands and executable aliases', () => {
    const script = generateCompletion('fish');

    expect(script).toContain(
      "complete -c autohand -n '__fish_use_subcommand' -a 'auto-research'",
    );
    expect(script).toContain(
      "complete -c autohand -n '__fish_use_subcommand' -a 'experiments'",
    );
    expect(script).toContain(
      "__fish_seen_subcommand_from mcp; and __fish_seen_subcommand_from add",
    );
    expect(script).toContain('-l transport');
    expect(script).toContain('complete -c autohand-code -w autohand');
    expect(script).toContain('complete -c agent -w autohand');
  });

  it('shares the live CLI surface with interactive completion generation', () => {
    const command = new Command()
      .name('autohand')
      .option('--live-option', 'Live option');
    command.command('live-command').description('Live command');
    setRuntimeCompletionConfig(createCompletionConfig(command));

    const script = generateCompletionScript('bash');

    expect(script).toContain('--live-option');
    expect(script).toContain('live-command');
  });
});
