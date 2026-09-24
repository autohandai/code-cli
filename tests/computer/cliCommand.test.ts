/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { buildComputerStatusReport } from '../../src/computer/cliCommand.js';

describe('computer status', () => {
  it('does not report macOS MCP readiness without the branded permission host', () => {
    const inspection = {
      status: 'ready' as const,
      path: '/Users/test/.local/bin/cua-driver',
      version: '0.28.2',
      supported: true,
    };

    expect(buildComputerStatusReport(inspection, {
      requireComputerUseHost: true,
      computerUseHostReady: false,
    })).toMatchObject({
      installed: true,
      supported: true,
      mcpReady: false,
      error: 'Autohand Computer Use.app is missing.',
    });
    expect(buildComputerStatusReport(inspection, {
      requireComputerUseHost: true,
      computerUseHostReady: true,
    })).toMatchObject({ mcpReady: true, error: undefined });
  });
});
