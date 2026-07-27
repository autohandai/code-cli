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
import type { Command, Option } from 'commander';

export type ShellType = 'bash' | 'zsh' | 'fish';

export interface CompletionOption {
  flag: string;
  shortFlag?: string;
  description: string;
  takesValue?: boolean;
  valueOptional?: boolean;
  valueName?: string;
}

export interface CompletionCommand {
  name: string;
  description: string;
  options: CompletionOption[];
  subcommands: CompletionCommand[];
}

export interface CompletionConfig {
  commands: string[];
  slashCommands: string[];
  options: CompletionOption[];
  subcommands?: CompletionCommand[];
}

const DEFAULT_CONFIG: CompletionConfig = {
  commands: ['autohand', 'autohand-code', 'agent'],
  slashCommands: [
    '/quit',
    '/exit',
    '/model',
    '/session',
    '/sessions',
    '/resume',
    '/new',
    '/undo',
    '/memory',
    '/init',
    '/browser',
    '/agents',
    '/agents-new',
    '/feedback',
    '/help',
    '/formatters',
    '/lint',
    '/export',
    '/mcp',
    '/about',
    '/status',
    '/hooks',
    '/theme',
    '/completion',
    '/share',
    '/plan',
    '/search',
    '/skills',
    '/deep-research',
    '/deep-search',
    '/publish-research',
    '/autoresearch',
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
    { flag: '--browser', description: 'Enable browser integration' },
    { flag: '--no-browser', description: 'Disable browser integration' },
    { flag: '--no-idle-logout', description: 'Keep authenticated idle sessions alive' },
    { flag: '--help', description: 'Show help' },
    { flag: '--version', description: 'Show version' },
  ],
  subcommands: [
    { name: 'resume', description: 'Resume a session', options: [], subcommands: [] },
    { name: 'login', description: 'Authenticate with Autohand', options: [], subcommands: [] },
    { name: 'logout', description: 'Sign out of Autohand', options: [], subcommands: [] },
    {
      name: 'mcp',
      description: 'Manage MCP servers',
      options: [],
      subcommands: [
        { name: 'add', description: 'Add an MCP server', options: [], subcommands: [] },
        { name: 'remove', description: 'Remove an MCP server', options: [], subcommands: [] },
        { name: 'list', description: 'List MCP servers', options: [], subcommands: [] },
        { name: 'install', description: 'Install an MCP server', options: [], subcommands: [] },
      ],
    },
    { name: 'sessions', description: 'List sessions', options: [], subcommands: [] },
    { name: 'agents', description: 'Manage agents', options: [], subcommands: [] },
    { name: 'init', description: 'Initialize the workspace', options: [], subcommands: [] },
    { name: 'completion', description: 'Generate shell completions', options: [], subcommands: [] },
    { name: 'browser', description: 'Manage browser integration', options: [], subcommands: [] },
  ],
};

let runtimeCompletionConfig: CompletionConfig | undefined;

export function setRuntimeCompletionConfig(config: CompletionConfig): void {
  runtimeCompletionConfig = config;
}

function commanderOptionToCompletion(option: Option): CompletionOption {
  const valueMatch = option.flags.match(/[<[[]([^>\]]+)/);

  return {
    flag: option.long ?? option.short ?? option.flags,
    shortFlag: option.short && option.short !== option.long
      ? option.short
      : undefined,
    description: option.description,
    takesValue: option.required || option.optional,
    valueOptional: option.optional,
    valueName: valueMatch?.[1]?.replace(/\.\.\.$/, ''),
  };
}

function commanderCommandToCompletion(command: Command): CompletionCommand {
  const visibleCommandNames = new Set(
    command.createHelp().visibleCommands(command).map((visibleCommand) => (
      visibleCommand.name()
    )),
  );

  return {
    name: command.name(),
    description: command.description(),
    options: command.createHelp().visibleOptions(command).map(commanderOptionToCompletion),
    subcommands: command.commands
      .filter((subcommand) => visibleCommandNames.has(subcommand.name()))
      .map(commanderCommandToCompletion),
  };
}

export function createCompletionConfig(
  command: Command,
  executableNames: string[] = DEFAULT_CONFIG.commands,
): CompletionConfig {
  const root = commanderCommandToCompletion(command);

  return {
    commands: executableNames,
    slashCommands: DEFAULT_CONFIG.slashCommands,
    options: root.options,
    subcommands: root.subcommands,
  };
}

function optionFlags(options: CompletionOption[]): string[] {
  return options.flatMap((option) => (
    option.shortFlag ? [option.shortFlag, option.flag] : [option.flag]
  ));
}

function shellWordList(words: string[]): string {
  return words.join(' ');
}

function bashCommandBranches(commands: CompletionCommand[]): string {
  const branches: string[] = [];

  const visit = (command: CompletionCommand, pathParts: string[]): void => {
    const nextPath = [...pathParts, command.name];
    const conditions = nextPath
      .map((part, index) => `[[ "\${COMP_WORDS[${index + 1}]}" == "${part}" ]]`)
      .join(' && ');
    branches.push(`    elif ${conditions}; then
        active_opts="${shellWordList(optionFlags(command.options))}"
        active_subcommands="${shellWordList(command.subcommands.map(({ name }) => name))}"`);
    command.subcommands.forEach((subcommand) => visit(subcommand, nextPath));
  };

  commands.forEach((command) => visit(command, []));

  return branches
    .sort((left, right) => (
      (right.match(/COMP_WORDS/g)?.length ?? 0) - (left.match(/COMP_WORDS/g)?.length ?? 0)
    ))
    .join('\n');
}

function fileValueFlags(config: CompletionConfig): string[] {
  const flags = new Set<string>();
  const visitOptions = (options: CompletionOption[]): void => {
    for (const option of options) {
      if (
        option.takesValue
        && /(?:path|file|dir|output|config)/i.test(`${option.flag} ${option.valueName ?? ''}`)
      ) {
        flags.add(option.flag);
        if (option.shortFlag) {
          flags.add(option.shortFlag);
        }
      }
    }
  };
  const visitCommands = (commands: CompletionCommand[]): void => {
    for (const command of commands) {
      visitOptions(command.options);
      visitCommands(command.subcommands);
    }
  };

  visitOptions(config.options);
  visitCommands(config.subcommands ?? []);
  return [...flags];
}

/**
 * Generate Bash completion script
 */
export function generateBashCompletion(config: CompletionConfig = DEFAULT_CONFIG): string {
  const slashCmds = config.slashCommands.join(' ');
  const opts = shellWordList(optionFlags(config.options));
  const subcommands = shellWordList((config.subcommands ?? []).map(({ name }) => name));
  const commandBranches = bashCommandBranches(config.subcommands ?? []);
  const fileFlags = fileValueFlags(config).join('|') || '--path|--config';

  return `#!/bin/bash
# Autohand CLI Bash Completion
# Add to ~/.bashrc or ~/.bash_completion:
#   source <(autohand completion bash)
# Or save to /etc/bash_completion.d/autohand

_autohand_completions() {
    local cur prev opts slash_commands subcommands active_opts active_subcommands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    # Command line options
    opts="${opts}"

    # Subcommands
    subcommands="${subcommands}"

    # Slash commands (for interactive mode)
    slash_commands="${slashCmds}"

    active_opts="\${opts}"
    active_subcommands="\${subcommands}"
    if false; then
        :
${commandBranches}
    fi

    # Complete options
    if [[ \${cur} == -* ]]; then
        COMPREPLY=( $(compgen -W "\${active_opts}" -- "\${cur}") )
        return 0
    fi

    # Complete slash commands if input starts with /
    if [[ \${cur} == /* ]]; then
        COMPREPLY=( $(compgen -W "\${slash_commands}" -- \${cur}) )
        return 0
    fi

    # Complete files for certain options
    case "\${prev}" in
        ${fileFlags})
            COMPREPLY=( $(compgen -f -- "\${cur}") )
            return 0
            ;;
    esac

    # Complete subcommands at position 1
    if [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "\${subcommands}" -- \${cur}) )
        return 0
    fi

    if [[ -n "\${active_subcommands}" ]]; then
        COMPREPLY=( $(compgen -W "\${active_subcommands}" -- "\${cur}") )
        return 0
    fi

    # Default: complete with files
    COMPREPLY=( $(compgen -f -- "\${cur}") )
    return 0
}

complete -F _autohand_completions ${shellWordList(config.commands)}
`;
}

function escapeSingleQuotedShell(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function escapeZshDescription(value: string): string {
  return escapeSingleQuotedShell(value).replace(/[[\]]/g, '\\$&');
}

function zshOptionSpec(option: CompletionOption): string {
  const flags = option.shortFlag
    ? `{${option.shortFlag},${option.flag}}`
    : option.flag;
  const value = option.takesValue
    ? `${option.valueOptional ? '::' : ':'}${option.valueName ?? 'value'}:`
    : '';
  return `'${flags}[${escapeZshDescription(option.description)}]${value}'`;
}

function zshCommandList(commands: CompletionCommand[], indent: string): string {
  return commands
    .map(({ name, description }) => (
      `${indent}'${escapeSingleQuotedShell(name)}:${escapeZshDescription(description)}'`
    ))
    .join('\n');
}

function zshCommandCases(commands: CompletionCommand[]): string {
  return commands.map((command) => {
    const optionSpecs = command.options.map(zshOptionSpec);
    const argumentsBlock = [...optionSpecs, "'*::arg:_files'"]
      .map((line) => `                ${line} \\`)
      .join('\n')
      .replace(/ \\\s*$/, '');
    if (command.subcommands.length === 0) {
      return `        '${escapeSingleQuotedShell(command.name)}')
            _arguments -C \\
${argumentsBlock}
            ;;`;
    }

    const parentArgumentsBlock = [
      ...optionSpecs,
      "'2:subcommand:->subcommands'",
      "'*::arg:_files'",
    ]
      .map((line) => `                    ${line} \\`)
      .join('\n')
      .replace(/ \\\s*$/, '');
    const nestedCases = command.subcommands.map((subcommand) => {
      const nestedArguments = [
        ...subcommand.options.map(zshOptionSpec),
        "'*::arg:_files'",
      ]
        .map((line) => `                    ${line} \\`)
        .join('\n')
        .replace(/ \\\s*$/, '');
      return `                '${escapeSingleQuotedShell(subcommand.name)}')
                    _arguments -C \\
${nestedArguments}
                    ;;`;
    }).join('\n');

    return `        '${escapeSingleQuotedShell(command.name)}')
            case "\$words[3]" in
${nestedCases}
                *)
                    _arguments -C \\
${parentArgumentsBlock}

            if [[ "\$state" == "subcommands" ]]; then
                local -a nested_commands=(
${zshCommandList(command.subcommands, '                    ')}
                )
                _describe 'subcommands' nested_commands
            fi
                    ;;
            esac
            ;;`;
  }).join('\n');
}

/**
 * Generate Zsh completion script
 */
export function generateZshCompletion(config: CompletionConfig = DEFAULT_CONFIG): string {
  const optLines = config.options
    .map((option) => `    ${zshOptionSpec(option)}`)
    .join(' \\\n');

  const slashCmds = config.slashCommands.map((c) => `'${c}'`).join(' ');
  const subcommands = config.subcommands ?? [];
  const commandState = subcommands.length > 0
    ? "'1:command:->commands' \\\n    '*::arg:->args'"
    : "'*:file:_files'";

  return `#compdef ${config.commands.join(' ')}
# Autohand CLI Zsh Completion
# Add to ~/.zshrc:
#   source <(autohand completion zsh)
# Or save to /usr/local/share/zsh/site-functions/_autohand

_autohand() {
    local context state state_descr line
    typeset -A opt_args

    _arguments -C \\
${optLines} \\
    ${commandState}

    case "\$state" in
        commands)
            local -a commands=(
${zshCommandList(subcommands, '                ')}
            )
            _describe 'commands' commands
            ;;
        args)
            case "\$words[2]" in
${zshCommandCases(subcommands)}
            esac
            ;;
    esac

    # Handle slash command completion in interactive mode
    if [[ "\$words[CURRENT]" == /* ]]; then
        local slash_commands=(${slashCmds})
        _describe 'slash commands' slash_commands
        return
    fi
}

# Register the completion
compdef _autohand ${config.commands.join(' ')}

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
  const optionLine = (
    executable: string,
    option: CompletionOption,
    condition?: string,
  ): string => {
    const flags = [
      option.shortFlag
        ? `-s ${option.shortFlag.replace(/^-+/, '')}`
        : undefined,
      option.flag.startsWith('--')
        ? `-l ${option.flag.slice(2)}`
        : `-s ${option.flag.replace(/^-+/, '')}`,
      option.takesValue && !option.valueOptional ? '-r' : undefined,
      condition ? `-n '${condition}'` : undefined,
      `-d '${escapeSingleQuotedShell(option.description)}'`,
    ].filter((part): part is string => Boolean(part));
    return `complete -c ${executable} ${flags.join(' ')}`;
  };
  const optLines = config.options
    .map((option) => optionLine('autohand', option, '__fish_use_subcommand'))
    .join('\n');

  const subcommandLines = (config.subcommands ?? [])
    .map(({ name, description }) => (
      `complete -c autohand -n '__fish_use_subcommand' -a '${escapeSingleQuotedShell(name)}' -d '${escapeSingleQuotedShell(description)}'`
    ))
    .join('\n');
  const flattenedCommands: Array<{
    command: CompletionCommand;
    path: string[];
  }> = [];
  const visitCommands = (
    commands: CompletionCommand[],
    parentPath: string[] = [],
  ): void => {
    for (const command of commands) {
      const commandPath = [...parentPath, command.name];
      flattenedCommands.push({ command, path: commandPath });
      visitCommands(command.subcommands, commandPath);
    }
  };
  visitCommands(config.subcommands ?? []);
  const commandOptionLines = flattenedCommands
    .flatMap(({ command, path: commandPath }) => command.options.map((option) => (
      optionLine(
        'autohand',
        option,
        commandPath
          .map((commandName) => `__fish_seen_subcommand_from ${commandName}`)
          .join('; and '),
      )
    )))
    .join('\n');
  const nestedCommandLines = (config.subcommands ?? [])
    .flatMap((command) => command.subcommands.map(({ name, description }) => (
      `complete -c autohand -n '__fish_seen_subcommand_from ${command.name}' -a '${escapeSingleQuotedShell(name)}' -d '${escapeSingleQuotedShell(description)}'`
    )))
    .join('\n');
  const slashLines = config.slashCommands
    .map((command) => (
      `complete -c autohand -a '${escapeSingleQuotedShell(command)}' -d 'Slash command'`
    ))
    .join('\n');
  const aliasLines = config.commands
    .filter((command) => command !== 'autohand')
    .map((command) => `complete -c ${command} -w autohand`)
    .join('\n');

  return `# Autohand CLI Fish Completion
# Save to ~/.config/fish/completions/autohand.fish
# Or run: autohand completion fish > ~/.config/fish/completions/autohand.fish

# Disable file completion by default
complete -c autohand -f

# Options
${optLines}

# Subcommands
${subcommandLines}

# Subcommand options
${commandOptionLines}

# Nested subcommands
${nestedCommandLines}

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

# Executable aliases
${aliasLines}
`;
}

/**
 * Generate completion script for specified shell
 */
export function generateCompletion(shell: ShellType, config?: CompletionConfig): string {
  const cfg = config ?? runtimeCompletionConfig ?? DEFAULT_CONFIG;

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
