/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { emptySyncSkippedFiles } from '../../src/sync/rootBudgets.js';
import { formatSyncSkippedFiles } from '../../src/sync/skipReport.js';

describe('sync omission notices', () => {
  it('reports unavailable cloud files without claiming the session was restored', () => {
    const lines = formatSyncSkippedFiles({ ...emptySyncSkippedFiles(), incompleteSessions: 1, unavailableFiles: 1 }, 'Cloud');
    expect(lines).toContain('Cloud: skipped 1 incomplete session');
    expect(lines).toContain('Cloud: 1 file unavailable in storage; history is incomplete');
    expect(lines.join('\n')).not.toContain('oversized');
  });
});
