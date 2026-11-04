import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runUnattendedApprovalProbe } from '../../src/testing/scenarios/unattendedApprovalScenario.js';
import { createTempAutohandHome, createMockOpenRouterSequenceServer, launchBuiltAutohand, repoRoot, waitForExit } from './helpers/autohandTuistory.js';

const request = JSON.stringify({ toolCalls: [{ tool: 'write_file', args: { path: 'hello.txt', contents: 'hi' } }, { tool: 'run_command', args: { command: 'ls' } }] });

describe('unattended approval boundary', () => {
  it.each(['pipe', 'terminal'] as const)('stops the %s prompt after one request with approval guidance and status 77', async mode => {
    const server = await createMockOpenRouterSequenceServer([request, JSON.stringify({ finalResponse: 'Should not retry' })]);
    const state = await createTempAutohandHome({ config: { openrouter: { baseUrl: server.baseUrl }, agent: { maxIterations: 4, sessionRetryLimit: 0 }, permissions: { mode: 'interactive' } } });
    const args = ['--path', state.workspaceRoot, '--config', state.configPath, '-p', 'Create hello.txt with hi, then run ls'];
    try {
      if (mode === 'pipe') {
        const result = await runUnattendedApprovalProbe(path.join(repoRoot(), 'dist/index.js'), args, state.workspaceRoot, state.autohandHome);
        expect(result.exitCode, result.stdout + result.stderr).toBe(77);
        expect(result.elapsedMs).toBeLessThan(20_000);
        expect(result.stderr).toContain('--allowed-tools write_file');
        expect(result.stderr).toContain('--yes');
      } else {
        const session = await launchBuiltAutohand(args, { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
        try {
          await waitForExit(session, 20_000);
          expect(session.exitInfo?.exitCode, session.readAll()).toBe(77);
          expect(session.readAll()).toContain('--allowed-tools write_file');
        } finally { session.close(); }
      }
      expect(server.requests).toHaveLength(1);
      expect(existsSync(path.join(state.workspaceRoot, 'hello.txt'))).toBe(false);
    } finally { await server.close(); await state.cleanup(); }
  }, 30_000);

  it.each([['--yes'], ['--allowed-tools', 'write_file,run_command']])('runs the approved task with %j', async (...flags) => {
    const server = await createMockOpenRouterSequenceServer([request, JSON.stringify({ finalResponse: 'Completed approved task' })]);
    const state = await createTempAutohandHome({ config: { openrouter: { baseUrl: server.baseUrl }, agent: { maxIterations: 4, sessionRetryLimit: 0 } } });
    try {
      const result = await runUnattendedApprovalProbe(path.join(repoRoot(), 'dist/index.js'), ['--path', state.workspaceRoot, '--config', state.configPath, '-p', 'Create hello.txt with hi, then run ls', ...flags], state.workspaceRoot, state.autohandHome);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(existsSync(path.join(state.workspaceRoot, 'hello.txt'))).toBe(true);
      expect(server.requests).toHaveLength(2);
    } finally { await server.close(); await state.cleanup(); }
  }, 30_000);
});
