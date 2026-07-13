/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { exportDashboard } from '../../src/autoresearch/export.js';
import { writeConfigJson, appendLogEntry } from '../../src/autoresearch/session.js';

describe('autoresearch dashboard export', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-export-'));
  });

  it('returns a message when there is no session', async () => {
    const result = await exportDashboard(workspaceRoot);
    expect(result.success).toBe(false);
    expect(result.message).toContain('No auto-research session');
  });

  it('writes a static HTML dashboard with log entries', async () => {
    await writeConfigJson(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
    });

    await appendLogEntry(workspaceRoot, {
      run: 1,
      status: 'kept',
      metric: 100,
      description: 'baseline',
      timestamp: new Date().toISOString(),
    });

    await appendLogEntry(workspaceRoot, {
      run: 2,
      status: 'kept',
      metric: 90,
      description: 'faster loop',
      timestamp: new Date().toISOString(),
    });

    const result = await exportDashboard(workspaceRoot);

    expect(result.success).toBe(true);
    expect(result.filePath).toBe(path.join(workspaceRoot, '.auto', 'dashboard.html'));

    const html = await fs.readFile(result.filePath!, 'utf-8');
    expect(html).toContain('test-speed');
    expect(html).toContain('total_ms');
    expect(html).toContain('baseline');
    expect(html).toContain('faster loop');
    expect(html).toContain('100');
    expect(html).toContain('90');
  });
});
