/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import type { Session } from 'tuistory';
import { killAfter } from '../../utils/processTimeout.js';

const READY = '__AUTOHAND_GOAL_READY__';
const DONE = '__AUTOHAND_GOAL_DONE__';
const MAX_DIAGNOSTIC_CHARS = 8192;

export async function enqueueGoalFromAnotherProcess(workspaceRoot: string, objective: string): Promise<void> {
  await runGoalProcess('enqueue', workspaceRoot, objective);
}

export async function observeGoalFromAnotherProcess(workspaceRoot: string): Promise<string> {
  return runGoalProcess('observe', workspaceRoot);
}

async function runGoalProcess(mode: 'enqueue' | 'observe', workspaceRoot: string, objective?: string): Promise<string> {
  const moduleUrl = new URL('../../goals/GoalManager.ts', import.meta.url).href;
  const body = mode === 'enqueue'
    ? `const result = await new GoalManager(process.argv[1]).enqueueGoal({ objective: process.argv[2], source: 'cli' });
       if (!result.ok) throw new Error(result.message);
       process.stdout.write(${JSON.stringify(`${DONE}\n`)});`
    : `new GoalManager(process.argv[1]).subscribe(() => process.stdout.write('OBSERVED\\n'));`;
  const child = spawn(process.execPath, [
    '--import', 'tsx', '--input-type=module', '--eval',
    `import { GoalManager } from ${JSON.stringify(moduleUrl)};
     process.stdout.write(${JSON.stringify(`${READY}\n`)});
     ${body}`,
    workspaceRoot, ...(objective === undefined ? [] : [objective]),
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let phase: 'bootstrap' | 'operation' | 'exit' = 'bootstrap';
  let terminal = false;
  let complete = false;
  let failure: string | undefined;
  let stdout = '';
  let stderr = '';
  let partial = '';
  let resolveCompletion!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const completion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => { resolveCompletion = resolve; });
  const terminate = (reason: string): void => {
    if (failure !== undefined) return;
    failure = reason;
    child.kill('SIGKILL');
  };
  const arm = (expected: typeof phase, timeoutMs: number): void => {
    killAfter(child, timeoutMs, () => {
      if (!terminal && phase === expected) terminate(`timeout after ${timeoutMs} ms`);
    });
  };
  const onStdout = (chunk: Buffer): void => {
    if (terminal) return;
    const text = chunk.toString('utf8');
    stdout = `${stdout}${text}`.slice(-MAX_DIAGNOSTIC_CHARS);
    const lines = `${partial}${text}`.split(/\r?\n/u);
    partial = (lines.pop() ?? '').slice(-MAX_DIAGNOSTIC_CHARS);
    for (const line of lines) {
      if (phase === 'bootstrap' && line === READY) {
        phase = 'operation';
        arm(phase, 15_000);
      } else if (phase === 'operation' && mode === 'observe' && line === 'OBSERVED') {
        phase = 'exit';
        arm(phase, 1000);
      } else if (phase === 'operation' && mode === 'enqueue' && line === DONE) complete = true;
    }
  };
  const onStderr = (chunk: Buffer): void => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-MAX_DIAGNOSTIC_CHARS); };
  const onError = (error: Error): void => {
    const reason = error.message.slice(-MAX_DIAGNOSTIC_CHARS);
    if (child.pid) terminate(reason);
    else failure ??= reason;
  };
  const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    terminal = true;
    resolveCompletion({ code, signal });
  };
  const diagnostic = (reason: string): Error => new Error(`Goal fixture ${phase}: ${reason}\nstdout: ${stdout}\nstderr: ${stderr}`);
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);
  child.stdout.on('error', onError);
  child.stderr.on('error', onError);
  child.once('error', onError);
  child.once('close', onClose);
  try {
    arm('bootstrap', 30_000);
    const { code, signal } = await completion;
    if (failure !== undefined) throw diagnostic(failure);
    if (code !== 0) throw diagnostic(`code ${code}, signal ${signal}`);
    if (phase === 'bootstrap') throw diagnostic('exited without readiness');
    if (mode === 'enqueue' && !complete) throw diagnostic('exited before completion');
    if (mode === 'observe' && phase !== 'exit') throw diagnostic('exited before observing state');
    return stdout;
  } finally {
    child.stdout.off('data', onStdout);
    child.stderr.off('data', onStderr);
    child.stdout.off('error', onError);
    child.stderr.off('error', onError);
    child.off('error', onError);
    child.off('close', onClose);
  }
}

export async function openLiveGoalPanel(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await session.press(['ctrl', 'g']);
  await session.waitForText('Goals ·', { timeout: 5000 });
}

export async function expectGoalPanelRefresh(session: Session, text: string): Promise<void> {
  await session.waitForText(text, { timeout: 5000 });
}
