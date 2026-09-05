/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import { inspectLifecycleHelp, submitLifecycleCommand } from '../../src/testing/scenarios/lifecycleCommandsScenario.js';
import {
  createMockAutohandAINativeSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  repoRoot,
  type MockNativeToolServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];
const browserFixtures: Server[] = [];
const installedPlaywrightProject = process.env.AUTOHAND_VISUAL_TEST_PROJECT;

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    try {
      if (!session.exitInfo) await exitInteractive(session);
    } finally {
      session.close();
    }
  }
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(browserFixtures.splice(0).filter(server => server.listening).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  })));
  await Promise.all(states.splice(0).map(state => state.cleanup()));
});

describe('lifecycle commands Tuistory', () => {
  it('shows workflow help and executes a declared script with retained evidence', async () => {
    const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
    states.push(state);
    await fs.writeFile(path.join(state.workspaceRoot, 'package.json'), JSON.stringify({ scripts: {
      test: 'node -e "console.log(\'LIFECYCLE_TEST_PASSED\')"',
      slow: 'node -e "require(\'fs\').writeFileSync(\'slow-started\', \'yes\'); setTimeout(() => {}, 30000)"',
    } }));
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    const help = await inspectLifecycleHelp(session);
    expect(help).toContain('/pr-review');
    expect(help).toContain('/deslop');
    expect(help).toContain('/tester');
    await submitLifecycleCommand(session, '/tester run test', 'Project script: passed');
    const runs = await fs.readdir(path.join(state.workspaceRoot, '.autohand/test-evidence'));
    const manifest = JSON.parse(await fs.readFile(path.join(state.workspaceRoot, '.autohand/test-evidence', runs[0]!, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ status: 'passed', exitCode: 0, visualInspection: 'not-run' });
    expect(await fs.readFile(manifest.logPath, 'utf8')).toContain('LIFECYCLE_TEST_PASSED');

    await session.type('/tester run slow');
    await session.text({ timeout: 10_000, waitFor: text => text.includes('/tester run slow') });
    await session.press('enter');
    await vi.waitFor(async () => {
      expect(await fs.readFile(path.join(state.workspaceRoot, 'slow-started'), 'utf8')).toBe('yes');
    }, { timeout: 10_000 });
    await session.press('escape');
    await session.waitForText('Project test script cancelled', { timeout: 10_000 });
    await submitLifecycleCommand(session, '/tester help', 'Capture is not visual inspection');
    await exitInteractive(session);
  }, 60_000);

  it('exposes capture to Autohand AI and returns a real missing-prerequisite report', async () => {
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'Capture the local app evidence.', toolCall: { id: 'capture-local-evidence', name: 'capture_test_evidence', args: { url: 'http://127.0.0.1:4321' } } },
      { content: 'LIFECYCLE_CAPTURE_NOT_RUN: Playwright is not installed in this project; visual inspection was not run.' },
    ]);
    servers.push(server);
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-autohand-key', model: 'moa', baseUrl: server.baseUrl },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, terminalBell: false, showCompletionNotification: false },
    } });
    states.push(state);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await submitLifecycleCommand(session, '/tester verify local checkout', 'LIFECYCLE_CAPTURE_NOT_RUN');
    expect(JSON.stringify(server.requests[0]?.tools)).toContain('capture_test_evidence');
    expect(JSON.stringify(server.requests)).toContain('visualInspection');
    const runDirectory = path.join(state.workspaceRoot, '.autohand/test-evidence');
    const runs = await fs.readdir(runDirectory);
    const manifest = JSON.parse(await fs.readFile(path.join(runDirectory, runs[0]!, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ capture: 'not-run', visualInspection: 'not-run', screenshotPaths: [] });
    await exitInteractive(session);
  }, 60_000);

  it.skipIf(!installedPlaywrightProject)('hands real captured frames to the native model without persisting image payloads', async () => {
    const app = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><html><body style="background:white"><h1>Ready to save</h1><button id="save" onclick="document.body.style.background=\'#194266\';document.querySelector(\'h1\').textContent=\'Saved locally\'">Save</button></body></html>');
    });
    browserFixtures.push(app);
    await new Promise<void>((resolve, reject) => {
      app.once('error', reject);
      app.listen(0, '127.0.0.1', resolve);
    });
    const address = app.address();
    if (!address || typeof address === 'string') throw new Error('Browser fixture did not receive a TCP address.');
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'Capture the save journey.', toolCall: { id: 'capture-real-frames', name: 'capture_test_evidence', args: {
        url: `http://127.0.0.1:${address.port}/`,
        max_frames: 3,
        steps: [{ action: 'click', selector: '#save' }, { action: 'waitFor', selector: 'h1:has-text("Saved locally")' }],
      } } },
      { content: 'LIFECYCLE_REAL_FRAMES_RECEIVED. This transport fixture does not claim semantic visual verification.' },
    ]);
    servers.push(server);
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-autohand-key', model: 'moa', baseUrl: server.baseUrl },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, terminalBell: false, showCompletionNotification: false },
    } });
    states.push(state);
    const projectRequire = createRequire(path.join(installedPlaywrightProject!, 'package.json'));
    await fs.mkdir(path.join(state.workspaceRoot, 'node_modules'));
    await fs.symlink(path.dirname(projectRequire.resolve('playwright/package.json')), path.join(state.workspaceRoot, 'node_modules/playwright'), 'dir');
    expect(execFileSync(process.execPath, ['-e', 'process.stdout.write(typeof require("playwright").chromium.launch)'], {
      cwd: state.workspaceRoot, encoding: 'utf8',
    })).toBe('function');
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await submitLifecycleCommand(session, '/tester verify the save journey visually', 'LIFECYCLE_REAL_FRAMES_RECEIVED');
    expect(await fs.readdir(path.join(state.workspaceRoot, 'node_modules'))).toContain('playwright');
    expect(await fs.realpath(path.join(state.workspaceRoot, 'node_modules/playwright'))).toBe(await fs.realpath(path.dirname(projectRequire.resolve('playwright/package.json'))));
    expect(execFileSync(process.execPath, ['-e', 'process.stdout.write(typeof require("playwright").chromium.launch)'], {
      cwd: state.workspaceRoot, encoding: 'utf8',
    })).toBe('function');
    const runDirectory = path.join(state.workspaceRoot, '.autohand/test-evidence');
    const [run] = await fs.readdir(runDirectory);
    const manifestText = await fs.readFile(path.join(runDirectory, run!, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText) as { capture: string; message: string; visualInspection: string; screenshotPaths: string[]; animationPath: string; tracePath: string };
    expect(manifest, manifest.message).toMatchObject({ capture: 'passed', visualInspection: 'not-run' });
    expect(manifest.screenshotPaths).toHaveLength(3);
    const firstFrame = await fs.readFile(manifest.screenshotPaths[0]!);
    const finalFrame = await fs.readFile(manifest.screenshotPaths.at(-1)!);
    expect(firstFrame.equals(finalFrame)).toBe(false);
    expect(await sharp(firstFrame).metadata()).toMatchObject({ format: 'png', width: 1280, height: 720 });
    expect((await sharp(manifest.animationPath, { animated: true }).metadata()).pages).toBeGreaterThanOrEqual(2);
    expect((await fs.readFile(manifest.tracePath)).subarray(0, 2).toString()).toBe('PK');
    expect(JSON.stringify(server.requests.slice(1))).toContain('data:image/png;base64,');
    expect(manifestText).not.toContain('data:image/');
    await exitInteractive(session);
    const storedSessions = path.join(state.autohandHome, 'sessions');
    for (const relative of await fs.readdir(storedSessions, { recursive: true })) {
      if (!relative.endsWith('.json') && !relative.endsWith('.jsonl')) continue;
      expect(await fs.readFile(path.join(storedSessions, relative), 'utf8')).not.toContain('data:image/');
    }
    if (process.env.AUTOHAND_RETAIN_VISUAL_PROOF === '1') {
      const proofRoot = path.join(repoRoot(), '.tmp/max-agents-evidence');
      await fs.mkdir(proofRoot, { recursive: true, mode: 0o700 });
      const proofDirectory = await fs.mkdtemp(path.join(proofRoot, 'capture-'));
      for (const artifact of [...manifest.screenshotPaths, manifest.animationPath, manifest.tracePath]) {
        await fs.copyFile(artifact, path.join(proofDirectory, path.basename(artifact)));
      }
      console.log(`Retained visual proof: ${proofDirectory}`);
    }
  }, 60_000);
});
