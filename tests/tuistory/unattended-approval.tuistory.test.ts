import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Session } from 'tuistory';
import { runUnattendedApprovalProbe } from '../../src/testing/scenarios/unattendedApprovalScenario.js';
import { createTempAutohandHome, createMockSubAgentCatalogFetchPreload, createMockOpenRouterSequenceServer, launchBuiltAutohand, repoRoot, waitForExit } from './helpers/autohandTuistory.js';

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

  it('stops a denied specialist installation before making a lead model request', async () => {
    const server = await createMockOpenRouterSequenceServer([JSON.stringify({ finalResponse: 'Should not run' })]);
    const preload = await createMockSubAgentCatalogFetchPreload();
    const state = await createTempAutohandHome({ config: {
      openrouter: { baseUrl: server.baseUrl }, features: { automaticSpecialists: true },
      permissions: { mode: 'interactive' }, agent: { maxIterations: 4, sessionRetryLimit: 0 },
    } });
    const nodeOptions = [process.env.NODE_OPTIONS, `--import ${preload.importSpecifier}`].filter(Boolean).join(' ');
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '-p', 'Bring a team of ui and security agents to inspect this repo.'], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { NODE_OPTIONS: nodeOptions },
      });
      await waitForExit(session, 20_000);
      expect(session.exitInfo?.exitCode, session.readAll()).toBe(77);
      expect(session.readAll()).toContain('--allowed-tools install_specialist_roster');
      expect(server.requests).toHaveLength(0);
    } finally { session?.close(); await server.close(); await preload.cleanup(); await state.cleanup(); }
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
