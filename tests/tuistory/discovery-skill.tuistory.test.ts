/** @license Apache-2.0 */
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import { outputViewport } from '../../src/testing/scenarios/compactOutputScenario.js';
import { COLLECTOR_FAILURE_DETAIL, DISCOVERY_SCAN_NOTICE, composerIsEmpty, failingCollectorNodeOptions, occurrences, runDiscoveryCommand,
  seedOversizedSkills } from '../../src/testing/scenarios/discoveryScenario.js';
import { clearComposerInput, createTempAutohandHome, exitInteractive, launchBuiltAutohand, type TuistoryTempState } from './helpers/autohandTuistory.js';
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

describe('/discovery on the interactive screen', () => {
  let state: TuistoryTempState | undefined;
  let session: Session | undefined;
  afterEach(async () => {
    session?.close();
    await state?.cleanup();
    session = undefined;
    state = undefined;
  });

  async function launch(fullScreen: boolean, env: Record<string, string> = {}): Promise<Session> {
    state = await createTempAutohandHome({ config: { features: { fullScreenMode: fullScreen }, ui: { promptSuggestions: false } } });
    const home = await mkdtemp(path.join(tmpdir(), 'discovery-screen-home-'));
    homes.push(home);
    await seedOversizedSkills(state.workspaceRoot, 12);
    session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000, cols: 120, rows: 40,
      env: { AUTOHAND_DISCOVERY_HOME: home, ...env },
    });
    await session.waitForText('❯', { timeout: 20_000 });
    return session;
  }

  it('announces the scan, then keeps the heading, summary and a bounded note list on one full screen', async () => {
    const terminal = await launch(true);
    expect(terminal.getRawOutput()).toContain('\x1b[?1049h');

    await runDiscoveryCommand(terminal);
    await terminal.waitForText(DISCOVERY_SCAN_NOTICE, { timeout: 15_000 });
    await terminal.waitForText('Upload:', { timeout: 30_000 });
    await terminal.type('report stays');
    await terminal.waitForText('❯ report stays');
    const viewport = outputViewport(terminal);

    expect(viewport).toContain('❯ /discovery');
    expect(viewport).toMatch(/DISCOVERY\s+tuistory-workspace/);
    expect(viewport).toContain('1 repositories');
    expect(viewport).toContain('Suggested workflows');
    expect(viewport).toContain('unreadable or invalid skills, including:');
    expect(viewport).toContain('.agents/skills/broken-01/SKILL.md');
    expect(occurrences(viewport, 'SKILL.md')).toBe(2);
    expect(viewport).not.toContain('Skipped unreadable or invalid skill:');
    expect(viewport).toContain('more notes are not shown. Run "autohand discovery" to save every note');
    expect(viewport).not.toContain('additional notes in .autohand/discovery.json');
    expect(viewport).toContain('Dry run: no local files written.');
    await expect(access(path.join(state!.workspaceRoot, '.autohand/discovery.json'))).rejects.toThrow();
    await exitInteractive(terminal);
  });

  it('runs two different commands submitted back to back and never shows a command that did not run', async () => {
    const terminal = await launch(true);

    await runDiscoveryCommand(terminal, 'scan');
    await runDiscoveryCommand(terminal, 'push');
    await terminal.text({ timeout: 20_000, waitFor: () => occurrences(outputViewport(terminal), 'Usage: /discovery') >= 2 });
    const viewport = outputViewport(terminal);
    expect(occurrences(viewport, '❯ /discovery scan')).toBe(1);
    expect(occurrences(viewport, '❯ /discovery push')).toBe(1);
    expect(occurrences(viewport, 'Usage: /discovery')).toBe(2);
    expect(composerIsEmpty(terminal)).toBe(true);
    await exitInteractive(terminal);
  });

  it('echoes and runs a command submitted twice in one burst exactly once, and clears the composer both times', async () => {
    const terminal = await launch(true);

    const first = await runDiscoveryCommand(terminal, 'list');
    const second = await runDiscoveryCommand(terminal, 'list');
    await terminal.text({ timeout: 20_000, waitFor: () => composerIsEmpty(terminal) && outputViewport(terminal).includes('Usage: /discovery') });
    // Give a wrongly accepted duplicate time to surface before counting.
    await terminal.type('settled');
    await terminal.waitForText('❯ settled');
    await terminal.text({ timeout: 20_000,
      waitFor: () => occurrences(outputViewport(terminal), '❯ /discovery list') === occurrences(outputViewport(terminal), 'Usage: /discovery') });
    const viewport = outputViewport(terminal);
    const echoes = occurrences(viewport, '❯ /discovery list');

    expect(occurrences(viewport, 'Usage: /discovery')).toBe(echoes);
    // The duplicate window is one second; a slower second Enter is a genuine repeat and runs.
    if (second - first < 700) expect(echoes).toBe(1);
    else expect(echoes).toBeLessThanOrEqual(2);
    await clearComposerInput(terminal);
    await exitInteractive(terminal);
  });

  it.each([['full-screen', true], ['classic', false]])('shows why a scan failed and keeps the %s session alive through repeated failures', async (_layout, fullScreen) => {
    const failureHome = await mkdtemp(path.join(tmpdir(), 'discovery-failure-'));
    homes.push(failureHome);
    const terminal = await launch(fullScreen, { NODE_OPTIONS: await failingCollectorNodeOptions(failureHome) });

    for (const attempt of [1, 2, 3]) {
      await runDiscoveryCommand(terminal);
      await terminal.text({ timeout: 45_000,
        waitFor: () => occurrences(outputViewport(terminal), 'Local discovery preview failed (exit code 3).') >= attempt });
      // Identical text within a second is treated as one input burst by design; the scenario below covers that.
      await new Promise(resolve => setTimeout(resolve, 1_100));
    }
    await terminal.type('still here');
    await terminal.waitForText('❯ still here');
    const viewport = outputViewport(terminal);

    expect(viewport).toContain('Local discovery preview failed (exit code 3).');
    expect(viewport).toContain(COLLECTOR_FAILURE_DETAIL);
    expect(occurrences(viewport, COLLECTOR_FAILURE_DETAIL)).toBe(3);
    expect(terminal.getRawOutput()).not.toContain('An error occurred');
    expect(terminal.getRawOutput()).not.toContain('Fatal:');
    await clearComposerInput(terminal);
    await exitInteractive(terminal);
  });
});
