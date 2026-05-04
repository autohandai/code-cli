/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import {
  buildMcpStartupSummaryRows,
  getAutoConnectMcpServerNames,
  truncateMcpStartupError,
  type McpStartupConfiguredServer,
  type McpStartupRuntimeServer,
} from '../mcpStartupHistory.js';

export interface McpStartupCoordinatorOptions {
  isEnabled: () => boolean;
  getConfiguredServers: () => McpStartupConfiguredServer[] | undefined;
  getRuntimeServers: () => McpStartupRuntimeServer[];
  writeLine?: (line: string) => void;
  now?: () => number;
}

export class McpStartupCoordinator {
  private autoConnectServers: string[] = [];
  private connectStartedAt: number | null = null;
  private summaryPrinted = false;
  private summaryPending = false;

  constructor(private readonly options: McpStartupCoordinatorOptions) {}

  prepareForInteractiveStartup(): void {
    this.autoConnectServers = getAutoConnectMcpServerNames(this.options.getConfiguredServers());
    this.connectStartedAt = null;
    this.summaryPrinted = false;
    this.summaryPending = false;

    if (!this.options.isEnabled() || this.autoConnectServers.length === 0) {
      return;
    }

    const count = this.autoConnectServers.length;
    const label = count === 1 ? 'server' : 'servers';
    this.write(chalk.gray(`MCP startup: connecting ${count} ${label} in background...`));
  }

  markConnectStarted(): void {
    this.connectStartedAt = this.options.now?.() ?? Date.now();
  }

  markSummaryPending(): void {
    this.summaryPending = true;
  }

  flushSummaryIfPending(): void {
    if (!this.summaryPending) {
      return;
    }

    this.summaryPending = false;
    this.printSummaryIfNeeded();
  }

  printSummaryIfNeeded(): void {
    if (this.summaryPrinted) {
      return;
    }
    if (!this.options.isEnabled()) {
      this.summaryPrinted = true;
      return;
    }
    if (this.autoConnectServers.length === 0) {
      this.summaryPrinted = true;
      return;
    }

    this.summaryPrinted = true;

    const rows = buildMcpStartupSummaryRows(
      this.autoConnectServers,
      this.options.getRuntimeServers()
    );

    const elapsed = this.connectStartedAt
      ? formatElapsedTime(this.connectStartedAt, this.options.now?.() ?? Date.now())
      : null;

    const connected = rows.filter((row) => row.status === 'connected').length;
    const failed = rows.filter((row) => row.status === 'error').length;
    const disconnected = rows.filter((row) => row.status === 'disconnected').length;
    const summaryParts = [
      `${connected} connected`,
      failed > 0 ? `${failed} failed` : null,
      disconnected > 0 ? `${disconnected} disconnected` : null,
    ].filter(Boolean).join(', ');
    const elapsedSuffix = elapsed ? ` in ${elapsed}` : '';

    this.write(chalk.bold('\n* MCP startup'));
    this.write(chalk.gray(`  Async connection phase complete${elapsedSuffix} (${summaryParts})`));

    for (const row of rows) {
      if (row.status === 'connected') {
        const toolLabel = row.toolCount === 1 ? 'tool' : 'tools';
        this.write(`  ${chalk.green('✓')} ${row.name} connected (${row.toolCount} ${toolLabel})`);
        continue;
      }

      if (row.status === 'error') {
        const errorSuffix = row.error
          ? `: ${truncateMcpStartupError(row.error)}`
          : '';
        this.write(`  ${chalk.red('✖')} ${row.name} failed${errorSuffix}`);
        continue;
      }

      this.write(`  ${chalk.yellow('○')} ${row.name} not connected`);
    }

    this.write('');
  }

  private write(line: string): void {
    if (this.options.writeLine) {
      this.options.writeLine(line);
      return;
    }
    console.log(line);
  }
}

function formatElapsedTime(startedAt: number, now: number): string {
  const ms = Math.max(0, now - startedAt);
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
