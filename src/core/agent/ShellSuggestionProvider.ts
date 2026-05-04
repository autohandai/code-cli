/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseShellCommand } from '../../ui/shellCommand.js';
import { runWithConcurrency } from '../../utils/parallel.js';
import type { AgentRuntime, LLMMessage } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';

const execFileAsync = promisify(execFile);

interface ShellSuggestionConversation {
  history(): LLMMessage[];
}

export interface ShellSuggestionProviderOptions {
  runtime: Pick<AgentRuntime, 'workspaceRoot'>;
  conversation: ShellSuggestionConversation;
  getLlm: () => LLMProvider;
  getParallelismLimit: () => number;
}

export function normalizeShellSuggestionFromLlm(raw: string, partialInput: string): string | null {
  if (!raw) {
    return null;
  }

  const candidate = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0]
    ?.replace(/^`+|`+$/g, '')
    ?.replace(/^\$+\s*/, '')
    ?.trim();

  if (!candidate) {
    return null;
  }

  const normalized = candidate.startsWith('!')
    ? candidate
    : `! ${candidate}`;
  const compact = normalized.replace(/\s+/g, ' ').trim();
  const compactPartial = partialInput.replace(/\s+/g, ' ').trim();

  if (!compact.toLowerCase().startsWith(compactPartial.toLowerCase())) {
    return null;
  }
  if (compact.toLowerCase() === compactPartial.toLowerCase()) {
    return null;
  }

  return compact;
}

export class ShellSuggestionProvider {
  private abortController: AbortController | null = null;
  private packageContextCache: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: ShellSuggestionProviderOptions) {}

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async resolve(inputLine: string): Promise<string | null> {
    const trimmedInput = inputLine.trim();
    if (!trimmedInput.startsWith('!')) {
      return null;
    }

    const partialCommand = parseShellCommand(trimmedInput);
    if (!partialCommand) {
      return null;
    }

    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const timeout = setTimeout(() => controller.abort(), 1800);

    try {
      const [packageContext, gitStatus] = await runWithConcurrency([
        { label: 'package_context', run: async () => this.getPackageContext() },
        { label: 'git_status', run: async () => this.getGitStatus() },
      ], this.options.getParallelismLimit());

      const recentHistory = this.options.conversation
        .history()
        .slice(-6)
        .map((message) => {
          const content = String(message.content ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 220);
          return `${message.role}: ${content}`;
        })
        .filter(Boolean)
        .join('\n');

      const completion = await this.options.getLlm().complete({
        messages: [
          {
            role: 'system',
            content: [
              'You are a shell autocomplete engine for a coding CLI.',
              'Return exactly ONE shell command completion for the current partial command.',
              'Output only the command line, no quotes and no markdown.',
              'Must start with "! " and should extend the current partial input.',
              'Prefer commands valid for this repo package manager and scripts.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              `Current partial input: ${trimmedInput}`,
              packageContext ? `Package/dependency context:\n${packageContext}` : 'Package/dependency context: unavailable',
              gitStatus ? `Uncommitted changes context:\n${gitStatus}` : 'Uncommitted changes context: unavailable',
              recentHistory ? `Recent chat context:\n${recentHistory}` : 'Recent chat context: unavailable',
            ].join('\n\n'),
          },
        ],
        maxTokens: 80,
        temperature: 0.1,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        return null;
      }

      return normalizeShellSuggestionFromLlm(completion.content, trimmedInput);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  private async getGitStatus(): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--short', '--branch'],
        { cwd: this.options.runtime.workspaceRoot, encoding: 'utf8', timeout: 1200 },
      );
      return String(stdout || '').trim().slice(0, 1200);
    } catch {
      return '';
    }
  }

  private async getPackageContext(): Promise<string> {
    const now = Date.now();
    if (this.packageContextCache && this.packageContextCache.expiresAt > now) {
      return this.packageContextCache.value;
    }

    const root = this.options.runtime.workspaceRoot;
    const lines: string[] = [];
    const existenceChecks = [
      { label: 'bun.lockb', paths: ['bun.lockb', 'bun.lock'], manager: 'bun' },
      { label: 'pnpm-lock.yaml', paths: ['pnpm-lock.yaml'], manager: 'pnpm' },
      { label: 'yarn.lock', paths: ['yarn.lock'], manager: 'yarn' },
      { label: 'package-lock.json', paths: ['package-lock.json'], manager: 'npm' },
      { label: 'python-lockfiles', paths: ['pyproject.toml', 'requirements.txt', 'Pipfile'], manager: 'python' },
      { label: 'Cargo.toml', paths: ['Cargo.toml'], manager: 'cargo' },
      { label: 'go.mod', paths: ['go.mod'], manager: 'go' },
    ] as const;

    const managerChecks = await runWithConcurrency(
      existenceChecks.map(({ label, paths, manager }) => ({
        label,
        run: async () => ({
          manager,
          present: (await Promise.all(paths.map((rel) => fs.pathExists(path.join(root, rel))))).some(Boolean),
        }),
      })),
      this.options.getParallelismLimit(),
    );

    const managers = managerChecks
      .filter((entry) => entry.present)
      .map((entry) => entry.manager);

    if (managers.length > 0) {
      lines.push(`Detected package managers: ${Array.from(new Set(managers)).join(', ')}`);
    }

    try {
      const packageJsonPath = path.join(root, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        const pkg = await fs.readJson(packageJsonPath) as { scripts?: Record<string, string> };
        const scripts = Object.keys(pkg.scripts ?? {});
        if (scripts.length > 0) {
          lines.push(`package.json scripts: ${scripts.slice(0, 20).join(', ')}`);
        }
      }
    } catch {
      // best effort
    }

    const value = lines.join('\n');
    this.packageContextCache = {
      value,
      expiresAt: now + 30_000,
    };
    return value;
  }
}
