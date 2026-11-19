/** @license Apache-2.0 */
import { execFile, type ExecFileException } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { discoveryProcessArguments } from './cli.js';
import { killAfter } from '../utils/processTimeout.js';
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';

export function isWorkflowDiscoveryShortcut(input: string, registry?: Pick<SkillsRegistry, 'getSkill'>, bare = false): boolean {
  if (bare || input.trim() !== '$workflow-discovery') return false;
  const skill = registry?.getSkill('workflow-discovery');
  return skill?.name === 'workflow-discovery' && skill.source === 'builtin';
}

interface DiscoveryPreviewOptions {
  workspaceRoot: string;
  signal?: AbortSignal;
  executable?: string;
  prefix?: string[];
  timeoutMs?: number;
}

export async function runDiscoveryPreview(options: DiscoveryPreviewOptions): Promise<string> {
  options.signal?.throwIfAborted();
  const flags = ['scan', '--workspace', options.workspaceRoot, '--depth', '0', '--dry-run', '--no-behavior'];
  const args = options.prefix ? [...options.prefix, 'discovery', ...flags] : discoveryProcessArguments(flags);
  const environment: NodeJS.ProcessEnv = { ...process.env, AUTOHAND_DISCOVERY_CHILD: '1', AUTOHAND_NO_BANNER: '1', AUTOHAND_DISABLE_AUTO_REPORT: '1' };
  delete environment.AUTOHAND_API_KEY;
  const timeoutMs = options.timeoutMs ?? 60_000;
  return new Promise<string>((resolve, reject) => {
    let failure: 'cancelled' | 'timed-out' | undefined;
    const child = execFile(options.executable ?? process.execPath, args, {
      cwd: options.workspaceRoot, env: environment, encoding: 'utf8', maxBuffer: 512_000, shell: false,
    }, (error, stdout, stderr) => {
      options.signal?.removeEventListener('abort', cancel);
      if (failure === 'cancelled') { reject(new Error('Local discovery preview cancelled.')); return; }
      if (failure === 'timed-out') { reject(new Error(timeoutMessage(timeoutMs, stderr))); return; }
      if (error) { reject(new Error(failureMessage(error, stderr))); return; }
      const result = stripVTControlCharacters(stdout).trim();
      if (!result) { reject(new Error(`Local discovery preview returned no report. ${TERMINAL_HINT} to see what the scan finds.`)); return; }
      resolve(result);
    });
    const stop = (reason: 'cancelled' | 'timed-out'): void => {
      if (failure) return;
      failure = reason;
      child.kill('SIGTERM');
      killAfter(child, 1_000, () => child.kill('SIGKILL'));
    };
    const cancel = (): void => stop('cancelled');
    options.signal?.addEventListener('abort', cancel, { once: true });
    killAfter(child, timeoutMs, () => stop('timed-out'));
    if (options.signal?.aborted) cancel();
  });
}

const TERMINAL_HINT = 'Run "autohand discovery --dry-run" in a terminal';
const DIAGNOSTIC_LINES = 8;

/** The last lines the collector wrote, safe to show: no control sequences, no access keys, bounded. */
function diagnosticTail(stderr: string): string {
  return stripVTControlCharacters(stderr).replace(/\bahc_[\w-]+|\bsk-[\w-]+/g, '[redacted]')
    .split('\n').filter(line => line.trim()).slice(-DIAGNOSTIC_LINES).join('\n').slice(-2_000);
}

function timeoutMessage(timeoutMs: number, stderr: string): string {
  const progress = diagnosticTail(stderr);
  return `Local discovery preview timed out after ${timeoutMs / 1_000} seconds. The scan was still running: the machine may be busy or the workspace large. `
    + `Try /discovery again, or ${TERMINAL_HINT.replace('Run', 'run')} to watch its progress.${progress ? `\nLast output:\n${progress}` : ''}`;
}

function failureMessage(error: ExecFileException, stderr: string): string {
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return `Local discovery preview failed: the scan produced more output than a preview can show. ${TERMINAL_HINT} instead.`;
  }
  if (typeof error.code === 'string') {
    return `Local discovery preview failed: the scan could not be started (${error.code}). Check that Autohand is installed correctly, then try again.`;
  }
  const detail = diagnosticTail(stderr);
  const cause = error.signal ? `: the scan was stopped by ${error.signal} before it finished` : typeof error.code === 'number' ? ` (exit code ${error.code})` : '';
  return `Local discovery preview failed${cause}.${detail ? `\n${detail}` : ''}\n${TERMINAL_HINT} to see the scan step by step.`;
}
