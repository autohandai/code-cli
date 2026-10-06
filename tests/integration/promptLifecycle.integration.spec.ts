/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const cli = path.join(root, 'src/index.ts');
const loader = path.join(root, 'node_modules/tsx/dist/loader.mjs');
const ZIT_BIN = process.env.ZIT_BIN
  || '/Users/igorcosta/Documents/autohand/faster_worktree/target/release/zit';
const hasZit = existsSync(ZIT_BIN);

const FINAL_ANSWER = 'Lifecycle fixture final answer.';

let temporary: string;
let workspace: string;
let configuration: string;
let child: ChildProcess | undefined;

beforeEach(async () => {
  temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'autohand-prompt-lifecycle-')));
  workspace = path.join(temporary, 'repo');
  await mkdir(workspace);
  await mkdir(path.join(temporary, 'home'));
  for (const args of [
    ['init', '-q'],
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'init'],
  ]) {
    spawnSync('git', args, { cwd: workspace });
  }
  await writeFile(path.join(workspace, 'README.md'), '# Fixture\n');
  spawnSync('git', ['add', '.'], { cwd: workspace });
  spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'readme'], { cwd: workspace });

  configuration = path.join(temporary, 'config.json');
  await writeFile(configuration, JSON.stringify({
    provider: 'openrouter',
    openrouter: { apiKey: 'fixture-api-key', model: 'openai/gpt-4o-mini' },
    auth: {
      token: 'fixture-token',
      expiresAt: '2099-01-01T00:00:00Z',
      user: { id: 'fixture', email: 'fixture@example.test', name: 'Fixture' },
    },
    sync: { enabled: false },
    ui: { checkForUpdates: false },
  }));
});

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  child = undefined;
  await rm(temporary, { recursive: true, force: true });
});

/**
 * A fetch stub for the model: it answers chat completions from a script and
 * leaves every other network request (telemetry, auth, updates) hanging, the
 * way a slow or unreachable service does. `leakHandle` keeps a referenced
 * interval alive, like a child process or socket that never closes.
 */
async function writeModelStub(options: {
  responses: Array<'final' | 'write-notes' | 'hang'>;
  leakHandle?: boolean;
}): Promise<string> {
  const preload = path.join(temporary, 'model-stub.mjs');
  await writeFile(preload, `
const realFetch = globalThis.fetch;
const responses = ${JSON.stringify(options.responses)};
let call = 0;
${options.leakHandle ? 'setInterval(() => {}, 1000);' : ''}
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
  if (!url.startsWith('http')) return realFetch(input, init);
  if (!url.endsWith('/chat/completions')) return new Promise(() => {});
  const step = responses[Math.min(call++, responses.length - 1)];
  if (step === 'hang') return new Promise(() => {});
  const message = step === 'write-notes'
    ? { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'NOTES.md', contents: 'fixture notes\\n' }) } }] }
    : { role: 'assistant', content: ${JSON.stringify(FINAL_ANSWER)} };
  return Response.json({
    id: 'fixture-' + call,
    choices: [{ index: 0, message, finish_reason: step === 'write-notes' ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
};
`);
  return preload;
}

interface RunningCli {
  stdout: () => string;
  stderr: () => string;
  /** Resolves with the time (ms) the first time `text` appears on stdout or stderr. */
  waitFor: (text: string, timeoutMs: number) => Promise<number>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>;
}

function startCli(args: string[], preload: string, env: Record<string, string> = {}): RunningCli {
  let stdout = '';
  let stderr = '';
  const process_ = spawn(process.execPath, ['--import', loader, cli, '--config', configuration, ...args], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AUTOHAND_HOME: path.join(temporary, 'home'),
      AUTOHAND_CONFIG: '',
      AUTOHAND_API_KEY: '',
      AUTOHAND_NO_BANNER: '1',
      AUTOHAND_DISABLE_AUTO_REPORT: '1',
      NODE_OPTIONS: `--import ${preload}`,
      ...env,
    },
  });
  child = process_;
  const listeners = new Set<() => void>();
  process_.stdout!.on('data', (chunk) => { stdout += String(chunk); listeners.forEach((listener) => listener()); });
  process_.stderr!.on('data', (chunk) => { stderr += String(chunk); listeners.forEach((listener) => listener()); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>((resolve) => {
    process_.on('exit', (code, signal) => resolve({ code, signal, at: Date.now() }));
  });
  const waitFor = (text: string, timeoutMs: number) => new Promise<number>((resolve, reject) => {
    const check = () => {
      if (stdout.includes(text) || stderr.includes(text)) {
        listeners.delete(check);
        clearTimeout(timer);
        resolve(Date.now());
      }
    };
    const timer = setTimeout(() => {
      listeners.delete(check);
      reject(new Error(`Timed out waiting for ${JSON.stringify(text)}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    listeners.add(check);
    check();
  });
  return { stdout: () => stdout, stderr: () => stderr, waitFor, exited };
}

function exitWithin(running: RunningCli, timeoutMs: number) {
  return Promise.race([
    running.exited,
    new Promise<never>((_, reject) => setTimeout(
      () => reject(new Error(`Process still running after ${timeoutMs}ms.\nstdout:\n${running.stdout()}\nstderr:\n${running.stderr()}`)),
      timeoutMs,
    )),
  ]);
}

function zitJson(args: string[]): any {
  const result = spawnSync(ZIT_BIN, [...args, '--json'], {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...process.env, ZIT_HOME: path.join(temporary, 'zit-home') },
  });
  return JSON.parse(result.stdout);
}

describe('-p lifecycle', () => {
  it('exits within a few seconds of the final answer even when a handle stays open', async () => {
    const preload = await writeModelStub({ responses: ['final'], leakHandle: true });
    const running = startCli(['-p', 'Reply briefly', '--yes'], preload);

    const answeredAt = await running.waitFor(FINAL_ANSWER, 60_000);
    const exit = await exitWithin(running, 15_000);

    expect(exit.code).toBe(0);
    expect(exit.at - answeredAt).toBeLessThan(8_000);
  }, 90_000);
});

describe.skipIf(!hasZit)('-p --zit lifecycle (real zit)', () => {
  const zitEnv = () => ({
    ZIT_BIN,
    ZIT_HOME: path.join(temporary, 'zit-home'),
    PATH: `${path.dirname(ZIT_BIN)}${path.delimiter}${process.env.PATH ?? ''}`,
  });

  async function waitForWorkspaceFile(running: RunningCli, file: string): Promise<void> {
    await running.waitFor('Using zit workspace: ', 60_000);
    const workspacePath = /Using zit workspace: (.+)/.exec(running.stderr() + running.stdout())![1]!.trim();
    const deadline = Date.now() + 60_000;
    while (!existsSync(path.join(workspacePath, file))) {
      if (Date.now() > deadline) {
        throw new Error(`${file} never appeared.\nstdout:\n${running.stdout()}\nstderr:\n${running.stderr()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  it('records the edits and disposes the workspace on SIGTERM mid-turn', async () => {
    const preload = await writeModelStub({ responses: ['write-notes', 'hang'] });
    const running = startCli(['--zit', 'Signal fixture', '-p', 'Write notes', '--yes'], preload, zitEnv());

    await waitForWorkspaceFile(running, 'NOTES.md');
    child!.kill('SIGTERM');
    const exit = await exitWithin(running, 15_000);

    expect(exit.code).not.toBe(0);
    expect(running.stderr()).toMatch(/zit: recorded [0-9a-f]{40}/);
    const status = zitJson(['status']);
    expect(status.workspaces).toEqual([]);
    expect(status.changes).toHaveLength(1);
    expect(status.changes[0].intent).toBe('Signal fixture');
  }, 120_000);

  it('records and disposes on SIGTERM after the final answer while a handle keeps the process alive', async () => {
    const preload = await writeModelStub({ responses: ['write-notes', 'final'], leakHandle: true });
    const running = startCli(['--zit', 'Late signal fixture', '-p', 'Write notes', '--yes'], preload, zitEnv());

    await running.waitFor(FINAL_ANSWER, 60_000);
    child!.kill('SIGTERM');
    await exitWithin(running, 15_000);

    expect(running.stderr()).toMatch(/zit: recorded [0-9a-f]{40}/);
    const status = zitJson(['status']);
    expect(status.workspaces).toEqual([]);
    expect(status.changes).toHaveLength(1);
  }, 120_000);
});
