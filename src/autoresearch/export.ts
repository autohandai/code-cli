/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'node:path';
import { computeSessionStats, readConfigJson, readLogEntries } from './session.js';

export interface ExportDashboardResult {
  success: boolean;
  filePath?: string;
  message: string;
}

/**
 * Generate a static HTML dashboard from the current auto-research session.
 */
export async function exportDashboard(workspaceRoot: string): Promise<ExportDashboardResult> {
  const config = await readConfigJson(workspaceRoot);
  if (!config) {
    return {
      success: false,
      message: 'No auto-research session found. Run init_experiment first.',
    };
  }

  const entries = await readLogEntries(workspaceRoot);
  const stats = computeSessionStats(entries, config.direction);
  const filePath = path.join(workspaceRoot, '.auto', 'dashboard.html');

  const rows = entries
    .map(
      (entry) => `
    <tr class="status-${entry.status}">
      <td>${entry.run}</td>
      <td>${entry.status}</td>
      <td>${entry.metric} ${config.metricUnit}</td>
      <td>${escapeHtml(entry.description)}</td>
      <td>${entry.hypothesis ? escapeHtml(entry.hypothesis) : ''}</td>
      <td>${entry.learned ? escapeHtml(entry.learned) : ''}</td>
      <td>${entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''}</td>
    </tr>
  `
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auto-research: ${escapeHtml(config.name)}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
    h1 { color: #38bdf8; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
    .stat { background: #1e293b; padding: 1rem; border-radius: 0.5rem; }
    .stat .label { font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; }
    .stat .value { font-size: 1.5rem; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; background: #1e293b; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #334155; }
    th { color: #38bdf8; }
    tr.status-kept { background: rgba(34, 197, 94, 0.08); }
    tr.status-discarded { background: rgba(239, 68, 68, 0.08); }
    tr.status-checks_failed { background: rgba(245, 158, 11, 0.08); }
    tr.status-crashed { background: rgba(147, 51, 234, 0.08); }
  </style>
</head>
<body>
  <h1>🧪 ${escapeHtml(config.name)}</h1>
  <p>Metric: <strong>${escapeHtml(config.metricName)} (${escapeHtml(config.metricUnit)})</strong> — ${config.direction} is better</p>

  <div class="stats">
    <div class="stat">
      <div class="label">Runs</div>
      <div class="value">${stats.runCount}</div>
    </div>
    <div class="stat">
      <div class="label">Baseline</div>
      <div class="value">${stats.baselineMetric} ${escapeHtml(config.metricUnit)}</div>
    </div>
    <div class="stat">
      <div class="label">Best</div>
      <div class="value">${stats.bestMetric} ${escapeHtml(config.metricUnit)}</div>
    </div>
    ${stats.confidence !== undefined ? `
    <div class="stat">
      <div class="label">Confidence</div>
      <div class="value">${stats.confidence.toFixed(2)}</div>
    </div>
    ` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>Run</th>
        <th>Status</th>
        <th>Metric</th>
        <th>Description</th>
        <th>Hypothesis</th>
        <th>Learned</th>
        <th>Time</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="7">No experiment runs recorded yet.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;

  await fs.writeFile(filePath, html, 'utf-8');

  return {
    success: true,
    filePath,
    message: `Dashboard exported to ${filePath}`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
