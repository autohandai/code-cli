import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('agent traces documentation', () => {
  const root = process.cwd();

  it('documents the installed component, consent modes, paid access, and exact controls', async () => {
    const guide = await readFile(join(root, 'docs/traces.md'), 'utf8');

    for (const text of [
      'ahtraces',
      'install.sh',
      'install.ps1',
      'autohand --traces-on',
      'autohand --traces-off',
      'autohand traces status',
      'autohand traces on',
      'autohand traces off',
      'autohand traces stop',
      'ah traces status',
      'ah traces on',
      'ah traces off',
      'ah traces stop',
      'ahtraces status',
      'ahtraces on',
      'ahtraces off',
      'ahtraces stop',
      'https://console.autohand.ai/traces',
      'https://console.autohand.ai/account',
      'DELETE TRACES',
      'paid Autohand Code plans',
      'Team',
    ]) expect(guide).toContain(text);

    expect(guide).toMatch(/off by default|disabled by default/i);
    expect(guide).toContain('metadata only');
    expect(guide).toContain('redacted full traces');
    expect(guide).toContain('does not count against Autohand API usage');
  });

  it('lists every supported harness and corrects the trace deletion reference', async () => {
    const [guide, telemetry] = await Promise.all([
      readFile(join(root, 'docs/traces.md'), 'utf8'),
      readFile(join(root, 'docs/telemetry.md'), 'utf8'),
    ]);

    for (const harness of [
      'Autohand',
      'Claude Code',
      'Cursor',
      'OpenCode',
      'OpenCode 2',
      'Codex',
      'Pi',
      'Amp',
      'GitHub Copilot',
      'Cline',
      'OpenClaw',
      'Hermes',
      'Droid',
      'Grok',
      'Kimi Code',
      'Antigravity',
      'Prime Agent',
      'fx',
      'DeepSeek Harness',
    ]) expect(guide).toContain(harness);

    expect(telemetry).toContain('[Agent traces setup guide](traces.md)');
    expect(telemetry).toContain('Delete agent trace data');
    expect(telemetry).not.toContain('Console does not yet have a trace-only deletion control');
  });
});
