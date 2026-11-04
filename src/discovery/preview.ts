/** @license Apache-2.0 */
import { execFile } from 'node:child_process';
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
  return new Promise<string>((resolve, reject) => {
    let failure: Error | undefined;
    const child = execFile(options.executable ?? process.execPath, args, {
      cwd: options.workspaceRoot, env: environment, encoding: 'utf8', maxBuffer: 512_000, shell: false,
    }, (error, stdout, stderr) => {
      options.signal?.removeEventListener('abort', cancel);
      if (failure) { reject(failure); return; }
      if (error) {
        const detail = stripVTControlCharacters(stderr).replace(/\bahc_[\w-]+|\bsk-[\w-]+/g, '[redacted]').trim().slice(-2_000);
        reject(new Error(`Local discovery preview failed.${detail ? `\n${detail}` : ''}`));
        return;
      }
      const result = stripVTControlCharacters(stdout).trim();
      if (!result) { reject(new Error('Local discovery preview returned no report.')); return; }
      resolve(result);
    });
    const stop = (error: Error): void => {
      if (failure) return;
      failure = error;
      child.kill('SIGTERM');
      killAfter(child, 1_000, () => child.kill('SIGKILL'));
    };
    const cancel = (): void => stop(new Error('Local discovery preview cancelled.'));
    options.signal?.addEventListener('abort', cancel, { once: true });
    killAfter(child, options.timeoutMs ?? 60_000, () => stop(new Error('Local discovery preview timed out.')));
    if (options.signal?.aborted) cancel();
  });
}
