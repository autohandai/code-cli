import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PtyDriver } from '../../../src/testing/drivers/pty-driver.js';
import { runMarkdownResizePtyScenario } from '../../../src/testing/scenarios/resumeScenario.js';

const terminal = new PtyDriver();
const profiles: string[] = [];
afterEach(async () => {
  terminal.close();
  for (const profile of profiles.splice(0)) await rm(profile, { recursive: true, force: true });
});

describe('restored markdown in a real terminal', () => {
  it('resizes, accepts input and releases bounded subscriptions on Ctrl+C', async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'autohand-markdown-resize-'));
    profiles.push(profile);
    terminal.launch('/usr/bin/env', [`AUTOHAND_HOME=${profile}`, process.execPath,
      '--import', 'tsx', 'src/testing/scenarios/markdownResizePtyScenario.ts']);
    const output = await runMarkdownResizePtyScenario(terminal);
    expect(output).not.toContain('MaxListenersExceededWarning');
    const match = /RESIZE_RESULT (\{[^\r\n]+\})/.exec(output);
    expect(match).not.toBeNull();
    if (!match) throw new Error('Terminal did not report listener cleanup');
    const counts = JSON.parse(match[1]) as { baseline: number; peak: number; afterStop: number };
    expect(counts.peak - counts.baseline).toBeLessThanOrEqual(3);
    expect(counts.afterStop).toBe(counts.baseline);
  });
});
