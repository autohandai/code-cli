import { spawn } from 'node:child_process';
import { killAfter } from '../../utils/processTimeout.js';

export async function runUnattendedApprovalProbe(entry: string, args: string[], cwd: string, autohandHome: string): Promise<{ stdout: string; stderr: string; exitCode: number | null; elapsedMs: number }> {
  const started = Date.now();
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'false', AUTOHAND_HOME: autohandHome, AUTOHAND_OFFLINE: '1', AUTOHAND_NO_BANNER: '1', AUTOHAND_SKIP_PING: '1', AUTOHAND_DISABLE_AUTO_REPORT: '1', AUTOHAND_SKIP_UPDATE_CHECK: '1', AUTOHAND_NO_BROWSER: '1', AUTOHAND_DISABLE_COMPUTER_USE: '1', NO_COLOR: '1' };
  delete env.AUTOHAND_YES;
  delete env.AUTOHAND_NON_INTERACTIVE;
  const child = spawn(process.execPath, [entry, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-100_000); });
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-100_000); });
  killAfter(child, 20_000, () => child.kill('SIGKILL'));
  {
    const exitCode = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    return { stdout, stderr, exitCode, elapsedMs: Date.now() - started };
  }
}
