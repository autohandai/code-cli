/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from '../constants.js';
import { AgentRegistry } from '../core/agents/AgentRegistry.js';
import { createToolsRegistry } from '../core/toolsRegistry.js';
import { ExtensionService } from './ExtensionService.js';
import type {
  ExtensionAgentContribution,
  ExtensionScope,
  ExtensionSnapshot,
  ExtensionToolContribution,
  LoadedExtension,
} from './types.js';

export interface ExtensionsCommandContext {
  service: ExtensionService;
  stdinIsTTY?: boolean;
  confirmRemoval?: (extension: LoadedExtension) => Promise<boolean>;
}

export interface ExtensionsCommandResult {
  code: number;
  output: string;
  mutated: boolean;
}

interface ParsedArguments {
  positional: string[];
  json: boolean;
  yes: boolean;
  link: boolean;
  replace: boolean;
  scope?: ExtensionScope;
}

const EXTENSIONS_USAGE = [
  'Usage: autohand extensions <command>',
  '',
  'Commands:',
  '  extensions list [--json] [--scope user|project]',
  '  extensions show <id> [--json] [--scope user|project]',
  '  extensions validate <path> [--json]',
  '  extensions install <path> [--scope user|project] [--link] [--replace]',
  '  extensions enable <id> [--scope user|project]',
  '  extensions disable <id> [--scope user|project]',
  '  extensions remove <id> [--scope user|project] [--yes]',
  '  extensions doctor [--json]',
].join('\n');

function parseArguments(args: string[]): ParsedArguments {
  const parsed: ParsedArguments = {
    positional: [],
    json: false,
    yes: false,
    link: false,
    replace: false,
  };

  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    switch (value) {
      case '--json':
        parsed.json = true;
        break;
      case '--yes':
        parsed.yes = true;
        break;
      case '--link':
        parsed.link = true;
        break;
      case '--replace':
        parsed.replace = true;
        break;
      case '--scope': {
        const scope = args[index + 1];
        if (scope !== 'user' && scope !== 'project') {
          throw new Error(`Invalid scope "${scope ?? ''}". Use user or project.`);
        }
        parsed.scope = scope;
        index++;
        break;
      }
      default:
        if (value.startsWith('--')) {
          throw new Error(`Unknown option "${value}"`);
        }
        parsed.positional.push(value);
    }
  }
  return parsed;
}

function requirePositional(parsed: ParsedArguments, index: number, label: string): string {
  const value = parsed.positional[index];
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function contributionNames<T extends ExtensionToolContribution | ExtensionAgentContribution>(
  contributions: T[],
  extensionId: string,
  getName: (contribution: T) => string,
): string[] {
  return contributions
    .filter((contribution) => contribution.provenance.extensionId === extensionId)
    .map(getName);
}

function extensionJson(extension: LoadedExtension, snapshot: ExtensionSnapshot) {
  return {
    id: extension.manifest.id,
    name: extension.manifest.name,
    version: extension.manifest.version,
    description: extension.manifest.description,
    scope: extension.scope,
    disabled: extension.disabled,
    linked: extension.linked,
    root: extension.root,
    tools: contributionNames(snapshot.tools, extension.manifest.id, (tool) => tool.definition.name),
    agents: contributionNames(snapshot.agents, extension.manifest.id, (agent) => agent.name),
  };
}

function extensionDetail(extension: LoadedExtension, snapshot: ExtensionSnapshot): string {
  const value = extensionJson(extension, snapshot);
  return [
    `${value.id}@${value.version}`,
    value.description,
    `Scope: ${value.scope}`,
    `State: ${value.disabled ? 'disabled' : 'enabled'}${value.linked ? ' (linked)' : ''}`,
    `Tools: ${value.tools.join(', ') || 'none'}`,
    `Agents: ${value.agents.join(', ') || 'none'}`,
    `Root: ${value.root}`,
  ].join('\n');
}

function mutationResult(output: string, code = 0): ExtensionsCommandResult {
  return { code, output, mutated: code === 0 };
}

function readResult(output: string, code = 0): ExtensionsCommandResult {
  return { code, output, mutated: false };
}

function assertAllowedOptions(
  parsed: ParsedArguments,
  allowed: Array<'json' | 'yes' | 'link' | 'replace' | 'scope'>,
): void {
  const used: Array<['json' | 'yes' | 'link' | 'replace' | 'scope', boolean]> = [
    ['json', parsed.json],
    ['yes', parsed.yes],
    ['link', parsed.link],
    ['replace', parsed.replace],
    ['scope', parsed.scope !== undefined],
  ];
  const unsupported = used.find(([name, active]) => active && !allowed.includes(name));
  if (unsupported) {
    throw new Error(`Option --${unsupported[0]} is not valid for this command`);
  }
}

export async function runExtensionsCommand(
  context: ExtensionsCommandContext,
  args: string[],
): Promise<ExtensionsCommandResult> {
  try {
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
      return readResult(EXTENSIONS_USAGE);
    }

    const action = args[0].toLowerCase();
    const parsed = parseArguments(args.slice(1));
    switch (action) {
      case 'list': {
        assertAllowedOptions(parsed, ['json', 'scope']);
        const snapshot = await context.service.list();
        const extensions = snapshot.extensions.filter((extension) =>
          !parsed.scope || extension.scope === parsed.scope);
        if (parsed.json) {
          return readResult(JSON.stringify({
            extensions: extensions.map((extension) => extensionJson(extension, snapshot)),
            diagnostics: snapshot.diagnostics,
          }, null, 2));
        }
        if (extensions.length === 0) {
          return readResult('No extensions installed.');
        }
        return readResult(extensions.map((extension) => [
          extension.manifest.id,
          extension.manifest.version,
          extension.scope,
          extension.disabled ? 'disabled' : 'enabled',
          extension.linked ? 'linked' : 'copied',
        ].join('  ')).join('\n'));
      }
      case 'show': {
        assertAllowedOptions(parsed, ['json', 'scope']);
        const id = requirePositional(parsed, 0, 'Extension id');
        const snapshot = await context.service.list();
        const extension = snapshot.extensions.find((candidate) =>
          candidate.manifest.id === id && (!parsed.scope || candidate.scope === parsed.scope));
        if (!extension) {
          return readResult(`Extension "${id}" is not installed.`, 1);
        }
        return readResult(parsed.json
          ? JSON.stringify(extensionJson(extension, snapshot), null, 2)
          : extensionDetail(extension, snapshot));
      }
      case 'validate': {
        assertAllowedOptions(parsed, ['json']);
        const sourcePath = requirePositional(parsed, 0, 'Extension path');
        const validation = await context.service.validate(sourcePath);
        const payload = {
          valid: true,
          id: validation.extension.manifest.id,
          version: validation.extension.manifest.version,
          tools: validation.tools.map((tool) => tool.definition.name),
          agents: validation.agents.map((agent) => agent.name),
        };
        return readResult(parsed.json
          ? JSON.stringify(payload, null, 2)
          : `Valid extension ${payload.id}@${payload.version} (${payload.tools.length} tools, ${payload.agents.length} agents)`);
      }
      case 'install': {
        assertAllowedOptions(parsed, ['scope', 'link', 'replace']);
        const sourcePath = requirePositional(parsed, 0, 'Extension path');
        const result = await context.service.install(sourcePath, {
          scope: parsed.scope,
          link: parsed.link,
          replace: parsed.replace,
        });
        const verb = result.status === 'existing'
          ? 'Already installed'
          : result.status === 'replaced'
            ? 'Replaced'
            : 'Installed';
        return {
          code: 0,
          output: `${verb} ${result.extension.manifest.id}@${result.extension.manifest.version}`,
          mutated: result.status !== 'existing',
        };
      }
      case 'enable':
      case 'disable': {
        assertAllowedOptions(parsed, ['scope']);
        const id = requirePositional(parsed, 0, 'Extension id');
        const enabled = action === 'enable';
        await context.service.setEnabled(id, enabled, { scope: parsed.scope });
        return mutationResult(`${enabled ? 'Enabled' : 'Disabled'} ${id}`);
      }
      case 'remove': {
        assertAllowedOptions(parsed, ['scope', 'yes']);
        const id = requirePositional(parsed, 0, 'Extension id');
        if (!parsed.yes) {
          if (context.stdinIsTTY === false || !context.confirmRemoval) {
            return readResult('Extension removal requires --yes in non-interactive mode.', 1);
          }
          const extension = await context.service.show(id, { scope: parsed.scope });
          if (!extension) {
            return readResult(`Extension "${id}" is not installed.`, 1);
          }
          if (!await context.confirmRemoval(extension)) {
            return readResult('Extension removal cancelled.', 1);
          }
        }
        await context.service.remove(id, { scope: parsed.scope });
        return mutationResult(`Removed ${id}`);
      }
      case 'doctor': {
        assertAllowedOptions(parsed, ['json']);
        const report = await context.service.doctor();
        if (parsed.json) {
          return readResult(JSON.stringify(report, null, 2), report.healthy ? 0 : 1);
        }
        if (report.healthy) {
          return readResult(`Extension diagnostics: healthy (${report.extensions} installed)`);
        }
        return readResult([
          `Extension diagnostics: ${report.diagnostics.length} issue${report.diagnostics.length === 1 ? '' : 's'}`,
          ...report.diagnostics.map((diagnostic) =>
            `${diagnostic.code}: ${diagnostic.extensionId ? `${diagnostic.extensionId}: ` : ''}${diagnostic.message}`),
        ].join('\n'), 1);
      }
      default:
        return readResult(`Unknown extensions command "${action}".\n\n${EXTENSIONS_USAGE}`, 1);
    }
  } catch (error) {
    return readResult(error instanceof Error ? error.message : String(error), 1);
  }
}

export function extensionsUsage(): string {
  return EXTENSIONS_USAGE;
}

async function confirmRemoval(extension: LoadedExtension): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Remove ${extension.manifest.id}@${extension.manifest.version}? [y/N] `);
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } finally {
    prompt.close();
  }
}

async function extensionServiceFor(program: Command): Promise<ExtensionService> {
  const rootOptions = program.opts<{ path?: string; config?: string }>();
  const workspaceRoot = path.resolve(rootOptions.path ?? process.cwd());
  const config = await loadConfig(rootOptions.config, workspaceRoot);
  const pluginDir = (config as typeof config & { pluginDir?: string }).pluginDir;
  const toolsRegistry = createToolsRegistry(workspaceRoot, pluginDir ?? AUTOHAND_PATHS.tools);
  await toolsRegistry.initialize();
  const agentRegistry = AgentRegistry.getInstance();
  agentRegistry.configureExternalAgents(config.externalAgents);
  await agentRegistry.loadAgents();
  return new ExtensionService({
    projectRoot: path.join(workspaceRoot, PROJECT_DIR_NAME, 'extensions'),
    loadOptions: () => ({
      reservedToolNames: toolsRegistry
        .listMetaTools({ includeDisabled: true })
        .map((tool) => tool.name),
      reservedAgentNames: agentRegistry
        .getAllAgents()
        .filter((agent) => agent.source !== 'extension')
        .map((agent) => agent.name),
    }),
  });
}

async function executeRegisteredCommand(program: Command, args: string[]): Promise<void> {
  const result = await runExtensionsCommand({
    service: await extensionServiceFor(program),
    stdinIsTTY: process.stdin.isTTY === true,
    confirmRemoval,
  }, args);
  const writer = result.code === 0 ? console.log : console.error;
  writer(result.output);
  process.exitCode = result.code;
}

function withScope(args: string[], scope?: string): string[] {
  return scope ? [...args, '--scope', scope] : args;
}

export function registerExtensionsCommand(program: Command): void {
  const extensions = program
    .command('extensions')
    .description('Validate, install, inspect, and manage Autohand Code extensions')
    .action(async () => executeRegisteredCommand(program, []));

  extensions
    .command('list')
    .description('List installed extensions')
    .option('--json', 'Emit machine-readable JSON', false)
    .option('--scope <scope>', 'Filter by user or project scope')
    .action(async (options: { json?: boolean; scope?: string }) => executeRegisteredCommand(
      program,
      withScope(['list', ...(options.json ? ['--json'] : [])], options.scope),
    ));

  extensions
    .command('show <id>')
    .description('Show one installed extension and its contributions')
    .option('--json', 'Emit machine-readable JSON', false)
    .option('--scope <scope>', 'Select user or project scope')
    .action(async (id: string, options: { json?: boolean; scope?: string }) => executeRegisteredCommand(
      program,
      withScope(['show', id, ...(options.json ? ['--json'] : [])], options.scope),
    ));

  extensions
    .command('validate <path>')
    .description('Validate an extension package without installing it')
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (sourcePath: string, options: { json?: boolean }) => executeRegisteredCommand(
      program,
      ['validate', sourcePath, ...(options.json ? ['--json'] : [])],
    ));

  extensions
    .command('install <path>')
    .description('Install an extension from a local directory')
    .option('--scope <scope>', 'Install at user or project scope', 'user')
    .option('--link', 'Link the source directory for extension development', false)
    .option('--replace', 'Atomically replace different installed content', false)
    .action(async (
      sourcePath: string,
      options: { scope?: string; link?: boolean; replace?: boolean },
    ) => executeRegisteredCommand(program, withScope([
      'install',
      sourcePath,
      ...(options.link ? ['--link'] : []),
      ...(options.replace ? ['--replace'] : []),
    ], options.scope)));

  for (const action of ['enable', 'disable'] as const) {
    extensions
      .command(`${action} <id>`)
      .description(`${action === 'enable' ? 'Enable' : 'Disable'} an installed extension`)
      .option('--scope <scope>', 'Select user or project scope', 'user')
      .action(async (id: string, options: { scope?: string }) => executeRegisteredCommand(
        program,
        withScope([action, id], options.scope),
      ));
  }

  extensions
    .command('remove <id>')
    .alias('uninstall')
    .description('Remove an installed extension')
    .option('--scope <scope>', 'Select user or project scope', 'user')
    .option('--yes', 'Confirm removal without prompting', false)
    .action(async (id: string, options: { scope?: string; yes?: boolean }) => {
      const globallyConfirmed = program.opts<{ yes?: boolean }>().yes === true;
      await executeRegisteredCommand(
        program,
        withScope(['remove', id, ...(options.yes || globallyConfirmed ? ['--yes'] : [])], options.scope),
      );
    });

  extensions
    .command('doctor')
    .description('Diagnose installed extension packages')
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (options: { json?: boolean }) => executeRegisteredCommand(
      program,
      ['doctor', ...(options.json ? ['--json'] : [])],
    ));
}
