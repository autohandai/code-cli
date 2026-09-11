/**
 * Startup decision for project hooks and MCP servers that `loadConfig` held
 * back because the workspace is not trusted for their current content.
 *
 * A person at the terminal is asked once per content fingerprint. Runs nobody
 * can answer skip the entries and print a warning.
 *
 * @license Apache-2.0
 */
import { applyTrustedWorkspaceEntries } from '../config.js';
import { trustWorkspace } from '../permissions/workspaceTrust.js';
import type { LoadedConfig, McpServerConfigEntry, WorkspaceTrustState } from '../types.js';
import type { ShowModalOptions } from '../ui/ink/components/Modal.js';

export type WorkspaceTrustChoice = 'trust' | 'skip';
export type WorkspaceTrustOutcome = 'not-needed' | 'trusted' | 'skipped';

export interface ResolveWorkspaceTrustOptions {
  /** True when a person can answer a prompt in this terminal. */
  interactive: boolean;
  /** Ask the user. Resolves to null when the prompt is cancelled. Defaults to the Ink modal. */
  prompt?: (trust: WorkspaceTrustState) => Promise<WorkspaceTrustChoice | null>;
  /** Where notices are written. Defaults to stderr so structured stdout stays clean. */
  write?: (message: string) => void;
  /** Trust store location. Defaults to the user's Autohand home. */
  storePath?: string;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** For example "2 project hooks and 1 MCP server". */
export function describeWorkspaceTrustEntries(trust: WorkspaceTrustState): string {
  const parts: string[] = [];
  if (trust.hooks.length > 0) {
    parts.push(countLabel(trust.hooks.length, 'project hook', 'project hooks'));
  }
  if (trust.mcpServers.length > 0) {
    parts.push(countLabel(trust.mcpServers.length, 'MCP server', 'MCP servers'));
  }
  return parts.join(' and ');
}

function describeServerLaunch(server: McpServerConfigEntry): string {
  if (server.transport === 'stdio') {
    return [server.command, ...(server.args ?? [])].filter(Boolean).join(' ');
  }
  return server.url ?? '';
}

function formatRows(rows: Array<[string, string]>): string[] {
  const width = Math.max(...rows.map(([name]) => name.length));
  return rows.map(([name, detail]) => `  ${name.padEnd(width)}  ${detail}`);
}

/** Every command a trusted workspace would run, shown in full for review. */
export function formatWorkspaceTrustSummary(trust: WorkspaceTrustState): string {
  const lines = [trust.workspaceRoot];
  if (trust.hooks.length > 0) {
    lines.push('', 'Hooks', ...formatRows(trust.hooks.map((hook) => [String(hook.event), hook.command])));
  }
  if (trust.mcpServers.length > 0) {
    lines.push(
      '',
      'MCP servers',
      ...formatRows(trust.mcpServers.map((server) => [server.name, describeServerLaunch(server)])),
    );
  }
  return lines.join('\n');
}

export function workspaceTrustModalOptions(trust: WorkspaceTrustState): Pick<ShowModalOptions, 'title' | 'options'> {
  return {
    title: [
      'This workspace wants to run commands from its .autohand project files.',
      '',
      formatWorkspaceTrustSummary(trust),
      '',
      'Only trust workspaces whose files you have reviewed.',
    ].join('\n'),
    options: [
      {
        label: 'Trust this workspace',
        value: 'trust',
        description: 'Run these now and in later sessions. Autohand asks again if they change.',
      },
      {
        label: 'Not now',
        value: 'skip',
        description: 'Start without them. Autohand asks again next time.',
      },
    ],
  };
}

async function promptWithModal(trust: WorkspaceTrustState): Promise<WorkspaceTrustChoice | null> {
  const { showModal } = await import('../ui/ink/components/Modal.js');
  const choice = await showModal(workspaceTrustModalOptions(trust));
  if (!choice) return null;
  return choice.value === 'trust' ? 'trust' : 'skip';
}

export async function resolveWorkspaceTrust(
  config: LoadedConfig,
  options: ResolveWorkspaceTrustOptions,
): Promise<WorkspaceTrustOutcome> {
  const trust = config.workspaceTrust;
  if (!trust || trust.trusted) {
    return 'not-needed';
  }

  const write = options.write ?? ((message: string) => { process.stderr.write(message); });
  const entries = describeWorkspaceTrustEntries(trust);

  if (!options.interactive) {
    write(
      `Skipped ${entries} from ${trust.workspaceRoot} because this workspace is not trusted. ` +
        'Run autohand in that folder interactively to review and trust them.\n',
    );
    return 'skipped';
  }

  const choice = await (options.prompt ?? promptWithModal)(trust);
  if (choice === 'trust') {
    await trustWorkspace(trust.workspaceRoot, trust.fingerprint, options.storePath);
    applyTrustedWorkspaceEntries(config);
    return 'trusted';
  }

  write(`Started without ${entries} from ${trust.workspaceRoot}. Autohand will ask again next time.\n`);
  return 'skipped';
}
