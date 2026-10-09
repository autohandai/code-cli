import path from 'node:path';
import fs from 'fs-extra';
import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { approveExpiredYoloCommand, requestScopedCommand } from '../../src/testing/scenarios/runToolScopeScenario.js';
import { createMockOpenRouterSequenceServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('run-scoped command permissions', () => {
  it.each([false, true])('executes an argument-scoped command with expired timeout=%s', async (expired) => {
    const server = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [{ tool: 'shell', args: { command: 'touch scoped-result.txt' } }] }),
      JSON.stringify({ toolCalls: [], finalResponse: 'SCOPE_TURN_FINISHED' }),
    ]);
    const state = await createTempAutohandHome({ config: {
      openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false, maxIterations: 3, sessionRetryLimit: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath, '--offline',
        '--allowed-tools', 'shell(touch:*)', '--yolo', 'allow:*',
        ...(expired ? ['--timeout', '1'] : []),
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000 });
      await session.waitForText('❯', { timeout: 15_000 });
      if (expired) await new Promise(resolve => setTimeout(resolve, 1_100));
      await requestScopedCommand(session);
      if (expired) {
        await session.waitForText('Run this shell command', { timeout: 15_000 });
        expect(await fs.pathExists(path.join(state.workspaceRoot, 'scoped-result.txt'))).toBe(false);
        await approveExpiredYoloCommand(session);
      } else {
        await session.waitForText('SCOPE_TURN_FINISHED', { timeout: 15_000 });
      }
      expect(await fs.pathExists(path.join(state.workspaceRoot, 'scoped-result.txt'))).toBe(true);
      await exitInteractive(session);
    } finally {
      if (session && !session.exitInfo) await exitInteractive(session);
      session?.close();
      await server.close();
      await state.cleanup();
    }
  });
});
