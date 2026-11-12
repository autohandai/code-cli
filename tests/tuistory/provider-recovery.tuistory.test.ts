import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { Session } from 'tuistory';
import { createOpenRouterDeadlineFixture } from '../../src/testing/scenarios/openRouterDeadlineScenario.js';
import { prepareDamagedProjectLog } from '../../src/testing/scenarios/projectLogRecoveryScenario.js';
import {
  createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive,
  launchBuiltAutohand, waitForExit,
} from './helpers/autohandTuistory.js';

describe('provider and project-log recovery', () => {
  it.each(['interactive', 'headless'] as const)(
    'bounds an OpenRouter body stall in the %s CLI', async mode => {
      const server = await createOpenRouterDeadlineFixture('body');
      const state = await createTempAutohandHome({ config: {
        provider: 'openrouter', openrouter: { model: 'openai/gpt-4o-mini', baseUrl: server.baseUrl },
        features: { codeMode: false, autohand_inference: false },
        network: { timeout: 200, maxRetries: 0 }, agent: { autoMemory: false, sessionRetryLimit: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      } });
      let session: Session | undefined;
      try {
        const args = ['--path', state.workspaceRoot, '--config', state.configPath, '--y'];
        if (mode === 'headless') args.push('--prompt', 'Reply briefly', '--json', 'local');
        session = await launchBuiltAutohand(args, { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
        if (mode === 'interactive') {
          await session.waitForText('❯', { timeout: 15_000 });
          await session.type('Reply briefly');
          await session.waitForText('❯ Reply briefly');
          await session.press('enter');
          await session.waitForText('timed out', { timeout: 15_000 });
          await session.waitForText('Failed in', { timeout: 10_000 });
          await session.type('Continue after checking the provider');
          await session.waitForText('❯ Continue after checking the provider');
          await exitInteractive(session);
        } else {
          await waitForExit(session, 15_000);
          expect(session.readAll()).toContain('timed out');
          expect(session.exitInfo?.exitCode).toBe(1);
        }
        expect(server.committedResponses()).toBeGreaterThan(0);
        await expect.poll(server.activeCompletions).toBe(0);
      } finally {
        session?.close();
        await Promise.all([server.close(), state.cleanup()]);
      }
    },
  );

  it('finishes a real tool turn despite a truncated project history row', async () => {
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'Read package metadata', toolCall: { id: 'read-package', name: 'read_file', args: { path: 'package.json' } } },
      { content: 'PROJECT_HISTORY_RECOVERED' },
    ]);
    const state = await createTempAutohandHome({ config: {
      provider: 'openrouter', openrouter: { baseUrl: server.baseUrl },
      features: { codeMode: false, autohand_inference: false },
      network: { maxRetries: 0 }, agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    const failures = await prepareDamagedProjectLog(state.autohandHome, state.workspaceRoot);
    const original = await readFile(failures, 'utf8');
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath, '--y',
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      await session.waitForText('❯', { timeout: 15_000 });
      await session.type('Read package.json and report the recovery marker');
      await session.waitForText('❯ Read package.json and report the recovery marker');
      await session.press('enter');
      await session.waitForText('PROJECT_HISTORY_RECOVERED', { timeout: 20_000 });
      await session.waitForText('Completed in', { timeout: 10_000 });
      expect(session.readAll()).not.toContain('JSON Parse error');
      expect(server.requests).toHaveLength(2);
      expect(await readFile(failures, 'utf8')).toBe(original);
      await session.type('The composer still works');
      await session.waitForText('❯ The composer still works');
      await exitInteractive(session);
    } finally {
      session?.close();
      await Promise.all([server.close(), state.cleanup()]);
    }
  });
});
