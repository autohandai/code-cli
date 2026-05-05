/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolsRegistry } from '../core/toolsRegistry.js';

export interface ToolsCommandContext {
  toolsRegistry?: ToolsRegistry;
}

function renderUsage(): string {
  return [
    'Usage: /tools [list|show|doctor|disable|enable|rename|delete]',
    '',
    'Commands:',
    '  /tools list',
    '  /tools show <name>',
    '  /tools doctor',
    '  /tools disable <name>',
    '  /tools enable <name>',
    '  /tools rename <name> <new_name>',
    '  /tools delete <name>',
  ].join('\n');
}

function renderToolList(registry: ToolsRegistry): string {
  const tools = registry.listMetaTools({ includeDisabled: true });
  if (tools.length === 0) {
    return 'No meta-tools are installed.';
  }
  return tools
    .map((tool) => {
      const state = tool.disabled ? 'disabled' : 'enabled';
      return `${tool.name}  ${tool.scope}  ${state}  ${tool.description}`;
    })
    .join('\n');
}

function renderTool(registry: ToolsRegistry, name: string): string {
  const tool = registry.listMetaTools({ includeDisabled: true }).find((candidate) => candidate.name === name);
  if (!tool) {
    return `Meta-tool "${name}" not found.`;
  }
  return [
    `${tool.name}`,
    `Description: ${tool.description}`,
    `Scope: ${tool.scope}`,
    `State: ${tool.disabled ? 'disabled' : 'enabled'}`,
    `Source: ${tool.source}`,
    `Created: ${tool.createdAt}`,
    `Updated: ${tool.updatedAt ?? tool.createdAt}`,
    `Handler: ${tool.handler}`,
    `Parameters: ${JSON.stringify(tool.parameters, null, 2)}`,
  ].join('\n');
}

function renderDiagnostics(registry: ToolsRegistry): string {
  const diagnostics = registry.getDiagnostics();
  if (diagnostics.length === 0) {
    return 'No meta-tool diagnostics.';
  }
  return diagnostics.map((diagnostic) => `${diagnostic.file}: ${diagnostic.reason}`).join('\n');
}

export async function tools(ctx: ToolsCommandContext, args: string[] = []): Promise<string> {
  const registry = ctx.toolsRegistry;
  if (!registry) {
    return 'Tools registry not available.';
  }

  const subcommand = (args[0] ?? 'list').toLowerCase();
  switch (subcommand) {
    case 'list':
    case 'ls':
      return renderToolList(registry);
    case 'show':
    case 'inspect': {
      const name = args[1];
      return name ? renderTool(registry, name) : renderUsage();
    }
    case 'doctor':
    case 'diagnostics':
      return renderDiagnostics(registry);
    case 'disable': {
      const name = args[1];
      if (!name) return renderUsage();
      await registry.setMetaToolDisabled(name, true);
      return `Disabled ${name}`;
    }
    case 'enable': {
      const name = args[1];
      if (!name) return renderUsage();
      await registry.setMetaToolDisabled(name, false);
      return `Enabled ${name}`;
    }
    case 'rename': {
      const [name, newName] = args.slice(1);
      if (!name || !newName) return renderUsage();
      await registry.renameMetaTool(name, newName);
      return `Renamed ${name} to ${newName}`;
    }
    case 'delete':
    case 'remove':
    case 'rm': {
      const name = args[1];
      if (!name) return renderUsage();
      await registry.deleteMetaTool(name);
      return `Deleted ${name}`;
    }
    default:
      return renderUsage();
  }
}

export const metadata = {
  command: '/tools',
  description: 'List, inspect, disable, rename, or delete persisted meta-tools',
  implemented: true,
  subcommands: [
    { name: 'list', description: 'List installed meta-tools' },
    { name: 'show', description: 'Show one meta-tool definition' },
    { name: 'doctor', description: 'Show skipped or invalid meta-tool diagnostics' },
    { name: 'disable', description: 'Disable a meta-tool without deleting it' },
    { name: 'enable', description: 'Re-enable a disabled meta-tool' },
    { name: 'rename', description: 'Rename a persisted meta-tool' },
    { name: 'delete', description: 'Delete a persisted meta-tool' },
  ],
};
