import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { exitAfterExport, runExportPrivacyScenario } from '../../src/testing/scenarios/exportPrivacyScenario.js';
import {
  createMockAutohandAINativeSequenceServer, createTempAutohandHome, expectCleanExit, launchBuiltAutohand, waitForExit,
  type MockNativeToolServer, type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const server of servers.splice(0)) await server.close();
  for (const state of states.splice(0)) await state.cleanup();
});
function config(baseUrl: string) {
  return {
    provider: 'autohandai',
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-autohand-api-key', model: 'moa', baseUrl },
    features: { autohand_inference: true, automaticSpecialists: false },
    agent: { autoMemory: false, maxIterations: 8, sessionRetryLimit: 0 },
    network: { maxRetries: 0, retryDelay: 0 },
    ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
  };
}

describe('CLI session safety', () => {
  it.each(['md', 'json', 'html'] as const)('/export %s redacts real tool output and saves outside the working tree', async format => {
    const secret = 'sk-test123456789abcdefghijklmnopqrstuv';
    const pem = '-----BEGIN PRIVATE KEY-----\nfixture-private-material\n-----END PRIVATE KEY-----';
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'Reading the fixture.', toolCall: { id: 'read_export_fixture', name: 'read_file', args: { path: 'tool-output.txt' } } },
      { content: 'EXPORT_FIXTURE_READY' },
    ]); servers.push(server);
    const state = await createTempAutohandHome({ config: config(server.baseUrl) }); states.push(state);
    await fs.writeFile(path.join(state.workspaceRoot, 'tool-output.txt'), `OPENAI_API_KEY=${secret}\n${pem}\n`);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot }); sessions.push(session);
    const output = await runExportPrivacyScenario(session, format);
    const files = await fs.readdir(path.join(state.autohandHome, 'exports'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(new RegExp('\\.' + format + '$'));
    const content = await fs.readFile(path.join(state.autohandHome, 'exports', files[0]), 'utf8');
    expect(content).not.toContain(secret);
    expect(content).not.toContain('fixture-private-material');
    expect(content).toContain('[REDACTED');
    if (format === 'json') expect(() => JSON.parse(content)).not.toThrow();
    expect(output).toMatch(/Secrets redacted: [1-9]/);
    expect((await fs.readdir(state.workspaceRoot)).some(file => file.endsWith('.' + format) && file !== 'package.json')).toBe(false);
    await exitAfterExport(session);
    await waitForExit(session);
    expectCleanExit(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 60_000);

  it('--auto-commit commits the agent test while leaving user edits and notes uncommitted', async () => {
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'Adding the regression.', toolCall: { id: 'write_test', name: 'write_file', args: { path: 'feature.test.ts', contents: '// regression fixture\n' } } },
      { content: 'SESSION_TEST_READY' },
      { content: 'Committing only the session test.', toolCall: { id: 'session_commit', name: 'auto_commit', args: { message: 'Add session regression', stage_all: true } } },
      { content: 'SESSION_COMMIT_DONE' },
    ]); servers.push(server);
    const state = await createTempAutohandHome({ config: config(server.baseUrl) }); states.push(state);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: state.workspaceRoot, encoding: 'utf8' }).trimEnd();
    git('config', 'user.name', 'Autohand Tests'); git('config', 'user.email', 'tests@autohand.ai');
    await fs.writeFile(path.join(state.workspaceRoot, 'README.md'), 'original\n');
    git('add', '--', '.'); git('commit', '-qm', 'fixture');
    await fs.writeFile(path.join(state.workspaceRoot, 'README.md'), 'user edit\n');
    await fs.writeFile(path.join(state.workspaceRoot, 'notes.txt'), 'private notes\n');
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes', '--auto-commit', '-p', 'Add feature.test.ts'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot }); sessions.push(session);
    await session.waitForText('SESSION_COMMIT_DONE', { timeout: 30_000 });
    await waitForExit(session, 15_000);
    expect(git('show', '--pretty=', '--name-only', 'HEAD')).toBe('feature.test.ts');
    expect(git('status', '--porcelain')).toContain(' M README.md');
    expect(git('status', '--porcelain')).toContain('?? notes.txt');
    expect(session.readAll()).toContain('left uncommitted (yours)');
    expect(await fs.readFile(path.join(state.workspaceRoot, 'README.md'), 'utf8')).toBe('user edit\n');
  }, 60_000);
  it.each([false, true])('Node startup honours proxy routing (NO_PROXY bypass: %s)', async bypass => {
    const server = await createMockAutohandAINativeSequenceServer([{ content: 'PROXY_BYPASS_CONFIRMED' }]); servers.push(server);
    const state = await createTempAutohandHome({ config: config(server.baseUrl) }); states.push(state);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes', '-p', 'hi'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { HTTP_PROXY: 'http://127.0.0.1:9', http_proxy: undefined, HTTPS_PROXY: undefined, https_proxy: undefined, NO_PROXY: bypass ? '127.0.0.1' : '', no_proxy: undefined },
    }); sessions.push(session);
    await waitForExit(session, 30_000);
    const output = session.readAll();
    if (bypass) {
      expect(output).toContain('PROXY_BYPASS_CONFIRMED');
      expect(server.requests.length).toBeGreaterThan(0);
    } else {
      expect(output).not.toContain('PROXY_BYPASS_CONFIRMED');
      expect(server.requests).toHaveLength(0);
      expect(output).toMatch(/fetch failed|ECONNREFUSED|connection|network/i);
    }
  }, 45_000);

});
