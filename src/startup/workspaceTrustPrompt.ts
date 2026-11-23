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
import { formatList, t, tPlural } from '../i18n/index.js';

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


/** For example "2 project hooks and 1 MCP server" or "1 project tool file". */
export function describeWorkspaceTrustEntries(trust: WorkspaceTrustState): string {
  const parts: string[] = [];
  if (trust.hooks.length > 0) {
    parts.push(tPlural('startup.workspaceTrust.projectHooks', trust.hooks.length));
  }
  if (trust.mcpServers.length > 0) {
    parts.push(tPlural('startup.workspaceTrust.mcpServers', trust.mcpServers.length));
  }
  const tools = trust.tools ?? [];
  if (tools.length > 0) {
    parts.push(tPlural('startup.workspaceTrust.projectToolFiles', tools.length));
  }
  return formatList(parts);
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
    lines.push('', t('startup.workspaceTrust.hooksHeading'), ...formatRows(trust.hooks.map((hook) => [String(hook.event), hook.command])));
  }
  if (trust.mcpServers.length > 0) {
    lines.push(
      '',
      t('startup.workspaceTrust.mcpServersHeading'),
      ...formatRows(trust.mcpServers.map((server) => [server.name, describeServerLaunch(server)])),
    );
  }
  const tools = trust.tools ?? [];
  if (tools.length > 0) {
    lines.push('', t('startup.workspaceTrust.projectToolsHeading', { count: tools.length }), ...tools.map((tool) => `  ${tool.file}`));
  }
  return lines.join('\n');
}

export function workspaceTrustModalOptions(trust: WorkspaceTrustState): Pick<ShowModalOptions, 'title' | 'options'> {
  return {
    title: [
      t('startup.workspaceTrust.intro'),
      '',
      formatWorkspaceTrustSummary(trust),
      '',
      t('startup.workspaceTrust.warning'),
    ].join('\n'),
    options: [
      {
        label: t('startup.workspaceTrust.trust'),
        value: 'trust',
        description: t('startup.workspaceTrust.trustDescription'),
      },
      {
        label: t('startup.workspaceTrust.skip'),
        value: 'skip',
        description: t('startup.workspaceTrust.skipDescription'),
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
      `${t('startup.workspaceTrust.skippedUntrusted', { entries, path: trust.workspaceRoot })}\n`,
    );
    return 'skipped';
  }

  const choice = await (options.prompt ?? promptWithModal)(trust);
  if (choice === 'trust') {
    await trustWorkspace(trust.workspaceRoot, trust.fingerprint, options.storePath);
    applyTrustedWorkspaceEntries(config);
    return 'trusted';
  }

  write(`${t('startup.workspaceTrust.startedWithout', { entries, path: trust.workspaceRoot })}\n`);
  return 'skipped';
}
