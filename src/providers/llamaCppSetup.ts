/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { runCommand } from '../actions/command.js';

export interface LlamaCppInstallPlan {
  command: string;
  args: string[];
  label: string;
}

export interface LlamaCppProbeResult {
  installed: boolean;
  running: boolean;
  port?: number;
  baseUrl?: string;
  installPlan?: LlamaCppInstallPlan;
}

export function looksLikeLlamaCppProcess(commandLine: string, name = ''): boolean {
  const haystack = `${name} ${commandLine}`.toLowerCase();
  return haystack.includes('llama-server') || haystack.includes('llama.cpp');
}

export function extractLlamaCppPort(commandLine: string): number | undefined {
  const match = commandLine.match(/(?:--port(?:=|\s+)|-p\s*)(\d{2,5})\b/i);
  if (!match) return undefined;

  const port = Number.parseInt(match[1], 10);
  return Number.isFinite(port) ? port : undefined;
}

async function commandExists(command: string, cwd: string): Promise<boolean> {
  const lookup = process.platform === 'win32'
    ? { command: 'where', args: [command] }
    : { command: 'which', args: [command] };

  try {
    const result = await runCommand(lookup.command, lookup.args, cwd, { timeout: 5000 });
    return result.code === 0;
  } catch {
    try {
      const fallback = await runCommand(command, ['--version'], cwd, { timeout: 5000 });
      return fallback.code === 0;
    } catch {
      return false;
    }
  }
}

function parseUnixProcesses(stdout: string): Array<{ name: string; commandLine: string }> {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^\d+\s+(.*)$/);
      const commandLine = match?.[1] ?? line;
      const name = commandLine.split(/\s+/)[0] ?? '';
      return { name, commandLine };
    });
}

function parseWindowsProcesses(stdout: string): Array<{ name: string; commandLine: string }> {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as Array<{ Name?: string; CommandLine?: string }> | { Name?: string; CommandLine?: string };
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map(item => ({
      name: item.Name ?? '',
      commandLine: item.CommandLine ?? ''
    }));
  } catch {
    return [];
  }
}

async function listProcesses(cwd: string): Promise<Array<{ name: string; commandLine: string }>> {
  if (process.platform === 'win32') {
    try {
      const result = await runCommand(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object Name,CommandLine | ConvertTo-Json -Compress'
        ],
        cwd,
        { timeout: 8000 }
      );
      return result.code === 0 ? parseWindowsProcesses(result.stdout) : [];
    } catch {
      return [];
    }
  }

  try {
    const result = await runCommand('ps', ['-ax', '-o', 'pid=,command='], cwd, { timeout: 5000 });
    return result.code === 0 ? parseUnixProcesses(result.stdout) : [];
  } catch {
    return [];
  }
}

async function detectInstallPlan(cwd: string): Promise<LlamaCppInstallPlan | undefined> {
  if (process.platform === 'win32') {
    if (await commandExists('winget', cwd)) {
      return { command: 'winget', args: ['install', 'llama.cpp'], label: 'winget install llama.cpp' };
    }
    return undefined;
  }

  if (await commandExists('brew', cwd)) {
    return { command: 'brew', args: ['install', 'llama.cpp'], label: 'brew install llama.cpp' };
  }

  if (await commandExists('nix', cwd)) {
    return { command: 'nix', args: ['profile', 'install', 'nixpkgs#llama-cpp'], label: 'nix profile install nixpkgs#llama-cpp' };
  }

  return undefined;
}

async function probeLlamaCppPorts(candidatePorts: number[]): Promise<{ port?: number; baseUrl?: string }> {
  for (const port of candidatePorts) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        return {
          port,
          baseUrl: `http://127.0.0.1:${port}`
        };
      }
    } catch {
      // Ignore failed port probes and continue.
    }
  }

  return {};
}

export async function probeLlamaCppEnvironment(cwd: string): Promise<LlamaCppProbeResult> {
  const processes = await listProcesses(cwd);
  const llamaProcess = processes.find(proc => looksLikeLlamaCppProcess(proc.commandLine, proc.name));
  const installed = (await commandExists('llama-server', cwd)) || Boolean(llamaProcess);
  const installPlan = installed ? undefined : await detectInstallPlan(cwd);
  const detectedPort = llamaProcess ? extractLlamaCppPort(llamaProcess.commandLine) : undefined;
  const candidatePorts = [...new Set([detectedPort, 80, 8080].filter((port): port is number => typeof port === 'number'))];
  const probe = await probeLlamaCppPorts(candidatePorts);

  return {
    installed,
    running: Boolean(probe.baseUrl),
    port: probe.port ?? detectedPort,
    baseUrl: probe.baseUrl,
    installPlan
  };
}

export async function installLlamaCpp(plan: LlamaCppInstallPlan, cwd: string): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await runCommand(plan.command, plan.args, cwd, { timeout: 10 * 60 * 1000 });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    return {
      ok: result.code === 0,
      output
    };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error)
    };
  }
}
