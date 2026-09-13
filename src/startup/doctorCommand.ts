/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `autohand doctor`: one place that says whether this installation can run.
 * Every probe is injected so the command is testable without a network,
 * a terminal, or a real MCP server.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import path from 'node:path';
import type { LoadedConfig } from '../types.js';
import type { StartupCheckResults } from './checks.js';
import type { McpServerConfig } from '../mcp/types.js';

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorItem {
  name: string;
  status: DoctorStatus;
  detail: string;
  hint?: string;
}

export interface DoctorSection {
  title: string;
  items: DoctorItem[];
}

export interface DoctorReport {
  ok: boolean;
  version: string;
  sections: DoctorSection[];
}

export interface McpProbeResult {
  name: string;
  ok: boolean;
  toolCount?: number;
  error?: string;
}

export interface DoctorProbes {
  version(): string;
  loadConfig(configPath: string | undefined, workspaceRoot: string): Promise<LoadedConfig>;
  runStartupChecks(workspaceRoot: string): Promise<StartupCheckResults>;
  loadNodePty(): Promise<unknown | null>;
  checkAuthenticated(config: LoadedConfig): Promise<boolean>;
  /** Same resolver startup uses, so custom and extension providers are found. */
  getProviderConfig(config: LoadedConfig, provider: string): { model?: string } | null | undefined;
  probeMcpServers(servers: McpServerConfig[]): Promise<McpProbeResult[]>;
  extensionDoctor(workspaceRoot: string): Promise<{ healthy: boolean; extensions: number; diagnostics: Array<{ code: string; message: string; extensionId?: string }> }>;
  runtime?: { node: string; bun?: string; platform: string; execPath: string };
}

export interface DoctorOptions {
  config?: string;
  path?: string;
  json?: boolean;
  /** Skip MCP server connections (they can take seconds each). */
  skipMcp?: boolean;
}

const MCP_PROBE_TIMEOUT_MS = 5_000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runDoctor(probes: DoctorProbes, options: DoctorOptions = {}): Promise<DoctorReport> {
  const workspaceRoot = path.resolve(options.path ?? process.cwd());
  const sections: DoctorSection[] = [];
  const runtime = probes.runtime ?? {
    node: process.versions.node,
    bun: (process.versions as { bun?: string }).bun,
    platform: `${process.platform} ${process.arch}`,
    execPath: process.execPath,
  };

  sections.push({ title: 'Runtime', items: [
    { name: 'Autohand', status: 'ok', detail: probes.version() },
    { name: 'Executable', status: 'ok', detail: runtime.execPath },
    { name: runtime.bun ? 'Bun' : 'Node.js', status: 'ok', detail: runtime.bun ?? runtime.node },
    { name: 'Platform', status: 'ok', detail: runtime.platform },
  ] });

  let config: LoadedConfig | null = null;
  const configItems: DoctorItem[] = [];
  try {
    config = await probes.loadConfig(options.config, workspaceRoot);
    const provider = config.provider ?? 'openrouter';
    const providerSettings = probes.getProviderConfig(config, provider);
    configItems.push({ name: 'Config file', status: 'ok', detail: config.configPath });
    configItems.push({ name: 'Provider', status: 'ok', detail: `${provider}${providerSettings?.model ? ` · ${providerSettings.model}` : ''}` });
    if (!providerSettings) {
      configItems.push({ name: 'Provider settings', status: 'fail', detail: `No settings for provider "${provider}"`, hint: 'Run autohand --setup or add the provider section to the config.' });
    }
  } catch (error) {
    configItems.push({ name: 'Config file', status: 'fail', detail: errorText(error), hint: 'Fix the file or run autohand --setup.' });
  }
  sections.push({ title: 'Configuration', items: configItems });

  try {
    const checks = await probes.runStartupChecks(workspaceRoot);
    sections.push({ title: 'Tools', items: checks.tools.map((tool) => ({
      name: tool.name,
      status: tool.installed ? 'ok' : tool.required ? 'fail' : 'warn',
      detail: tool.installed ? (tool.version ?? 'installed') : `missing (${tool.required ? 'required' : 'optional'})`,
      ...(tool.installed || !tool.installHint ? {} : { hint: tool.installHint }),
    })) });
    sections.push({ title: 'Workspace', items: [
      { name: 'Path', status: 'ok', detail: checks.workspace.path },
      { name: 'Writable', status: checks.workspace.writable ? 'ok' : 'fail', detail: checks.workspace.writable ? 'yes' : (checks.workspace.error ?? 'no') },
      { name: 'Git', status: 'ok', detail: checks.workspace.isGitRepo ? `repository${checks.workspace.branch ? ` on ${checks.workspace.branch}` : ''}` : 'not a repository' },
    ] });
  } catch (error) {
    sections.push({ title: 'Tools', items: [{ name: 'Startup checks', status: 'fail', detail: errorText(error) }] });
  }

  const ptyItems: DoctorItem[] = [];
  if (runtime.bun) {
    ptyItems.push({ name: 'node-pty', status: 'warn', detail: 'not used under Bun; shell commands run without a PTY' });
  } else {
    try {
      const pty = await probes.loadNodePty();
      ptyItems.push(pty ? { name: 'node-pty', status: 'ok', detail: 'loaded' } : { name: 'node-pty', status: 'warn', detail: 'unavailable; interactive commands fall back to pipes', hint: 'Reinstall Autohand to rebuild the native helper.' });
    } catch (error) {
      ptyItems.push({ name: 'node-pty', status: 'warn', detail: errorText(error) });
    }
  }
  sections.push({ title: 'Terminal', items: ptyItems });

  if (config) {
    // Startup requires an Autohand login whatever the inference provider is.
    const authItems: DoctorItem[] = [];
    try {
      const authenticated = await probes.checkAuthenticated(config);
      authItems.push(authenticated
        ? { name: 'Autohand account', status: 'ok', detail: config.auth?.user?.email ? `signed in as ${config.auth.user.email}` : 'signed in' }
        : { name: 'Autohand account', status: 'fail', detail: config.auth?.token ? 'session expired' : 'not signed in', hint: 'Run autohand login.' });
    } catch (error) {
      authItems.push({ name: 'Autohand account', status: 'warn', detail: errorText(error) });
    }
    sections.push({ title: 'Authentication', items: authItems });

    const servers = config.mcp?.servers ?? [];
    if (servers.length === 0) {
      sections.push({ title: 'MCP servers', items: [{ name: 'Configured', status: 'ok', detail: 'none' }] });
    } else if (options.skipMcp) {
      sections.push({ title: 'MCP servers', items: servers.map((server) => ({ name: server.name, status: 'ok' as const, detail: 'configured (connection skipped)' })) });
    } else {
      try {
        const results = await probes.probeMcpServers(servers);
        sections.push({ title: 'MCP servers', items: results.map((result) => (result.ok
          ? { name: result.name, status: 'ok' as const, detail: `connected · ${result.toolCount ?? 0} tools` }
          : { name: result.name, status: 'fail' as const, detail: result.error ?? 'connection failed', hint: 'Check the command, URL, or credentials with autohand mcp connect <name>.' }
        )) });
      } catch (error) {
        sections.push({ title: 'MCP servers', items: [{ name: 'Probe', status: 'fail', detail: errorText(error) }] });
      }
    }
  }

  try {
    const report = await probes.extensionDoctor(workspaceRoot);
    sections.push({ title: 'Extensions', items: report.healthy
      ? [{ name: 'Installed', status: 'ok', detail: `${report.extensions} healthy` }]
      : report.diagnostics.map((diagnostic) => ({ name: diagnostic.extensionId ?? diagnostic.code, status: 'warn' as const, detail: `${diagnostic.code}: ${diagnostic.message}` })) });
  } catch (error) {
    sections.push({ title: 'Extensions', items: [{ name: 'Diagnostics', status: 'warn', detail: errorText(error) }] });
  }

  const ok = sections.every((section) => section.items.every((item) => item.status !== 'fail'));
  return { ok, version: probes.version(), sections };
}

const STATUS_MARK: Record<DoctorStatus, string> = { ok: chalk.green('✓'), warn: chalk.yellow('!'), fail: chalk.red('✗') };

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [chalk.bold.cyan('Autohand doctor'), ''];
  for (const section of report.sections) {
    lines.push(chalk.bold(section.title));
    for (const item of section.items) {
      lines.push(`  ${STATUS_MARK[item.status]} ${item.name}: ${item.detail}`);
      if (item.hint) lines.push(chalk.gray(`      ${item.hint}`));
    }
    lines.push('');
  }
  const failures = report.sections.flatMap((section) => section.items).filter((item) => item.status === 'fail').length;
  const warnings = report.sections.flatMap((section) => section.items).filter((item) => item.status === 'warn').length;
  lines.push(report.ok
    ? chalk.green(`Ready${warnings ? ` with ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}.`)
    : chalk.red(`${failures} problem${failures === 1 ? '' : 's'} need attention${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}.`));
  return lines.join('\n');
}

export function registerDoctorCommand(program: Command, probes: DoctorProbes): Command {
  return program.command('doctor')
    .description('Check the installation: runtime, config, tools, terminal, account, MCP servers, and extensions')
    .option('--json', 'Print the report as JSON', false)
    .option('--skip-mcp', 'Do not connect to configured MCP servers', false)
    .option('--path <path>', 'Workspace to check')
    .option('--config <path>', 'Path to the Autohand config file')
    .action(async (_options: DoctorOptions, command: Command) => {
      const options = command.optsWithGlobals<DoctorOptions & { skipMcp?: boolean }>();
      const report = await runDoctor(probes, { config: options.config, path: options.path, skipMcp: options.skipMcp });
      console.log(options.json ? JSON.stringify(report, null, 2) : formatDoctorReport(report));
      process.exitCode = report.ok ? 0 : 1;
    });
}

/** Connects to each server with a bounded wait and reports what it found. */
export async function probeMcpServersWithManager(
  servers: McpServerConfig[],
  createManager: () => { connect(config: McpServerConfig): Promise<void>; listServers(): Array<{ name: string; status: string; toolCount: number; error?: string }>; disconnectAll(): Promise<void> },
  timeoutMs = MCP_PROBE_TIMEOUT_MS,
): Promise<McpProbeResult[]> {
  const manager = createManager();
  try {
    const results: McpProbeResult[] = [];
    for (const server of servers) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          manager.connect(server),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no response within ${timeoutMs} ms`)), timeoutMs); }),
        ]);
        const state = manager.listServers().find((entry) => entry.name === server.name);
        results.push(state?.status === 'connected'
          ? { name: server.name, ok: true, toolCount: state.toolCount }
          : { name: server.name, ok: false, error: state?.error ?? `status ${state?.status ?? 'unknown'}` });
      } catch (error) {
        results.push({ name: server.name, ok: false, error: errorText(error) });
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return results;
  } finally {
    await manager.disconnectAll().catch(() => undefined);
  }
}
