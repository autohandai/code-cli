import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { attemptKill } from '../../actions/command.js';
import type { PermissionManager } from '../../permissions/PermissionManager.js';
import { getPermissionPolicyDisposition, type PermissionContext } from '../../permissions/types.js';
import { prepareCommandCoordination, waitForProcessPublication } from '../../session/peers/CommandCoordinationGate.js';
import type { SkillLearningCheck, SkillLearningCheckResult } from '../../skills/SkillLearningRuntime.js';
import type { ShellSettings } from '../../types.js';
import { buildAutohandChildProcessEnv } from '../../utils/childProcessEnv.js';
import { killAfter } from '../../utils/processTimeout.js';

export interface SkillVerificationExecutionOptions {
  check: SkillLearningCheck;
  workspaceRoot: string;
  permissionManager: Pick<PermissionManager, 'checkPermission'>;
  signal: AbortSignal;
  shellSettings?: ShellSettings;
}

const MAX_OUTPUT_BYTES = 1_048_576;
const NOT_EXECUTED: SkillLearningCheckResult = { executed: false, exitCode: null };

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export async function runSkillVerificationCheck(options: SkillVerificationExecutionOptions): Promise<SkillLearningCheckResult> {
  const { check, permissionManager, signal } = options;
  const command = [...check.command];
  const timeoutMs = check.timeoutMs ?? 15_000;
  if (signal.aborted || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000
    || command.length === 0 || command.length > 32 || command.some(part => typeof part !== 'string' || part.includes('\0') || part.length > 65_536)
    || !command[0]) return { ...NOT_EXECUTED };
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const startedAt = performance.now();
  let cwd: string;
  try {
    const root = await realpath(options.workspaceRoot);
    cwd = await realpath(path.resolve(options.workspaceRoot, check.cwd ?? '.'));
    if (!contained(root, cwd)) return { ...NOT_EXECUTED };
  } catch { return { ...NOT_EXECUTED }; }
  const context: PermissionContext = { tool: 'run_command', command: command[0], args: command.slice(1), path: cwd,
    description: `Independent skill verification check: ${check.id}` };
  const authorized = (): boolean => {
    try { return getPermissionPolicyDisposition(permissionManager.checkPermission(context)) === 'allow'; }
    catch { return false; }
  };
  if (deadline.aborted || !authorized()) return { ...NOT_EXECUTED };
  let coordinated: Awaited<ReturnType<typeof prepareCommandCoordination>>;
  try {
    coordinated = await prepareCommandCoordination({ file: command[0]!, args: command.slice(1), cwd }, deadline);
    if (deadline.aborted || !authorized() || await realpath(cwd) !== cwd) {
      await coordinated?.failed(new Error('Verification authorization changed before launch'));
      return { ...NOT_EXECUTED };
    }
  } catch { return { ...NOT_EXECUTED }; }
  let launched: ReturnType<typeof spawn> | undefined;
  try {
    launched = spawn(command[0]!, command.slice(1), { cwd, shell: false, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: buildAutohandChildProcessEnv({}, process.env, options.shellSettings?.env) });
    coordinated?.observe(launched);
  } catch {
    if (launched) await new Promise<void>(resolve => {
      launched!.once('close', () => resolve());
      launched!.once('error', () => {});
      if (launched!.pid) attemptKill(launched!.pid, 'SIGKILL'); else launched!.kill('SIGKILL');
    });
    await coordinated?.failed(new Error('Independent verification failed to spawn')).catch(() => {});
    return { ...NOT_EXECUTED };
  }
  const child = launched;
  return new Promise(resolve => {
    const stdout = createHash('sha256');
    const stderr = createHash('sha256');
    let bytes = 0;
    let executed = false;
    let invalid = false;
    let terminating = false;
    const forceKill = (): void => { if (child.pid) attemptKill(child.pid, 'SIGKILL'); else child.kill('SIGKILL'); };
    const terminate = (): void => {
      invalid = true;
      if (terminating) return;
      terminating = true;
      if (child.pid) attemptKill(child.pid, 'SIGTERM'); else child.kill('SIGTERM');
      killAfter(child, 250, forceKill);
    };
    const capture = (target: ReturnType<typeof createHash>, chunk: Buffer): void => {
      const remaining = Math.max(0, MAX_OUTPUT_BYTES - bytes);
      bytes += chunk.byteLength;
      if (remaining) target.update(chunk.subarray(0, remaining));
      if (bytes > MAX_OUTPUT_BYTES) terminate();
    };
    const onStdout = (chunk: Buffer): void => capture(stdout, chunk);
    const onStderr = (chunk: Buffer): void => capture(stderr, chunk);
    const onError = (): void => { invalid = true; };
    const cleanupDescendants = (): void => {
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The owned process group has already drained. */ }
      }
    };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.stdout?.on('error', terminate);
    child.stderr?.on('error', terminate);
    child.once('spawn', () => { executed = true; });
    child.once('error', onError);
    child.once('exit', cleanupDescendants);
    child.once('close', code => {
      deadline.removeEventListener('abort', terminate);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.stdout?.off('error', terminate);
      child.stderr?.off('error', terminate);
      const outputDigest = `sha256:${createHash('sha256').update(JSON.stringify({ stdout: stdout.digest('hex'), stderr: stderr.digest('hex') })).digest('hex')}`;
      void waitForProcessPublication(child).then(() => resolve(executed
        ? { executed: true, exitCode: invalid || deadline.aborted ? null : code, outputDigest }
        : { ...NOT_EXECUTED }), () => resolve({ executed, exitCode: null }));
    });
    deadline.addEventListener('abort', terminate, { once: true });
    killAfter(child, Math.max(1, timeoutMs - (performance.now() - startedAt)), terminate);
    if (deadline.aborted) terminate();
  });
}
