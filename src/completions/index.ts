/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shell Completion Scripts Generator
 * Supports bash, zsh, and fish
 */
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';

export type ShellType = 'bash' | 'zsh' | 'fish';

export interface CompletionConfig {
  commands: string[];
  slashCommands: string[];
  options: Array<{ flag: string; description: string }>;
}

const DEFAULT_CONFIG: CompletionConfig = {
  commands: ['autohand'],
  slashCommands: [
    '/quit',
    '/model',
    '/session',
    '/sessions',
    '/resume',
    '/new',
    '/undo',
    '/memory',
    '/init',
    '/agents',
    '/agents-new',
    '/feedback',
    '/help',
    '/formatters',
    '/lint',
    '/export',
  ],
  options: [
    { flag: '--prompt', description: 'Run a single instruction' },
    { flag: '--path', description: 'Set workspace path' },
    { flag: '--yes', description: 'Auto-confirm all prompts' },
    { flag: '--dry-run', description: 'Preview without applying changes' },
    { flag: '--model', description: 'Override the LLM model' },
    { flag: '--config', description: 'Path to config file' },
    { flag: '--temperature', description: 'Sampling temperature' },
    { flag: '--unrestricted', description: 'Skip all approval prompts' },
    { flag: '--restricted', description: 'Block all dangerous operations' },
    { flag: '--help', description: 'Show help' },
    { flag: '--version', description: 'Show version' },
  ],
};

/**
 * Generate Bash completion script
 */
export function generateBashCompletion(config: CompletionConfig = DEFAULT_CONFIG): string {
  const slashCmds = config.slashCommands.join(' ');
  const opts = config.options.map((o) => o.flag).join(' ');

  return `#!/bin/bash
# Autohand CLI Bash Completion
# Add to ~/.bashrc or ~/.bash_completion:
#   source <(autohand completion bash)
# Or save to /etc/bash_completion.d/autohand

_autohand_completions() {
    local cur prev opts slash_commands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    # Command line options
    opts="${opts}"

    # Slash commands (for interactive mode)
    slash_commands="${slashCmds}"

    # Complete options
    if [[ \${cur} == -* ]]; then
        COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )
        return 0
    fi

    # Complete slash commands if input starts with /
    if [[ \${cur} == /* ]]; then
        COMPREPLY=( $(compgen -W "\${slash_commands}" -- \${cur}) )
        return 0
    fi

    # Complete files for certain options
    case "\${prev}" in
        --path|--config)
            COMPREPLY=( $(compgen -f -- \${cur}) )
            return 0
            ;;
        --model)
            # Could be extended to fetch available models
            COMPREPLY=()
            return 0
            ;;
    esac

    # Default: complete with files
    COMPREPLY=( $(compgen -f -- \${cur}) )
    return 0
}

complete -F _autohand_completions autohand
`;
}

/**
 * Generate Zsh completion script
 */
export function generateZshCompletion(config: CompletionConfig = DEFAULT_CONFIG): string {
  const optLines = config.options
    .map((o) => `    '${o.flag}[${o.description}]'`)
    .join(' \\\n');

  const slashCmds = config.slashCommands.map((c) => `'${c}'`).join(' ');

  return `#compdef autohand
# Autohand CLI Zsh Completion
# Add to ~/.zshrc:
#   source <(autohand completion zsh)
# Or save to /usr/local/share/zsh/site-functions/_autohand

_autohand() {
    local context state state_descr line
    typeset -A opt_args

    _arguments -C \\
${optLines} \\
    '*:file:_files'

    # Handle slash command completion in interactive mode
    if [[ "\$words[CURRENT]" == /* ]]; then
        local slash_commands=(${slashCmds})
        _describe 'slash commands' slash_commands
        return
    fi
}

# Register the completion
compdef _autohand autohand

# Enable @ file mention completion
_autohand_file_mention() {
    if [[ "\$BUFFER" == *@* ]]; then
        local prefix="\${BUFFER##*@}"
        local files=($(git ls-files 2>/dev/null || find . -type f -maxdepth 3 2>/dev/null))
        compadd -P '@' -S '' -- \${files[@]}
    fi
}

# Bind file mention to @ key
zle -N _autohand_file_mention
`;
}

/**
 * Generate Fish completion script
 */
export function generateFishCompletion(config: CompletionConfig = DEFAULT_CONFIG): string {
  const optLines = config.options
    .map((o) => {
      const flag = o.flag.replace(/^--?/, '');
      const short = flag.length === 1 ? `-s ${flag}` : `-l ${flag}`;
      return `complete -c autohand ${short} -d '${o.description}'`;
    })
    .join('\n');

  const slashLines = config.slashCommands
    .map((c) => `complete -c autohand -a '${c}' -d 'Slash command'`)
    .join('\n');

  return `# Autohand CLI Fish Completion
# Save to ~/.config/fish/completions/autohand.fish
# Or run: autohand completion fish > ~/.config/fish/completions/autohand.fish

# Disable file completion by default
complete -c autohand -f

# Options
${optLines}

# Slash commands
${slashLines}

# File completion for specific options
complete -c autohand -l path -rF
complete -c autohand -l config -rF

# Enable file mention with @
function __autohand_file_mention
    set -l files (git ls-files 2>/dev/null; or find . -type f -maxdepth 3 2>/dev/null)
    for f in $files
        echo "@$f"
    end
end

complete -c autohand -a '(__autohand_file_mention)' -n '__fish_seen_argument -l prompt'
`;
}

/**
 * Generate completion script for specified shell
 */
export function generateCompletion(shell: ShellType, config?: CompletionConfig): string {
  const cfg = config || DEFAULT_CONFIG;

  switch (shell) {
    case 'bash':
      return generateBashCompletion(cfg);
    case 'zsh':
      return generateZshCompletion(cfg);
    case 'fish':
      return generateFishCompletion(cfg);
    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}

/**
 * Detect the current shell
 */
export function detectShell(): ShellType | null {
  const shell = process.env.SHELL || '';

  if (shell.includes('bash')) return 'bash';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';

  return null;
}

/**
 * Get the installation path for completions
 */
export function getCompletionInstallPath(shell: ShellType): string {
  const home = os.homedir();

  switch (shell) {
    case 'bash':
      // Try user-specific first, then system
      const bashCompDir = path.join(home, '.bash_completion.d');
      return path.join(bashCompDir, 'autohand');
    case 'zsh':
      // Check for common zsh completion directories
      const zshCompDir = path.join(home, '.zsh', 'completions');
      return path.join(zshCompDir, '_autohand');
    case 'fish':
      return path.join(home, '.config', 'fish', 'completions', 'autohand.fish');
    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}

/**
 * Install completion script for the specified shell
 */
export async function installCompletion(shell: ShellType, config?: CompletionConfig): Promise<string> {
  const script = generateCompletion(shell, config);
  const installPath = getCompletionInstallPath(shell);

  await fs.ensureDir(path.dirname(installPath));
  await fs.writeFile(installPath, script, 'utf8');

  return installPath;
}

/**
 * Get instructions for installing completions
 */
export function getInstallInstructions(shell: ShellType): string {
  switch (shell) {
    case 'bash':
      return `
${chalk.cyan('Bash Completion Setup:')}

${chalk.yellow('Option 1:')} Add to your ~/.bashrc:
  ${chalk.green('source <(autohand completion bash)')}

${chalk.yellow('Option 2:')} Save to completion directory:
  ${chalk.green('autohand completion bash > ~/.bash_completion.d/autohand')}
  ${chalk.green('source ~/.bash_completion.d/autohand')}

${chalk.gray('Restart your shell or run: source ~/.bashrc')}
`;

    case 'zsh':
      return `
${chalk.cyan('Zsh Completion Setup:')}

${chalk.yellow('Option 1:')} Add to your ~/.zshrc:
  ${chalk.green('source <(autohand completion zsh)')}

${chalk.yellow('Option 2:')} Save to fpath:
  ${chalk.green('autohand completion zsh > ~/.zsh/completions/_autohand')}

  Then add to ~/.zshrc (before compinit):
  ${chalk.green('fpath=(~/.zsh/completions $fpath)')}
  ${chalk.green('autoload -Uz compinit && compinit')}

${chalk.gray('Restart your shell or run: source ~/.zshrc')}
`;

    case 'fish':
      return `
${chalk.cyan('Fish Completion Setup:')}

  ${chalk.green('autohand completion fish > ~/.config/fish/completions/autohand.fish')}

${chalk.gray('Fish will automatically load the completion on next shell start.')}
`;

    default:
      return `Unknown shell: ${shell}`;
  }
}

/**
 * Print completion script to stdout (for shell sourcing)
 */
export function printCompletion(shell: ShellType, config?: CompletionConfig): void {
  console.log(generateCompletion(shell, config));
}
