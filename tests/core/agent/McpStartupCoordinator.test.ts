/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { McpStartupCoordinator } from '../../../src/core/agent/McpStartupCoordinator.js';
import type {
  McpStartupConfiguredServer,
  McpStartupRuntimeServer,
} from '../../../src/core/mcpStartupHistory.js';

describe('McpStartupCoordinator', () => {
  function createCoordinator(options: {
    enabled?: boolean;
    configured?: McpStartupConfiguredServer[];
    runtime?: McpStartupRuntimeServer[];
    now?: number;
  }) {
    const lines: string[] = [];
    const coordinator = new McpStartupCoordinator({
      isEnabled: () => options.enabled !== false,
      getConfiguredServers: () => options.configured,
      getRuntimeServers: () => options.runtime ?? [],
      now: () => options.now ?? 1000,
      writeLine: (line) => lines.push(line),
    });
    return { coordinator, lines };
  }

  it('announces background startup for auto-connect servers', () => {
    const { coordinator, lines } = createCoordinator({
      configured: [
        { name: 'context7' },
        { name: 'manual', autoConnect: false },
      ],
    });

    coordinator.prepareForInteractiveStartup();

    expect(lines.join('\n')).toContain('MCP startup: connecting 1 server in background...');
  });

  it('flushes a pending summary once', () => {
    const { coordinator, lines } = createCoordinator({
      configured: [{ name: 'context7' }],
      runtime: [{ name: 'context7', status: 'connected', toolCount: 3 }],
      now: 1000,
    });

    coordinator.prepareForInteractiveStartup();
    coordinator.markConnectStarted();
    coordinator.markSummaryPending();
    coordinator.flushSummaryIfPending();
    coordinator.flushSummaryIfPending();

    const output = lines.join('\n');
    expect(output).toContain('* MCP startup');
    expect(output).toContain('1 connected');
    expect(output).toContain('context7 connected (3 tools)');
    expect(output.match(/\* MCP startup/g)).toHaveLength(1);
  });

  it('does not print a summary when MCP is disabled', () => {
    const { coordinator, lines } = createCoordinator({
      enabled: false,
      configured: [{ name: 'context7' }],
      runtime: [{ name: 'context7', status: 'connected', toolCount: 3 }],
    });

    coordinator.prepareForInteractiveStartup();
    coordinator.markSummaryPending();
    coordinator.flushSummaryIfPending();

    expect(lines.join('\n')).not.toContain('* MCP startup');
  });
});
