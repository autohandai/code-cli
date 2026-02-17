/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildMcpStartupSummaryRows,
  getAutoConnectMcpServerNames,
  truncateMcpStartupError,
} from '../../src/core/mcpStartupHistory.js';

describe('mcpStartupHistory', () => {
  it('returns only auto-connect server names', () => {
    const names = getAutoConnectMcpServerNames([
      { name: 'chrome-devtools' },
      { name: 'playwright', autoConnect: true },
      { name: 'manual-server', autoConnect: false },
    ]);

    expect(names).toEqual(['chrome-devtools', 'playwright']);
  });

  it('builds summary rows in configured order and defaults missing runtime rows to disconnected', () => {
    const rows = buildMcpStartupSummaryRows(
      ['b', 'a', 'missing'],
      [
        { name: 'a', status: 'error', toolCount: 0, error: 'boom' },
        { name: 'b', status: 'connected', toolCount: 4 },
      ]
    );

    expect(rows).toEqual([
      { name: 'b', status: 'connected', toolCount: 4, error: undefined },
      { name: 'a', status: 'error', toolCount: 0, error: 'boom' },
      { name: 'missing', status: 'disconnected', toolCount: 0 },
    ]);
  });

  it('truncates long startup errors', () => {
    const longError = 'x'.repeat(200);
    const shortError = truncateMcpStartupError(longError, 20);
    expect(shortError.length).toBe(20);
    expect(shortError.endsWith('…')).toBe(true);
  });
});

