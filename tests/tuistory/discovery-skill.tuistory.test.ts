/** @license Apache-2.0 */
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exitInteractive } from './helpers/autohandTuistory.js';
import { launchAdaptiveSkillsFixture, type AdaptiveSkillsFixture } from './helpers/adaptiveSkillsFixture.js';

const fixtures: AdaptiveSkillsFixture[] = [];
const homes: string[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.cleanup();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

describe('interactive workflow discovery', () => {
  it('cancels a stalled collector with Escape and accepts the next composer turn', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'discovery-cancel-home-'));
    homes.push(home);
    const marker = path.join(home, 'collector.pid');
    const preload = path.join(home, 'stall-collector.mjs');
    await writeFile(preload, `import { writeFile } from 'node:fs/promises';
if (process.env.AUTOHAND_DISCOVERY_CHILD === '1') {
  await writeFile(${JSON.stringify(marker)}, String(process.pid));
  await new Promise(() => setTimeout(() => process.exit(0), 45000));
}`);
    const fixture = await launchAdaptiveSkillsFixture({ adaptiveSkills: true, localSkills: 0,
      env: { AUTOHAND_DISCOVERY_HOME: home, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
      turns: [{ content: 'DISCOVERY_CANCEL_COMPOSER_READY' }] });
    fixtures.push(fixture);
    let childPid: number | undefined;
    try {
      await fixture.session.waitForText('❯', { timeout: 15_000 });
      await fixture.session.type('/discovery ');
      await fixture.session.press('enter');
      await vi.waitFor(async () => {
        childPid = Number(await readFile(marker, 'utf8'));
        expect(childPid).toBeGreaterThan(0);
      }, { timeout: 15_000 });
      const runningPid = childPid;
      if (!runningPid) throw new Error('Collector did not report its process ID.');
      expect(fixture.server.requests).toHaveLength(0);
      await fixture.session.press('escape');
      await fixture.session.waitForText('Discovery cancelled.', { timeout: 10_000 });
      await vi.waitFor(() => { expect(() => process.kill(runningPid, 0)).toThrow(); }, { timeout: 5_000 });
      await fixture.session.type('hello after discovery');
      await fixture.session.press('enter');
      await fixture.session.waitForText('DISCOVERY_CANCEL_COMPOSER_READY', { timeout: 15_000 });
      expect(fixture.server.requests).toHaveLength(1);
      await exitInteractive(fixture.session);
    } finally {
      if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch { /* The collector already stopped. */ } }
    }
  });

  it.each(['$workflow-discovery', '/discovery'])('collects a local preview for %s without asking the user for ranking inputs', async invocation => {
    const home = await mkdtemp(path.join(tmpdir(), 'discovery-skill-home-'));
    homes.push(home);
    const fixture = await launchAdaptiveSkillsFixture({ adaptiveSkills: true, localSkills: 0,
      env: { AUTOHAND_DISCOVERY_HOME: home }, turns: [{ content: 'DISCOVERY_INTERNAL_RANKER_REPRO' }] });
    fixtures.push(fixture);
    const packageFile = path.join(fixture.state.workspaceRoot, 'package.json');
    const manifest = JSON.stringify({ name: 'interactive-discovery-fixture', scripts: { test: 'DO_NOT_EXECUTE_DISCOVERY_SCRIPT' } });
    await writeFile(packageFile, manifest);
    await fixture.session.waitForText('❯', { timeout: 15_000 });
    await fixture.session.type(`${invocation} `);
    await fixture.session.press('enter');
    const screen = await fixture.session.text({ timeout: 15_000,
      waitFor: text => text.includes('Suggested workflows') || text.includes('DISCOVERY_INTERNAL_RANKER_REPRO') });
    expect(fixture.server.requests, 'Local discovery must gather evidence instead of invoking the structured ranker without its input').toHaveLength(0);
    expect(screen).toContain('Suggested workflows');
    expect(screen).toContain('repository-onboarding');
    expect(fixture.session.readAll()).not.toContain('ask_followup_question');
    await expect(access(path.join(fixture.state.workspaceRoot, '.autohand/discovery.json'))).rejects.toThrow();
    await exitInteractive(fixture.session);
  });
});
