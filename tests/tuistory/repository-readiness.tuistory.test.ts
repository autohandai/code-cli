import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { reviewRepositoryReadinessScenario } from '../../src/testing/scenarios/repositoryReadinessScenario.js';
import { createMockAuthServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('repository readiness in the running CLI', () => {
  it.each([true, false])('offers findings after the first turn and respects startup opt-out: %s', async enabled => {
    let readinessRequests = 0; let turns = 0;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        const review = body.includes('Repository readiness inventory');
        if (review) readinessRequests++;
        else turns++;
        response.setHeader('content-type', 'application/json');
        const content = review ? JSON.stringify({ mentalModel: 'Small CLI with a package manifest and repository guidance.', findings: [{ kind: 'guidance', paths: ['AGENTS.md'], title: 'Update repository guidance', detail: 'Review changed startup commands against current instructions.' }] }) : JSON.stringify({ finalResponse: turns === 1 ? 'FIRST_TURN_COMPLETE' : 'READINESS_OPT_IN_COMPLETE', toolCalls: [] });
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Readiness fixture unavailable');
    const auth = await createMockAuthServer();
    const env = { AUTOHAND_API_URL: auth.baseUrl, AUTOHAND_AUTH_URL: auth.baseUrl, AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` };
    const state = await createTempAutohandHome({ config: {
      openrouter: { baseUrl: `http://127.0.0.1:${address.port}` },
      agent: { autoMemory: false, maxIterations: 2, sessionRetryLimit: 0 },
      features: { automaticSpecialists: false, fullScreenMode: true },
      ui: { repositoryReadiness: enabled, promptSuggestions: false, terminalBell: false, showCompletionNotification: false },
    } });
    await writeFile(path.join(state.workspaceRoot, 'AGENTS.md'), 'Use bun to test the CLI.');
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, env,
      });
      await session.text({ timeout: 20_000, waitFor: text => text.includes('❯') });
      expect(await session.text({ immediate: true })).not.toContain('Repository suggestions available.');
      await session.type('Explain this repository'); await session.press('enter');
      await session.waitForText('FIRST_TURN_COMPLETE', { timeout: 15_000 });
      if (enabled) {
        await session.waitForText('Repository suggestions available.', { timeout: 15_000 });
        expect(readinessRequests).toBe(1); expect(turns).toBe(1);
        const reminderScreen = await session.text({ immediate: true });
        expect(reminderScreen.indexOf('FIRST_TURN_COMPLETE')).toBeGreaterThanOrEqual(0);
        expect(reminderScreen.indexOf('Repository suggestions available.')).toBeGreaterThan(reminderScreen.indexOf('FIRST_TURN_COMPLETE'));
        const snapshot = await reviewRepositoryReadinessScenario(session);
        expect(snapshot).toBe((await readFile(path.join(import.meta.dirname, '../../src/testing/snapshots/repository-readiness.txt'), 'utf8')).trimEnd());
        expect(turns).toBe(2);
      } else expect(readinessRequests).toBe(0);
      await exitInteractive(session);
      expect(session.exitInfo?.exitCode).toBe(0);
      if (enabled) {
        session.close();
        await writeFile(path.join(state.workspaceRoot, 'new.ts'), 'export const changed = true;');
        session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
          autohandHome: state.autohandHome, cwd: state.workspaceRoot, env,
        });
        await session.waitForText('❯');
        await session.type('Review the changed repository'); await session.press('enter');
        await session.waitForText('READINESS_OPT_IN_COMPLETE', { timeout: 15_000 });
        await session.waitIdle();
        expect(await session.text({ immediate: true })).not.toContain('Repository suggestions available.');
        expect(session.getRawOutput()).not.toContain('Repository suggestions available.');
        expect(readinessRequests).toBe(2);
        await session.type('/readiness'); await session.press('tab'); await session.press('enter');
        await session.waitForText('Evidence: AGENTS.md');
        await exitInteractive(session);
      }
    } finally {
      if (session && !session.exitInfo) await exitInteractive(session).catch(() => {});
      session?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      await auth.close(); await state.cleanup();
    }
  }, 60_000);
});
