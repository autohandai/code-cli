import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDiscoveryAnalyzer } from '../src/discovery/analysis.js';

const directories: string[] = [];
async function fixture(source: string) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'discovery-analysis-'));
  directories.push(cwd);
  const entry = path.join(cwd, 'model-fixture.mjs');
  await writeFile(entry, source);
  return { cwd, entry };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});
describe('bounded discovery analysis child', () => {
  it('pipes evidence to the child and unwraps the structured command result', async () => {
    const { cwd, entry } = await fixture(
      'let input = ""; for await (const data of process.stdin) input += data; console.log(JSON.stringify({ type: "result", content: JSON.stringify({ received: JSON.parse(input) }) }));'
    );
    const analyze = createDiscoveryAnalyzer({
      cwd,
      executable: process.execPath,
      prefix: [entry],
    });
    expect(JSON.parse(await analyze('{"evidence":"fixture"}'))).toEqual({
      received: { evidence: 'fixture' },
    });
  });
  it('terminates a stalled child and rejects malformed model envelopes', async () => {
    const stalled = await fixture('setInterval(() => {}, 1000);');
    await expect(
      createDiscoveryAnalyzer({
        cwd: stalled.cwd,
        executable: process.execPath,
        prefix: [stalled.entry],
        timeoutMs: 50,
      })('{}')
    ).rejects.toThrow(/timed out/);
    const malformed = await fixture('console.log("not JSON");');
    await expect(
      createDiscoveryAnalyzer({
        cwd: malformed.cwd,
        executable: process.execPath,
        prefix: [malformed.entry],
      })('{}')
    ).rejects.toThrow(/structured/);
  });
  it('surfaces a redacted stderr tail when the analysis child fails', async () => {
    const { cwd, entry } = await fixture(
      'console.error("provider rejected key ahc_secret_value_1234 for model x\\x1b[31m!"); process.exit(2);'
    );
    const failure = await createDiscoveryAnalyzer({
      cwd,
      executable: process.execPath,
      prefix: [entry],
    })('{}').catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('local drafts are unchanged');
    expect((failure as Error).message).toContain('provider rejected key [redacted] for model x');
    expect((failure as Error).message).not.toContain('ahc_secret');
    expect((failure as Error).message).not.toContain('\x1b');
  });
});
